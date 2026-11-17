import type { ApplicantProfile, AddressScenario, BenefitDomain, EligibilityStatus, RuleEvaluation } from "../types";
import type { ScenarioResult } from "../scenario";
import type { DecisionPassport } from "../passport";
import type { ChildcareEvaluationResult } from "../childcare";
import { aggregateEligibilityStatus } from "../status";
import { assessCityCoverage, assessQueryCoverage, detectBenefitDomain, isLocalOnlyHousingQuery } from "../coverage";
import { callTool, isAllowedToolName, listAllowedTools } from "./tools";
import {
  applyValidatedFieldUpdate,
  CHILDCARE_MISSING_FIELDS,
  detectMissingFields,
  getQuestionForMissingField,
  isFieldAskable,
  isFieldMissing,
  isSupportedMissingField,
  resolveRequestedFields,
  selectAskableField,
  summarizeSafeSnapshot,
  summarizeSafeState,
  validateMissingFieldInput,
} from "./missing-fields";
import { sanitizeForTrace } from "./trace";
import { validateStructuredAgentDecision } from "./providers/types";
import type {
  AgentDecision,
  AgentDecisionAction,
  AgentRun,
  AgentStatus,
  AgentToolName,
  SupportedMissingField,
  ToolExecutionResult,
} from "./types";
import type { ProviderPlannerResult } from "./providers/types";
import type { RuleEvaluationOptions } from "../rules";

export const MAX_AGENT_STEPS = 8;

export type RuleEvaluationOptionsWithScope = RuleEvaluationOptions & {
  localOnly?: boolean;
};

const VALID_ACTIONS: readonly AgentDecisionAction[] = [
  "CALL_TOOL",
  "ASK_HUMAN",
  "COMPLETE",
  "HUMAN_REVIEW_REQUIRED",
] as const;

const HOUSING_DOMAIN_TOOLS: readonly AgentToolName[] = [
  "evaluate_central_rules",
  "evaluate_actual_scenario",
  "evaluate_what_if_scenario",
  "generate_decision_passport",
] as const;

const CHILDCARE_DOMAIN_TOOLS: readonly AgentToolName[] = [
  "evaluate_childcare_rules",
  "generate_childcare_passport",
] as const;

export type ProposalValidationResult = {
  valid: boolean;
  validationStage:
    | "VALID"
    | "SCHEMA_VALIDATION"
    | "ALLOWLIST_VALIDATION"
    | "STATE_TRANSITION_VALIDATION"
    | "PROVIDER_UNAVAILABLE";
  proposalRejected: boolean;
  rejectionReason: string | null;
  decision?: AgentDecision;
};

export type AgentLoopOptions = {
  maxSteps?: number;
  forceLoop?: boolean;
  includePassport?: boolean;
  domain?: BenefitDomain;
  ruleOptions?: RuleEvaluationOptionsWithScope;
  requiredFields?: SupportedMissingField[];
  plannerProposals?: Array<ProviderPlannerResult | Record<string, unknown> | null | undefined>;
  /** Inject a run id (tests / replay); otherwise a fresh one is generated per analysis. */
  runId?: string;
  /** The case defines no relocation / option B; the what-if object only mirrors the actual address. */
  whatIfMirrorsActual?: boolean;
  /**
   * Gate wording for fields whose free-text statement was contradictory or ambiguous. It
   * replaces the generic question so the user sees WHY a stated fact is asked again.
   */
  fieldQuestions?: Partial<Record<SupportedMissingField, string>>;
};

/**
 * A what-if is a real second scenario only when the user defined one that differs from the
 * actual address (city, district or rent). Otherwise the engine must not evaluate it as a
 * comparison: the passport's what-if slot simply mirrors the actual result.
 */
export function hasDistinctWhatIf(
  actual: AddressScenario,
  whatIf: AddressScenario,
  whatIfMirrorsActual?: boolean
): boolean {
  if (whatIfMirrorsActual) return false;
  return (
    (actual.city ?? "") !== (whatIf.city ?? "") ||
    (actual.district ?? "") !== (whatIf.district ?? "") ||
    actual.monthlyRent !== whatIf.monthlyRent
  );
}

function mirrorAsWhatIf(actual: ScenarioResult): ScenarioResult {
  return { ...actual, scenario: { ...actual.scenario, type: "WHAT_IF" } };
}

type InternalExecutionState = {
  domain: BenefitDomain;
  goal: string;
  applicant: ApplicantProfile;
  actualScenario: AddressScenario;
  whatIfScenario: AddressScenario;
  requiredFields: SupportedMissingField[];
  completedTools: AgentToolName[];
  executedAtSignature: Set<string>;
  includePassport: boolean;
  /** Public case id of the run (Decision Passport and audit trail agree on it). */
  caseId: string;
  /** False when the what-if only mirrors the actual address (see hasDistinctWhatIf). */
  distinctWhatIf: boolean;
  ruleOptions?: RuleEvaluationOptionsWithScope;
  fieldQuestions?: Partial<Record<SupportedMissingField, string>>;
  conflictStatus?: "CLEAR" | "CONFLICT";
  centralEvaluations?: RuleEvaluation[];
  centralStatus?: EligibilityStatus;
  actualScenarioResult?: ScenarioResult;
  whatIfScenarioResult?: ScenarioResult;
  childcareResult?: ChildcareEvaluationResult;
  childcareStatus?: EligibilityStatus;
  passportResult?: DecisionPassport;
  overallEligibilityStatus?: EligibilityStatus | "HUMAN_REVIEW_REQUIRED";
};

/** Gate wording: clarification (contradiction / ambiguity) when present, else the canonical question. */
function gateQuestion(field: SupportedMissingField, fieldQuestions?: Partial<Record<SupportedMissingField, string>>): string {
  return fieldQuestions?.[field] ?? getQuestionForMissingField(field);
}

/** Keeps clarification wording only for fields that are still unresolved. */
function openFieldQuestions(
  fieldQuestions: Partial<Record<SupportedMissingField, string>> | undefined,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario
): Partial<Record<SupportedMissingField, string>> | undefined {
  if (!fieldQuestions) return undefined;
  const open = Object.fromEntries(
    Object.entries(fieldQuestions).filter(([field]) => isFieldMissing(field as SupportedMissingField, applicant, actualScenario))
  ) as Partial<Record<SupportedMissingField, string>>;
  return Object.keys(open).length ? open : undefined;
}

function computeStateSignature(
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario
): string {
  return JSON.stringify({
    applicant,
    actualCity: actualScenario.city ?? null,
    actualRent: actualScenario.monthlyRent ?? null,
    whatIfCity: whatIfScenario.city ?? null,
    whatIfRent: whatIfScenario.monthlyRent ?? null,
  });
}

export function buildSafePlan(goal: string, domain: BenefitDomain = detectBenefitDomain(goal)): string[] {
  if (domain === "CHILDCARE") {
    return [
      "Check under-2 childcare allowance rules",
      "Resolve missing childcare applicant fields",
      "Check official childcare policy evidence",
      "Generate Childcare Decision Passport",
    ].map((step, index) => `${index + 1}. ${step} — ${goal}`);
  }

  return [
    "Check central rental rules",
    "Resolve missing applicant fields",
    "Evaluate ACTUAL scenario",
    "Evaluate WHAT-IF scenario",
    "Check policy evidence",
    "Generate Decision Passport",
  ].map((step, index) => `${index + 1}. ${step} — ${goal}`);
}

/**
 * Public case id for a run. Deterministic in the runId (so tests can inject one), unique per
 * analysis because every new analysis creates a new run, and free of personal data.
 */
export function caseIdForRun(runId: string): string {
  return `GA-${runId.replace(/^agent-/, "").toUpperCase()}`;
}

function caseIdOf(run: AgentRun): string {
  return run.caseId ?? caseIdForRun(run.runId ?? run.id);
}

export function createAgentRun(goal: string, maxSteps = MAX_AGENT_STEPS, runId?: string): AgentRun {
  const id = runId ?? `agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const domain = detectBenefitDomain(goal);
  const caseId = caseIdForRun(id);
  return {
    id,
    runId: id,
    caseId,
    domain,
    status: "IDLE",
    goal,
    currentStep: "Awaiting goal input",
    plan: buildSafePlan(goal, domain),
    stepsTaken: 0,
    maximumSteps: maxSteps,
    providerStatus: "UNKNOWN",
    auditTrail: [
      {
        timestamp: new Date().toISOString(),
        actor: "SYSTEM",
        action: "AGENT_RUN_STARTED",
        input: { goal, domain, caseId },
      },
    ],
    trace: [],
  };
}

export function validateAgentDecision(value: unknown): value is AgentDecision {
  return validateStructuredAgentDecision(value);
}

export function appendAuditTrail(
  run: AgentRun,
  action: string,
  input?: unknown,
  output?: unknown,
  policyVersion?: string,
  actor: AgentRun["auditTrail"][number]["actor"] = "AGENT"
): AgentRun {
  return {
    ...run,
    auditTrail: [
      ...run.auditTrail,
      {
        timestamp: new Date().toISOString(),
        actor,
        action,
        input,
        output,
        policyVersion,
      },
    ],
  };
}

function hasUnsafeOverrideAttempt(
  toolArguments: unknown,
  applicant: ApplicantProfile
): string | null {
  if (!toolArguments || typeof toolArguments !== "object") {
    return null;
  }

  const args = toolArguments as Record<string, unknown>;
  for (const forbiddenKey of [
    "overrideStatus",
    "forceStatus",
    "forcePass",
    "eligibilityStatus",
    "overallStatus",
    "bypassHumanGate",
  ]) {
    if (forbiddenKey in args) {
      return `UNSAFE_OVERRIDE_KEY_${forbiddenKey}`;
    }
  }

  if (args.profile && typeof args.profile === "object") {
    const proposedProfile = args.profile as Record<string, unknown>;
    if (
      applicant.ownsHome !== null &&
      applicant.ownsHome !== undefined &&
      "ownsHome" in proposedProfile &&
      proposedProfile.ownsHome !== applicant.ownsHome
    ) {
      return "UNSAFE_PROFILE_MUTATION_ownsHome";
    }
    if (
      applicant.receivesOtherHousingAid !== null &&
      applicant.receivesOtherHousingAid !== undefined &&
      "receivesOtherHousingAid" in proposedProfile &&
      proposedProfile.receivesOtherHousingAid !== applicant.receivesOtherHousingAid
    ) {
      return "UNSAFE_PROFILE_MUTATION_receivesOtherHousingAid";
    }
  }

  return null;
}

export function validatePlannerProposal(
  rawProposal: unknown,
  state: {
    domain?: BenefitDomain;
    applicant: ApplicantProfile;
    actualScenario: AddressScenario;
    whatIfScenario: AddressScenario;
    requiredFields: SupportedMissingField[];
    completedTools: AgentToolName[];
    executedAtSignature: Set<string>;
    centralStatus?: EligibilityStatus;
    childcareStatus?: EligibilityStatus;
    overallEligibilityStatus?: EligibilityStatus | "HUMAN_REVIEW_REQUIRED";
    conflictStatus?: "CLEAR" | "CONFLICT";
    /** Omitted by callers that predate the flag: treated as a distinct what-if. */
    distinctWhatIf?: boolean;
  }
): ProposalValidationResult {
  if (!rawProposal || typeof rawProposal !== "object") {
    return {
      valid: false,
      validationStage: "SCHEMA_VALIDATION",
      proposalRejected: true,
      rejectionReason: "PROPOSAL_NOT_AN_OBJECT",
    };
  }

  const candidate = rawProposal as Record<string, unknown>;
  if (typeof candidate.reasoningSummary !== "string" || !candidate.reasoningSummary.trim()) {
    return {
      valid: false,
      validationStage: "SCHEMA_VALIDATION",
      proposalRejected: true,
      rejectionReason: "INVALID_REASONING_SUMMARY",
    };
  }

  const nextAction = candidate.nextAction;
  if (typeof nextAction !== "string" || !(VALID_ACTIONS as readonly string[]).includes(nextAction)) {
    return {
      valid: false,
      validationStage: "SCHEMA_VALIDATION",
      proposalRejected: true,
      rejectionReason: `INVALID_NEXT_ACTION: ${String(nextAction)}`,
    };
  }

  if (candidate.toolArguments !== undefined && (typeof candidate.toolArguments !== "object" || candidate.toolArguments === null)) {
    return {
      valid: false,
      validationStage: "SCHEMA_VALIDATION",
      proposalRejected: true,
      rejectionReason: "INVALID_TOOL_ARGUMENTS",
    };
  }

  const domain: BenefitDomain = state.domain ?? "HOUSING";

  // The policy-conflict review path is entered only from deterministic state (a validated
  // detect_policy_conflict result). A model proposal alone cannot manufacture a conflict;
  // rejecting it lets the deterministic selector route by actual state (Human Gate or next tool).
  if (nextAction === "HUMAN_REVIEW_REQUIRED" && state.conflictStatus !== "CONFLICT") {
    return {
      valid: false,
      validationStage: "STATE_TRANSITION_VALIDATION",
      proposalRejected: true,
      rejectionReason: "HUMAN_REVIEW_WITHOUT_VALIDATED_CONFLICT",
    };
  }

  if (nextAction === "CALL_TOOL") {
    if (typeof candidate.toolName !== "string" || !candidate.toolName.trim()) {
      return {
        valid: false,
        validationStage: "SCHEMA_VALIDATION",
        proposalRejected: true,
        rejectionReason: "MISSING_TOOL_NAME",
      };
    }

    if (!isAllowedToolName(candidate.toolName)) {
      return {
        valid: false,
        validationStage: "ALLOWLIST_VALIDATION",
        proposalRejected: true,
        rejectionReason: `TOOL_NOT_IN_ALLOWLIST: ${candidate.toolName}`,
      };
    }

    if (
      domain === "CHILDCARE" &&
      (HOUSING_DOMAIN_TOOLS as readonly string[]).includes(candidate.toolName)
    ) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `DOMAIN_MISMATCH_HOUSING_TOOL_ON_CHILDCARE_RUN: ${candidate.toolName}`,
      };
    }

    if (
      domain === "HOUSING" &&
      (CHILDCARE_DOMAIN_TOOLS as readonly string[]).includes(candidate.toolName)
    ) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `DOMAIN_MISMATCH_CHILDCARE_TOOL_ON_HOUSING_RUN: ${candidate.toolName}`,
      };
    }
  }

  const missingFields = detectMissingFields(state.applicant, state.actualScenario, state.requiredFields);

  // Gate 4C invariant: a Human Gate never asks a field the normalized state already knows.
  // The field is resolved from the proposal itself (explicit name, alias, or — for the cloud
  // schema, which carries no field — the free-text question), never from `missingFields[0]`,
  // so a proposal cannot slip past the check by omitting or aliasing the field.
  const isHumanRequest =
    nextAction === "ASK_HUMAN" ||
    (nextAction === "CALL_TOOL" &&
      (candidate.toolName === "request_missing_field" || candidate.toolName === "request_human_confirmation"));
  let gateField: SupportedMissingField | undefined;
  if (isHumanRequest) {
    const resolution = resolveRequestedFields(candidate);
    const askable = resolution.fields.filter((field) => isFieldAskable(field, state.applicant, state.actualScenario));
    if (resolution.fields.length > 0 && askable.length === 0) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `FIELD_ALREADY_KNOWN: ${resolution.fields.join(",")}`,
      };
    }
    // A targeted unknown field is honoured only when it is required for this run; otherwise
    // the canonical next required field is asked (the gate wording is always system-owned).
    const targeted = askable.find((field) => missingFields.includes(field));
    gateField = targeted ?? missingFields[0];
    if (!gateField) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `NO_ASKABLE_FIELD${resolution.fields.length ? `: ${resolution.fields.join(",")}` : ""}`,
      };
    }
  }

  if (nextAction === "ASK_HUMAN") {
    const question =
      typeof candidate.humanQuestion === "string" && candidate.humanQuestion.trim()
        ? candidate.humanQuestion.trim()
        : gateField
          ? getQuestionForMissingField(gateField)
          : "";
    if (!question) {
      return {
        valid: false,
        validationStage: "SCHEMA_VALIDATION",
        proposalRejected: true,
        rejectionReason: "MISSING_HUMAN_QUESTION",
      };
    }
  }

  // Stage 3: State & Safety Validation
  const overrideError = hasUnsafeOverrideAttempt(candidate.toolArguments, state.applicant);
  if (overrideError) {
    return {
      valid: false,
      validationStage: "STATE_TRANSITION_VALIDATION",
      proposalRejected: true,
      rejectionReason: overrideError,
    };
  }

  const toolName = nextAction === "CALL_TOOL" ? (candidate.toolName as AgentToolName) : undefined;
  const sig = computeStateSignature(state.applicant, state.actualScenario, state.whatIfScenario);

  if (toolName === "evaluate_what_if_scenario" && state.distinctWhatIf === false) {
    return {
      valid: false,
      validationStage: "STATE_TRANSITION_VALIDATION",
      proposalRejected: true,
      rejectionReason: "NO_DISTINCT_WHAT_IF_SCENARIO",
    };
  }

  if (toolName && state.executedAtSignature.has(`${sig}:${toolName}`)) {
    return {
      valid: false,
      validationStage: "STATE_TRANSITION_VALIDATION",
      proposalRejected: true,
      rejectionReason: `DUPLICATE_TOOL_CALL_WITHOUT_STATE_CHANGE: ${toolName}`,
    };
  }

  if (domain === "CHILDCARE") {
    if (nextAction === "COMPLETE" || toolName === "complete") {
      if (!state.completedTools.includes("evaluate_childcare_rules")) {
        return {
          valid: false,
          validationStage: "STATE_TRANSITION_VALIDATION",
          proposalRejected: true,
          rejectionReason: "PREMATURE_COMPLETE_BEFORE_CHILDCARE_EVALUATION",
        };
      }
      if (state.childcareStatus !== "FAIL" && (missingFields.length > 0 || state.childcareStatus === "UNCERTAIN")) {
        return {
          valid: false,
          validationStage: "STATE_TRANSITION_VALIDATION",
          proposalRejected: true,
          rejectionReason: "CANNOT_COMPLETE_WITH_UNRESOLVED_CHILDCARE_FIELDS",
        };
      }
    }

    if (
      toolName &&
      ["get_policy_evidence", "generate_childcare_passport"].includes(toolName) &&
      state.completedTools.includes("evaluate_childcare_rules") &&
      state.childcareStatus !== "FAIL" &&
      (missingFields.length > 0 || state.childcareStatus === "UNCERTAIN")
    ) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `UNRESOLVED_MISSING_FIELD_BLOCKS_${toolName}`,
      };
    }
  } else {
    if (nextAction === "COMPLETE" || toolName === "complete") {
      if (
        !state.completedTools.includes("evaluate_central_rules") &&
        !state.completedTools.includes("evaluate_actual_scenario")
      ) {
        return {
          valid: false,
          validationStage: "STATE_TRANSITION_VALIDATION",
          proposalRejected: true,
          rejectionReason: "PREMATURE_COMPLETE_BEFORE_EVALUATION",
        };
      }

      if (missingFields.length > 0 || state.centralStatus === "UNCERTAIN") {
        return {
          valid: false,
          validationStage: "STATE_TRANSITION_VALIDATION",
          proposalRejected: true,
          rejectionReason: "CANNOT_COMPLETE_WITH_UNRESOLVED_REQUIRED_FIELDS",
        };
      }
    }

    if (
      toolName &&
      ["evaluate_actual_scenario", "evaluate_what_if_scenario", "get_policy_evidence", "generate_decision_passport"].includes(
        toolName
      ) &&
      state.completedTools.includes("evaluate_central_rules") &&
      (missingFields.length > 0 || state.centralStatus === "UNCERTAIN")
    ) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: `UNRESOLVED_MISSING_FIELD_BLOCKS_${toolName}`,
      };
    }

    if (
      toolName === "generate_decision_passport" &&
      (!state.completedTools.includes("evaluate_actual_scenario") ||
        (state.distinctWhatIf !== false && !state.completedTools.includes("evaluate_what_if_scenario")))
    ) {
      return {
        valid: false,
        validationStage: "STATE_TRANSITION_VALIDATION",
        proposalRejected: true,
        rejectionReason: "PASSPORT_REQUIRES_SCENARIO_EVALUATIONS",
      };
    }
  }

  const requestedMissingField = isHumanRequest
    ? gateField
    : isSupportedMissingField(candidate.missingField)
      ? candidate.missingField
      : missingFields[0];

  const decision: AgentDecision = {
    reasoningSummary: candidate.reasoningSummary.trim(),
    nextAction: nextAction as AgentDecisionAction,
    toolName,
    toolArguments: candidate.toolArguments,
    missingField: requestedMissingField,
    // A Human Gate always shows the system-owned question for the validated field; the
    // planner's free text may target a different (known) field and is never displayed as-is.
    humanQuestion:
      isHumanRequest && requestedMissingField
        ? getQuestionForMissingField(requestedMissingField)
        : typeof candidate.humanQuestion === "string" && candidate.humanQuestion.trim()
        ? candidate.humanQuestion.trim()
        : requestedMissingField
          ? getQuestionForMissingField(requestedMissingField)
          : undefined,
  };

  return {
    valid: true,
    validationStage: "VALID",
    proposalRejected: false,
    rejectionReason: null,
    decision,
  };
}

function hasImmediateChildcareExclusion(applicant: ApplicantProfile): boolean {
  if (typeof applicant.childAgeMonths === "number" && (applicant.childAgeMonths >= 24 || applicant.childAgeMonths < 0)) {
    return true;
  }
  if (applicant.childHasBirthOrInitialHouseholdRegistration === false) {
    return true;
  }
  if (applicant.isGovernmentPlaced === true) {
    return true;
  }
  if (applicant.receivesPublicOrQuasiPublicChildcare === true) {
    return true;
  }
  if (typeof applicant.birthOrder === "number" && applicant.birthOrder < 1) {
    return true;
  }
  return false;
}

export function decideNextStep(context: {
  goal: string;
  domain?: BenefitDomain;
  applicant: ApplicantProfile;
  actualScenario?: AddressScenario;
  requiredFields?: SupportedMissingField[];
  completedTools?: AgentToolName[];
  includePassport?: boolean;
  lastToolResult?: ToolExecutionResult;
  conflictStatus?: "CLEAR" | "CONFLICT";
}): AgentDecision {
  if (context.conflictStatus === "CONFLICT" || context.lastToolResult?.status === "HUMAN_REVIEW_REQUIRED") {
    return {
      reasoningSummary: "A policy conflict was found; the system must stop and ask for human review.",
      nextAction: "HUMAN_REVIEW_REQUIRED",
      humanQuestion: "請人工核對衝突的政策資料後再繼續。",
    };
  }

  const domain = context.domain ?? detectBenefitDomain(context.goal);
  const completed = context.completedTools ?? [];

  if (domain === "CHILDCARE") {
    const requiredFields =
      context.requiredFields ??
      (hasImmediateChildcareExclusion(context.applicant) ? [] : [...CHILDCARE_MISSING_FIELDS]);
    const missingFields = detectMissingFields(context.applicant, context.actualScenario, requiredFields);

    if (!completed.includes("evaluate_childcare_rules") && !context.lastToolResult) {
      return {
        reasoningSummary: "Run deterministic under-2 childcare allowance rules.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_childcare_rules",
      };
    }

    // Canonical gate field: never a field the state already knows (undefined → continue).
    const childcareAskField = selectAskableField(context.applicant, context.actualScenario, requiredFields, missingFields[0] ?? "childAgeMonths");
    if (
      childcareAskField &&
      context.lastToolResult?.status !== "FAIL" &&
      (missingFields.length > 0 || context.lastToolResult?.status === "UNCERTAIN")
    ) {
      const field = childcareAskField;
      return {
        reasoningSummary: `Childcare eligibility requires missing field (${field}) before a determination can be made.`,
        nextAction: "ASK_HUMAN",
        missingField: field,
        humanQuestion: getQuestionForMissingField(field),
      };
    }

    if (context.completedTools) {
      if (!completed.includes("get_policy_evidence")) {
        return {
          reasoningSummary: "Bind official childcare policy evidence.",
          nextAction: "CALL_TOOL",
          toolName: "get_policy_evidence",
        };
      }
      if (!completed.includes("generate_childcare_passport")) {
        return {
          reasoningSummary: "Generate Childcare Decision Passport.",
          nextAction: "CALL_TOOL",
          toolName: "generate_childcare_passport",
        };
      }
    }

    return {
      reasoningSummary: "Childcare deterministic evaluation is complete.",
      nextAction: "COMPLETE",
    };
  }

  const requiredFields = context.requiredFields ?? ["ownsHome", "receivesOtherHousingAid"];
  const missingFields = detectMissingFields(context.applicant, context.actualScenario, requiredFields);

  if (!completed.includes("evaluate_central_rules") && !context.lastToolResult) {
    if (missingFields.length > 0 && missingFields[0] !== "ownsHome" && missingFields[0] !== "receivesOtherHousingAid") {
      const field = missingFields[0];
      return {
        reasoningSummary: `Required field ${field} is missing; ask user before evaluation.`,
        nextAction: "ASK_HUMAN",
        missingField: field,
        humanQuestion: getQuestionForMissingField(field),
      };
    }

    if (context.applicant.ownsHome === null) {
      return {
        reasoningSummary: "Central rules still need ownership status before the rule engine can determine eligibility.",
        nextAction: "ASK_HUMAN",
        missingField: "ownsHome",
        humanQuestion: getQuestionForMissingField("ownsHome"),
      };
    }
  }

  if (missingFields.length > 0) {
    const field = missingFields[0];
    return {
      reasoningSummary: `Required field (${field}) is missing and cannot be guessed by the agent.`,
      nextAction: "ASK_HUMAN",
      missingField: field,
      humanQuestion: getQuestionForMissingField(field),
    };
  }

  const uncertainAskField = selectAskableField(context.applicant, context.actualScenario, requiredFields, missingFields[0] ?? "ownsHome");
  if (context.lastToolResult && context.lastToolResult.status === "UNCERTAIN" && uncertainAskField) {
    const fallbackField = uncertainAskField;
    return {
      reasoningSummary: "The deterministic engine remains uncertain and cannot be upgraded to PASS by the agent.",
      nextAction: "ASK_HUMAN",
      missingField: fallbackField,
      humanQuestion: getQuestionForMissingField(fallbackField),
    };
  }

  if (!completed.includes("evaluate_central_rules") && !context.lastToolResult) {
    return {
      reasoningSummary: "Run deterministic central rental rules.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
    };
  }

  if (context.completedTools) {
    if (!completed.includes("evaluate_actual_scenario")) {
      return {
        reasoningSummary: "Evaluate actual residence scenario with deterministic policy engine.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_actual_scenario",
      };
    }
    if (!completed.includes("evaluate_what_if_scenario")) {
      return {
        reasoningSummary: "Evaluate what-if residence scenario with deterministic policy engine.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_what_if_scenario",
      };
    }
    if (!completed.includes("get_policy_evidence")) {
      return {
        reasoningSummary: "Bind official policy evidence for evaluated rules.",
        nextAction: "CALL_TOOL",
        toolName: "get_policy_evidence",
      };
    }
    if (context.includePassport && !completed.includes("generate_decision_passport")) {
      return {
        reasoningSummary: "Generate Decision Passport from deterministic scenario results.",
        nextAction: "CALL_TOOL",
        toolName: "generate_decision_passport",
      };
    }
  }

  return {
    reasoningSummary: "Deterministic engine output is ready for the next step in the workflow.",
    nextAction: "COMPLETE",
  };
}

/**
 * Trace validation label. A provider outage produced no proposal, so nothing was
 * validated: it is NOT_APPLICABLE, never "VALID" and never "REJECTED".
 */
function traceValidationResult(validation: ProposalValidationResult, rawEntry: unknown): "VALID" | "REJECTED" | "NOT_APPLICABLE" {
  if (validation.proposalRejected) return "REJECTED";
  if (!rawEntry || validation.validationStage === "PROVIDER_UNAVAILABLE") return "NOT_APPLICABLE";
  return "VALID";
}

function selectDeterministicToolDecision(state: InternalExecutionState): AgentDecision {
  if (state.domain === "CHILDCARE") {
    if (!state.completedTools.includes("evaluate_childcare_rules")) {
      return {
        reasoningSummary: "Evaluate under-2 childcare allowance rules deterministically.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_childcare_rules",
      };
    }

    const missingAfterChildcare = detectMissingFields(state.applicant, state.actualScenario, state.requiredFields);
    const childcareGateField = selectAskableField(
      state.applicant,
      state.actualScenario,
      state.requiredFields,
      missingAfterChildcare[0] ?? "childAgeMonths"
    );
    if (
      childcareGateField &&
      state.childcareStatus !== "FAIL" &&
      (missingAfterChildcare.length > 0 || state.childcareStatus === "UNCERTAIN")
    ) {
      const field = childcareGateField;
      return {
        reasoningSummary: `Deterministic childcare evaluation requires missing field: ${field}.`,
        nextAction: "ASK_HUMAN",
        missingField: field,
        humanQuestion: getQuestionForMissingField(field),
      };
    }

    if (!state.completedTools.includes("get_policy_evidence")) {
      return {
        reasoningSummary: "Bind official childcare policy evidence.",
        nextAction: "CALL_TOOL",
        toolName: "get_policy_evidence",
      };
    }

    if (!state.completedTools.includes("generate_childcare_passport")) {
      return {
        reasoningSummary: "Generate Childcare Decision Passport.",
        nextAction: "CALL_TOOL",
        toolName: "generate_childcare_passport",
      };
    }

    return {
      reasoningSummary: "All required childcare deterministic steps completed.",
      nextAction: "COMPLETE",
    };
  }

  if (!state.completedTools.includes("evaluate_central_rules")) {
    // Only the rental city is needed BEFORE the central rules run (it selects the policy layer).
    // Other missing fields are asked afterwards in required order, so the first gate targets an
    // encoded eligibility condition (e.g. ownership) rather than a field no encoded rule reads.
    const extraMissing = detectMissingFields(state.applicant, state.actualScenario, state.requiredFields).find(
      (field) => field === "city"
    );
    if (extraMissing) {
      return {
        reasoningSummary: `Missing required field ${extraMissing}; request from user before proceeding.`,
        nextAction: "ASK_HUMAN",
        missingField: extraMissing,
        humanQuestion: getQuestionForMissingField(extraMissing),
      };
    }
    return {
      reasoningSummary: "Evaluate central rental rules deterministically.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
    };
  }

  const missingAfterCentral = detectMissingFields(state.applicant, state.actualScenario, state.requiredFields);
  const centralGateField = selectAskableField(
    state.applicant,
    state.actualScenario,
    state.requiredFields,
    missingAfterCentral[0] ?? "ownsHome"
  );
  if (centralGateField && (missingAfterCentral.length > 0 || state.centralStatus === "UNCERTAIN")) {
    const field = centralGateField;
    return {
      reasoningSummary: `Deterministic evaluation requires missing field: ${field}.`,
      nextAction: "ASK_HUMAN",
      missingField: field,
      humanQuestion: getQuestionForMissingField(field),
    };
  }

  if (!state.completedTools.includes("evaluate_actual_scenario")) {
    return {
      reasoningSummary: "Evaluate ACTUAL address scenario.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_actual_scenario",
    };
  }

  if (state.distinctWhatIf && !state.completedTools.includes("evaluate_what_if_scenario")) {
    return {
      reasoningSummary: "Evaluate WHAT-IF address scenario.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_what_if_scenario",
    };
  }

  if (!state.completedTools.includes("get_policy_evidence")) {
    return {
      reasoningSummary: "Bind official policy evidence.",
      nextAction: "CALL_TOOL",
      toolName: "get_policy_evidence",
    };
  }

  if (state.includePassport && !state.completedTools.includes("generate_decision_passport")) {
    return {
      reasoningSummary: "Generate Decision Passport.",
      nextAction: "CALL_TOOL",
      toolName: "generate_decision_passport",
    };
  }

  return {
    reasoningSummary: "All required deterministic steps completed.",
    nextAction: "COMPLETE",
  };
}

function deriveRequiredFields(
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  explicitRequired?: SupportedMissingField[],
  domain: BenefitDomain = "HOUSING"
): SupportedMissingField[] {
  if (domain === "CHILDCARE") {
    if (explicitRequired) {
      return [...explicitRequired];
    }
    if (hasImmediateChildcareExclusion(applicant)) {
      return [];
    }
    return [...CHILDCARE_MISSING_FIELDS];
  }

  const base: SupportedMissingField[] = explicitRequired
    ? [...explicitRequired]
    : ["ownsHome", "receivesOtherHousingAid"];

  if (!actualScenario.city || !actualScenario.city.trim()) {
    if (!base.includes("city")) {
      base.push("city");
    }
  }

  if (applicant.age === undefined || applicant.age === null) {
    if (!base.includes("age")) {
      base.push("age");
    }
  }

  return base;
}

function buildToolArguments(
  toolName: AgentToolName,
  state: InternalExecutionState,
  proposedDecision?: AgentDecision
): { args: Record<string, unknown>; safeSummary: Record<string, unknown>; auditVersion: string } {
  switch (toolName) {
    case "evaluate_central_rules":
      return {
        args: { profile: state.applicant, options: state.ruleOptions },
        safeSummary: { profileFieldsProvided: Object.keys(state.applicant) },
        auditVersion: "CENTRAL-RENT-115",
      };
    case "evaluate_actual_scenario":
      return {
        args: { profile: state.applicant, scenario: state.actualScenario, options: state.ruleOptions },
        safeSummary: { city: state.actualScenario.city ?? null, type: "ACTUAL" },
        auditVersion: "ACTUAL-SCENARIO",
      };
    case "evaluate_what_if_scenario":
      return {
        args: { profile: state.applicant, scenario: state.whatIfScenario, options: state.ruleOptions },
        safeSummary: { city: state.whatIfScenario.city ?? null, type: "WHAT_IF" },
        auditVersion: "WHAT-IF-SCENARIO",
      };
    case "evaluate_childcare_rules":
      return {
        args: { profile: state.applicant, options: state.ruleOptions },
        safeSummary: {
          domain: "CHILDCARE",
          childAgeMonths: state.applicant.childAgeMonths ?? null,
          birthOrder: state.applicant.birthOrder ?? null,
        },
        auditVersion: "CHILDCARE-ALLOWANCE-115",
      };
    case "get_policy_evidence": {
      const evaluations =
        state.domain === "CHILDCARE"
          ? [...(state.childcareResult?.evaluations ?? [])]
          : state.includePassport
            ? [
                ...(state.actualScenarioResult?.policyResults ?? []).flatMap((policy) => policy.evaluations ?? []),
                ...(state.whatIfScenarioResult?.policyResults ?? []).flatMap((policy) => policy.evaluations ?? []),
              ]
            : [...(state.centralEvaluations ?? [])];
      return {
        args: { evaluations },
        safeSummary: { evaluationCount: evaluations.length },
        auditVersion: "EVIDENCE-BINDING",
      };
    }
    case "generate_decision_passport":
      return {
        args: {
          caseId: state.caseId,
          profile: state.applicant,
          actual: state.actualScenarioResult,
          // No distinct what-if: the passport's second slot mirrors the actual result
          // (hidden by the result view) instead of a second evaluation.
          whatIf: state.distinctWhatIf || !state.actualScenarioResult
            ? state.whatIfScenarioResult
            : mirrorAsWhatIf(state.actualScenarioResult),
          options: state.ruleOptions,
        },
        safeSummary: {
          caseId: state.caseId,
          actualCity: state.actualScenario.city ?? null,
          whatIfCity: state.whatIfScenario.city ?? null,
        },
        auditVersion: "DECISION-PASSPORT",
      };
    case "generate_childcare_passport":
      return {
        args: {
          caseId: state.caseId,
          profile: state.applicant,
          childcareResult: state.childcareResult,
          options: state.ruleOptions,
        },
        safeSummary: {
          caseId: state.caseId,
          domain: "CHILDCARE",
        },
        auditVersion: "CHILDCARE-PASSPORT",
      };
    case "detect_policy_conflict": {
      const proposedClaims = (proposedDecision?.toolArguments as { claims?: unknown } | undefined)?.claims;
      return {
        args: proposedClaims ? { claims: proposedClaims } : {},
        safeSummary: { customClaims: Array.isArray(proposedClaims) ? proposedClaims.length : 0 },
        auditVersion: "CONFLICT-CHECK",
      };
    }
    case "request_missing_field":
    case "request_human_confirmation": {
      const defaultField: SupportedMissingField =
        state.domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome";
      // Tool arguments only; whether a gate actually opens is decided by the canonical
      // askable-field check at the post-tool gate below.
      const field =
        selectAskableField(state.applicant, state.actualScenario, state.requiredFields, [proposedDecision?.missingField, defaultField]) ??
        defaultField;
      return {
        args: {
          field,
          profile: state.applicant,
          scenario: state.actualScenario,
          question: proposedDecision?.humanQuestion,
        },
        safeSummary: { field },
        auditVersion: "HUMAN-GATE",
      };
    }
    case "complete":
      return {
        args: {},
        safeSummary: { action: "complete" },
        auditVersion: "AGENTIC-ORCHESTRATOR",
      };
  }
}

function updateStateFromToolResult(
  state: InternalExecutionState,
  toolName: AgentToolName,
  toolResult: ToolExecutionResult
): void {
  const sig = computeStateSignature(state.applicant, state.actualScenario, state.whatIfScenario);
  state.executedAtSignature.add(`${sig}:${toolName}`);
  if (!state.completedTools.includes(toolName)) {
    state.completedTools.push(toolName);
  }

  if (toolName === "evaluate_central_rules") {
    const res = toolResult.result as { evaluations?: RuleEvaluation[]; eligibilityStatus?: EligibilityStatus } | undefined;
    state.centralEvaluations = res?.evaluations ?? [];
    state.centralStatus = (res?.eligibilityStatus ?? toolResult.status) as EligibilityStatus;
    state.overallEligibilityStatus = state.centralStatus;
  } else if (toolName === "evaluate_actual_scenario") {
    state.actualScenarioResult = toolResult.result as ScenarioResult;
    const statuses: EligibilityStatus[] = [state.actualScenarioResult.overallStatus];
    if (state.whatIfScenarioResult) {
      statuses.push(state.whatIfScenarioResult.overallStatus);
    }
    state.overallEligibilityStatus = aggregateEligibilityStatus(statuses);
  } else if (toolName === "evaluate_what_if_scenario") {
    state.whatIfScenarioResult = toolResult.result as ScenarioResult;
    const statuses: EligibilityStatus[] = [state.whatIfScenarioResult.overallStatus];
    if (state.actualScenarioResult) {
      statuses.push(state.actualScenarioResult.overallStatus);
    }
    state.overallEligibilityStatus = aggregateEligibilityStatus(statuses);
  } else if (toolName === "evaluate_childcare_rules") {
    state.childcareResult = toolResult.result as ChildcareEvaluationResult;
    state.childcareStatus = (state.childcareResult?.eligibilityStatus ?? toolResult.status) as EligibilityStatus;
    state.overallEligibilityStatus = state.childcareStatus;
  } else if (toolName === "generate_decision_passport" || toolName === "generate_childcare_passport") {
    state.passportResult = toolResult.result as DecisionPassport;
    state.overallEligibilityStatus = toolResult.status as EligibilityStatus;
  } else if (toolName === "detect_policy_conflict") {
    if (toolResult.status === "HUMAN_REVIEW_REQUIRED") {
      state.conflictStatus = "CONFLICT";
      state.overallEligibilityStatus = "HUMAN_REVIEW_REQUIRED";
    } else {
      state.conflictStatus = "CLEAR";
    }
  }
}

function syncRunStateSnapshot(run: AgentRun, state: InternalExecutionState): void {
  run.domain = state.domain;
  run.state = {
    domain: state.domain,
    applicant: { ...state.applicant },
    actualScenario: { ...state.actualScenario },
    whatIfScenario: { ...state.whatIfScenario },
    requiredFields: [...state.requiredFields],
    completedTools: [...state.completedTools],
    centralStatus: state.centralStatus,
    actualStatus: state.actualScenarioResult?.overallStatus,
    whatIfStatus: state.whatIfScenarioResult?.overallStatus,
    childcareStatus: state.childcareStatus,
    overallEligibilityStatus: state.overallEligibilityStatus,
    ...(openFieldQuestions(state.fieldQuestions, state.applicant, state.actualScenario)
      ? { fieldQuestions: openFieldQuestions(state.fieldQuestions, state.applicant, state.actualScenario) }
      : {}),
  };
}

function resolveTraceCoverageStatus(state: InternalExecutionState): "COVERED" | "NOT_COVERED" | "MISSING" {
  if (state.domain === "CHILDCARE") {
    return "COVERED";
  }
  return assessCityCoverage(state.actualScenario.city, {
    localOnly: state.ruleOptions?.localOnly,
  }).status;
}

function executeBoundedSteps(
  run: AgentRun,
  state: InternalExecutionState,
  proposals: Array<ProviderPlannerResult | Record<string, unknown> | null | undefined>,
  maxSteps: number
): AgentRun {
  let currentRun = run;

  for (let loopIndex = 0; loopIndex < maxSteps; loopIndex += 1) {
    const stepStartedAt = performance.now();
    const rawEntry = proposals[loopIndex];
    const isProviderResult =
      rawEntry !== null &&
      rawEntry !== undefined &&
      typeof rawEntry === "object" &&
      ("providerStatus" in rawEntry || "provider" in rawEntry);

    const providerResult = isProviderResult ? (rawEntry as ProviderPlannerResult) : undefined;
    const rawDecision = isProviderResult
      ? (rawEntry as ProviderPlannerResult).decision ??
        ((rawEntry as Record<string, unknown>).rawDecision as unknown)
      : rawEntry;

    const providerLabel = providerResult?.provider ?? "DETERMINISTIC";

    let validation: ProposalValidationResult;
    let fallbackUsed = false;
    let selectedDecision: AgentDecision;

    if (rawEntry !== undefined && rawEntry !== null) {
      if (providerResult && providerResult.providerStatus === "UNAVAILABLE" && !rawDecision) {
        // No proposal exists, so nothing was "rejected": the planner timed out or was
        // unavailable and the deterministic workflow takes over. Label exactly that.
        const plannerTimedOut =
          providerResult.errorClass === "TIMEOUT" || providerResult.error === "AGENT_PROVIDER_TIMEOUT";
        validation = {
          valid: false,
          validationStage: "PROVIDER_UNAVAILABLE",
          proposalRejected: false,
          rejectionReason: providerResult.error ?? "AGENT_PROVIDER_UNAVAILABLE",
        };
        fallbackUsed = true;
        selectedDecision = selectDeterministicToolDecision(state);
        currentRun = appendAuditTrail(
          currentRun,
          plannerTimedOut ? "AGENT_PLANNER_TIMEOUT_FALLBACK" : "AGENT_PLANNER_UNAVAILABLE_FALLBACK",
          {
            step: currentRun.stepsTaken + 1,
            reason: validation.rejectionReason,
            errorClass: providerResult.errorClass ?? null,
          },
          { fallbackDecision: selectedDecision },
          "AGENTIC-ROUTER",
          "SYSTEM"
        );
      } else {
        validation = validatePlannerProposal(rawDecision, state);
        if (validation.valid && validation.decision) {
          selectedDecision = validation.decision;
          fallbackUsed = false;
        } else {
          fallbackUsed = true;
          selectedDecision = selectDeterministicToolDecision(state);
          currentRun = appendAuditTrail(
            currentRun,
            "AGENT_PROPOSAL_REJECTED",
            {
              step: currentRun.stepsTaken + 1,
              proposal: sanitizeForTrace(rawDecision),
              reason: validation.rejectionReason,
              stage: validation.validationStage,
            },
            { fallbackDecision: selectedDecision },
            "AGENTIC-ROUTER",
            "SYSTEM"
          );
        }
      }
    } else {
      validation = {
        valid: true,
        validationStage: "NOT_APPLICABLE" as unknown as ProposalValidationResult["validationStage"],
        proposalRejected: false,
        rejectionReason: null,
      };
      fallbackUsed = false;
      selectedDecision = selectDeterministicToolDecision(state);
    }

    const proposalSnapshot =
      rawDecision && typeof rawDecision === "object"
        ? {
            nextAction: String((rawDecision as Record<string, unknown>).nextAction ?? ""),
            toolName:
              (rawDecision as Record<string, unknown>).toolName !== undefined
                ? String((rawDecision as Record<string, unknown>).toolName)
                : undefined,
            // The field the proposal targets, resolved canonically (explicit name, alias or the
            // cloud schema's free-text question) so the trace shows what the model asked for.
            missingField: resolveRequestedFields(rawDecision as Record<string, unknown>).fields[0] ??
              ((rawDecision as Record<string, unknown>).missingField !== undefined
                ? String((rawDecision as Record<string, unknown>).missingField)
                : undefined),
          }
        : providerResult
          ? { nextAction: "PROVIDER_ERROR" }
          : null;

    const plannerReasoningSummary =
      rawDecision && typeof rawDecision === "object" && typeof (rawDecision as Record<string, unknown>).reasoningSummary === "string"
        ? String(sanitizeForTrace((rawDecision as Record<string, unknown>).reasoningSummary)).slice(0, 240)
        : null;

    // Handle HUMAN_REVIEW_REQUIRED action
    if (selectedDecision.nextAction === "HUMAN_REVIEW_REQUIRED") {
      currentRun.stepsTaken += 1;
      currentRun.status = "HUMAN_REVIEW_REQUIRED";
      currentRun.currentStep = "Policy conflict or review condition requires human review";
      currentRun.humanInputRequired = selectedDecision.humanQuestion ?? "請人工審核政策衝突或未決條件。";
      currentRun.lastDecision = selectedDecision;
      state.overallEligibilityStatus = "HUMAN_REVIEW_REQUIRED";
      syncRunStateSnapshot(currentRun, state);

      currentRun.trace.push({
        timestamp: new Date().toISOString(),
        runId: currentRun.runId,
        step: currentRun.stepsTaken,
        currentStateSummary: summarizeSafeState(
          currentRun.status,
          state.applicant,
          state.actualScenario,
          state.whatIfScenario,
          state.completedTools,
          state.requiredFields
        ),
        plannerProposal: proposalSnapshot,
        plannerReasoningSummary,
        selectedTool: null,
        toolArgumentsSafeSummary: null,
        validationResult: traceValidationResult(validation, rawEntry),
        proposalRejected: validation.proposalRejected,
        rejectionReason: validation.rejectionReason,
        toolResultSummary: "HUMAN_REVIEW_REQUIRED",
        coverageStatus: resolveTraceCoverageStatus(state),
        eligibilityStatus: "HUMAN_REVIEW_REQUIRED",
        humanGate: {
          triggered: true,
          question: currentRun.humanInputRequired,
        },
        fallbackUsed,
        provider: providerLabel,
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: currentRun.status,
      });

      return appendAuditTrail(
        currentRun,
        "HUMAN_REVIEW_REQUIRED",
        { step: currentRun.stepsTaken },
        selectedDecision,
        "AGENTIC-ORCHESTRATOR"
      );
    }

    // Defence in depth for the known-field invariant: an ASK with nothing unknown to ask is
    // replaced by the deterministic selector's decision (never a dead end, never a re-ask).
    if (
      selectedDecision.nextAction === "ASK_HUMAN" &&
      !selectAskableField(state.applicant, state.actualScenario, state.requiredFields, [
        selectedDecision.missingField,
        state.domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome",
      ])
    ) {
      selectedDecision = selectDeterministicToolDecision(state);
      fallbackUsed = true;
    }

    // Handle ASK_HUMAN action
    if (selectedDecision.nextAction === "ASK_HUMAN") {
      const defaultField: SupportedMissingField =
        state.domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome";
      // Canonical askable field: the validated proposal's field, else the next unknown required
      // field, else the domain default only while it is genuinely unknown.
      const askable = selectAskableField(state.applicant, state.actualScenario, state.requiredFields, [
        selectedDecision.missingField,
        ...detectMissingFields(state.applicant, state.actualScenario, state.requiredFields),
        defaultField,
      ]);
      // The guard above guarantees an askable field exists here.
      const missingField = askable ?? defaultField;
      const question = gateQuestion(missingField, state.fieldQuestions);
      currentRun.stepsTaken += 1;
      currentRun.status = "WAITING_FOR_HUMAN";
      currentRun.currentStep = `Waiting for human confirmation on ${missingField}`;
      currentRun.missingField = missingField;
      currentRun.humanInputRequired = question;
      currentRun.lastDecision = {
        ...selectedDecision,
        nextAction: "ASK_HUMAN",
        missingField,
        humanQuestion: question,
      };
      syncRunStateSnapshot(currentRun, state);

      currentRun.trace.push({
        timestamp: new Date().toISOString(),
        runId: currentRun.runId,
        step: currentRun.stepsTaken,
        currentStateSummary: summarizeSafeState(
          currentRun.status,
          state.applicant,
          state.actualScenario,
          state.whatIfScenario,
          state.completedTools,
          state.requiredFields
        ),
        plannerProposal: proposalSnapshot,
        plannerReasoningSummary,
        selectedTool: "request_missing_field",
        toolArgumentsSafeSummary: { field: missingField },
        validationResult: traceValidationResult(validation, rawEntry),
        proposalRejected: validation.proposalRejected,
        rejectionReason: validation.rejectionReason,
        toolResultSummary: `Missing field requested: ${missingField}`,
        coverageStatus: resolveTraceCoverageStatus(state),
        eligibilityStatus: "UNCERTAIN",
        humanGate: {
          triggered: true,
          missingField,
          question,
          beforeState: summarizeSafeSnapshot(state.applicant, state.actualScenario),
        },
        fallbackUsed,
        provider: providerLabel,
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: currentRun.status,
      });

      return appendAuditTrail(
        currentRun,
        "AGENT_WAITING_FOR_HUMAN",
        { missingField },
        currentRun.toolResult ?? { missingField, question },
        state.domain === "CHILDCARE" ? "CHILDCARE-ALLOWANCE-115" : "CENTRAL-RENT-115",
        "AGENT"
      );
    }

    // Handle COMPLETE action
    if (selectedDecision.nextAction === "COMPLETE" || selectedDecision.toolName === "complete") {
      currentRun.status = "COMPLETED";
      currentRun.currentStep =
        currentRun.providerStatus === "UNAVAILABLE"
          ? "Deterministic safety workflow completed (agent provider unavailable)"
          : state.includePassport
            ? "Completed after human input"
            : "Golden case flow completed";
      currentRun.lastDecision = {
        reasoningSummary: selectedDecision.reasoningSummary,
        nextAction: "COMPLETE",
      };
      syncRunStateSnapshot(currentRun, state);

      currentRun.trace.push({
        timestamp: new Date().toISOString(),
        runId: currentRun.runId,
        step: currentRun.stepsTaken,
        currentStateSummary: summarizeSafeState(
          currentRun.status,
          state.applicant,
          state.actualScenario,
          state.whatIfScenario,
          state.completedTools,
          state.requiredFields
        ),
        plannerProposal: proposalSnapshot,
        plannerReasoningSummary,
        selectedTool: "complete",
        toolArgumentsSafeSummary: {},
        validationResult: traceValidationResult(validation, rawEntry),
        proposalRejected: validation.proposalRejected,
        rejectionReason: validation.rejectionReason,
        toolResultSummary: `Workflow completed with eligibilityStatus=${String(state.overallEligibilityStatus ?? "PARTIAL_CHECK")}`,
        coverageStatus: resolveTraceCoverageStatus(state),
        eligibilityStatus: state.overallEligibilityStatus ?? "PARTIAL_CHECK",
        humanGate: null,
        fallbackUsed,
        provider: providerLabel,
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: currentRun.status,
      });

      return appendAuditTrail(
        currentRun,
        currentRun.providerStatus === "UNAVAILABLE" ? "DETERMINISTIC_WORKFLOW_COMPLETED" : "AGENT_COMPLETED",
        { goal: currentRun.goal },
        { finalStatus: currentRun.status, eligibilityStatus: state.overallEligibilityStatus },
        "AGENTIC-ORCHESTRATOR"
      );
    }

    // Execute CALL_TOOL
    const toolName = selectedDecision.toolName!;
    const { args, safeSummary, auditVersion } = buildToolArguments(toolName, state, selectedDecision);
    currentRun.status = "RUNNING_TOOL";
    currentRun.currentStep = `Calling tool: ${toolName}`;
    currentRun.lastToolCall = toolName;
    currentRun.lastDecision = selectedDecision;

    const toolResult = callTool(toolName, args);
    if (
      toolName === "evaluate_central_rules" ||
      toolName === "evaluate_childcare_rules" ||
      !currentRun.toolResult
    ) {
      currentRun.toolResult = toolResult;
    }
    if (toolName === "request_missing_field" || toolName === "request_human_confirmation") {
      currentRun.toolResult = toolResult;
    }

    if (
      toolName === "evaluate_central_rules" ||
      toolName === "evaluate_childcare_rules" ||
      toolName === "request_missing_field" ||
      toolName === "request_human_confirmation"
    ) {
      currentRun.stepsTaken += 1;
    }

    currentRun = appendAuditTrail(currentRun, "AGENT_TOOL_REQUESTED", { toolName }, undefined, auditVersion, "AGENT");
    currentRun = appendAuditTrail(currentRun, "AGENT_TOOL_COMPLETED", { toolName }, toolResult, auditVersion, "AGENT");

    updateStateFromToolResult(state, toolName, toolResult);

    // Check if tool execution triggered a human gate or review
    if (toolName === "detect_policy_conflict" && toolResult.status === "HUMAN_REVIEW_REQUIRED") {
      currentRun.status = "HUMAN_REVIEW_REQUIRED";
      currentRun.currentStep = "Policy conflict detected; human review required";
      currentRun.humanInputRequired = "請人工核對衝突的政策資料後再繼續。";
      syncRunStateSnapshot(currentRun, state);

      currentRun.trace.push({
        timestamp: new Date().toISOString(),
        runId: currentRun.runId,
        step: currentRun.stepsTaken,
        currentStateSummary: summarizeSafeState(
          currentRun.status,
          state.applicant,
          state.actualScenario,
          state.whatIfScenario,
          state.completedTools,
          state.requiredFields
        ),
        plannerProposal: proposalSnapshot,
        plannerReasoningSummary,
        selectedTool: toolName,
        toolArgumentsSafeSummary: safeSummary,
        validationResult: traceValidationResult(validation, rawEntry),
        proposalRejected: validation.proposalRejected,
        rejectionReason: validation.rejectionReason,
        toolResultSummary: toolResult.summary,
        coverageStatus: resolveTraceCoverageStatus(state),
        eligibilityStatus: "HUMAN_REVIEW_REQUIRED",
        humanGate: {
          triggered: true,
          question: currentRun.humanInputRequired,
        },
        fallbackUsed,
        provider: providerLabel,
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: currentRun.status,
      });

      return appendAuditTrail(
        currentRun,
        "HUMAN_REVIEW_REQUIRED",
        { toolName },
        toolResult,
        "CONFLICT-CHECK",
        "AGENT"
      );
    }

    const requiresChildcareHumanGate =
      toolName === "evaluate_childcare_rules" &&
      toolResult.status !== "FAIL" &&
      (toolResult.status === "UNCERTAIN" ||
        detectMissingFields(state.applicant, state.actualScenario, state.requiredFields).length > 0);

    // Canonical gate field for the post-tool Human Gate; undefined when every candidate is
    // already known, in which case no gate opens and the loop continues deterministically.
    const postToolGateField = selectAskableField(state.applicant, state.actualScenario, state.requiredFields, [
      (toolResult.result as { missingField?: SupportedMissingField } | undefined)?.missingField,
      ...detectMissingFields(state.applicant, state.actualScenario, state.requiredFields),
      state.domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome",
    ]);

    if (
      postToolGateField &&
      (toolName === "request_missing_field" ||
        toolName === "request_human_confirmation" ||
        requiresChildcareHumanGate ||
        (toolName === "evaluate_central_rules" &&
          (toolResult.status === "UNCERTAIN" ||
            detectMissingFields(state.applicant, state.actualScenario, state.requiredFields).length > 0)))
    ) {
      const missingField = postToolGateField;
      const question = gateQuestion(missingField, state.fieldQuestions);

      currentRun.status = "WAITING_FOR_HUMAN";
      currentRun.currentStep = "Deterministic result is uncertain and requires human input";
      currentRun.missingField = missingField;
      currentRun.humanInputRequired = question;
      currentRun.lastDecision = decideNextStep({
        goal: state.goal,
        domain: state.domain,
        applicant: state.applicant,
        actualScenario: state.actualScenario,
        requiredFields: state.requiredFields,
        lastToolResult: toolResult,
      });
      syncRunStateSnapshot(currentRun, state);

      currentRun.trace.push({
        timestamp: new Date().toISOString(),
        runId: currentRun.runId,
        step: currentRun.stepsTaken,
        currentStateSummary: summarizeSafeState(
          currentRun.status,
          state.applicant,
          state.actualScenario,
          state.whatIfScenario,
          state.completedTools,
          state.requiredFields
        ),
        plannerProposal: proposalSnapshot,
        plannerReasoningSummary,
        selectedTool: toolName,
        toolArgumentsSafeSummary: safeSummary,
        validationResult: traceValidationResult(validation, rawEntry),
        proposalRejected: validation.proposalRejected,
        rejectionReason: validation.rejectionReason,
        toolResultSummary: toolResult.summary,
        coverageStatus: resolveTraceCoverageStatus(state),
        eligibilityStatus: "UNCERTAIN",
        humanGate: {
          triggered: true,
          missingField,
          question,
          beforeState: summarizeSafeSnapshot(state.applicant, state.actualScenario),
        },
        fallbackUsed,
        provider: providerLabel,
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: currentRun.status,
      });

      return appendAuditTrail(
        currentRun,
        "AGENT_WAITING_FOR_HUMAN",
        { missingField },
        toolResult,
        state.domain === "CHILDCARE" ? "CHILDCARE-ALLOWANCE-115" : "CENTRAL-RENT-115",
        "AGENT"
      );
    }

    syncRunStateSnapshot(currentRun, state);
    currentRun.trace.push({
      timestamp: new Date().toISOString(),
      runId: currentRun.runId,
      step: currentRun.stepsTaken + loopIndex,
      currentStateSummary: summarizeSafeState(
        currentRun.status,
        state.applicant,
        state.actualScenario,
        state.whatIfScenario,
        state.completedTools,
        state.requiredFields
      ),
      plannerProposal: proposalSnapshot,
      plannerReasoningSummary,
      selectedTool: toolName,
      toolArgumentsSafeSummary: safeSummary,
      validationResult: traceValidationResult(validation, rawEntry),
      proposalRejected: validation.proposalRejected,
      rejectionReason: validation.rejectionReason,
      toolResultSummary: toolResult.summary,
      coverageStatus: resolveTraceCoverageStatus(state),
      eligibilityStatus: state.overallEligibilityStatus ?? toolResult.status,
      humanGate: null,
      fallbackUsed,
      provider: providerLabel,
      latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
      finalStatus: currentRun.status,
    });
  }

  currentRun.status = "FAILED";
  currentRun.errorCode = "MAX_AGENT_STEPS_EXCEEDED";
  currentRun.currentStep = "Maximum agent steps exceeded";
  syncRunStateSnapshot(currentRun, state);
  return appendAuditTrail(
    currentRun,
    "AGENT_FAILED",
    { limit: maxSteps },
    { errorCode: currentRun.errorCode },
    "AGENTIC-ORCHESTRATOR"
  );
}

export function runAgenticGoldenCase(
  goal: string,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario,
  plannerResult?: ProviderPlannerResult,
  options?: AgentLoopOptions
): AgentRun {
  const maxSteps = options?.maxSteps ?? MAX_AGENT_STEPS;
  let run = createAgentRun(goal, maxSteps, options?.runId);
  const coverage = assessQueryCoverage(goal);
  const domain: BenefitDomain =
    options?.domain ?? (coverage.domain === "CHILDCARE" ? "CHILDCARE" : "HOUSING");
  run.domain = domain;
  run.plan = buildSafePlan(goal, domain);
  run = appendAuditTrail(run, "AGENT_PLAN_CREATED", { goal, domain, plan: run.plan }, run.plan, "AGENTIC-PLAN");
  run.status = "PLANNING";
  run.currentStep = "Planning goal and allowed tools";

  const requiredFields = deriveRequiredFields(applicant, actualScenario, options?.requiredFields, domain);

  const fallbackDecision = decideNextStep({
    goal,
    domain,
    applicant,
    actualScenario,
    requiredFields,
  });
  const decision = plannerResult?.decision ?? fallbackDecision;
  run.lastDecision = decision;

  if (plannerResult) {
    run.providerStatus = plannerResult.providerStatus;
    for (const event of plannerResult.providerEvents ?? []) {
      run = appendAuditTrail(run, event.action, event.detail, undefined, "AGENT-PROVIDER", "SYSTEM");
    }
    run = appendAuditTrail(
      run,
      plannerResult.providerStatus === "AVAILABLE" && plannerResult.decision
        ? "AGENT_LLM_CALL_COMPLETED"
        : "AGENT_LLM_CALL_FAILED",
      { provider: plannerResult.provider, model: plannerResult.model },
      plannerResult.decision
        ? { decision: plannerResult.decision, usage: plannerResult.usage }
        : { error: plannerResult.error },
      "AGENTIC-PLANNER",
      plannerResult.providerStatus === "AVAILABLE" && plannerResult.decision ? "LLM" : "SYSTEM"
    );
  }

  if (coverage.status === "NOT_COVERED") {
    // Coverage boundary: no rental or childcare tool may answer an out-of-scope request,
    // and "not implemented" must never be phrased as "not eligible".
    run.status = "NOT_COVERED";
    run.coverage = coverage;
    run.currentStep = coverage.message;
    run.lastDecision = {
      reasoningSummary: "The request is outside the policies currently covered; no eligibility determination is made.",
      nextAction: "COMPLETE",
    };

    const proposalSnapshot = plannerResult?.decision
      ? {
          nextAction: plannerResult.decision.nextAction,
          toolName: plannerResult.decision.toolName,
        }
      : null;
    const rejectedByCoverage = Boolean(plannerResult?.decision && plannerResult.decision.nextAction === "CALL_TOOL");

    run.trace.push({
      timestamp: new Date().toISOString(),
      runId: run.runId,
      step: 1,
      currentStateSummary: summarizeSafeState(
        run.status,
        applicant,
        actualScenario,
        whatIfScenario,
        [],
        requiredFields
      ),
      plannerProposal: proposalSnapshot,
      plannerReasoningSummary: plannerResult?.decision?.reasoningSummary ?? null,
      selectedTool: null,
      toolArgumentsSafeSummary: null,
      validationResult: rejectedByCoverage ? "REJECTED" : "NOT_APPLICABLE",
      proposalRejected: rejectedByCoverage,
      rejectionReason: rejectedByCoverage ? `QUERY_OUTSIDE_COVERAGE: ${coverage.reason}` : null,
      toolResultSummary: coverage.message,
      coverageStatus: "NOT_COVERED",
      eligibilityStatus: "NOT_COVERED",
      humanGate: null,
      fallbackUsed: rejectedByCoverage,
      provider: plannerResult?.provider ?? "DETERMINISTIC",
      latencyMs: 0,
      finalStatus: "NOT_COVERED",
    });

    return appendAuditTrail(run, "AGENT_NOT_COVERED", { goal }, coverage, "COVERAGE-BOUNDARY", "SYSTEM");
  }

  run.coverage = coverage;

  const state: InternalExecutionState = {
    domain,
    goal,
    applicant: { ...applicant },
    actualScenario: { ...actualScenario },
    whatIfScenario: { ...whatIfScenario },
    requiredFields,
    completedTools: [],
    executedAtSignature: new Set<string>(),
    includePassport: options?.includePassport ?? false,
    caseId: caseIdOf(run),
    distinctWhatIf: domain === "HOUSING" && hasDistinctWhatIf(actualScenario, whatIfScenario, options?.whatIfMirrorsActual),
    fieldQuestions: options?.fieldQuestions,
    ruleOptions: {
      ...options?.ruleOptions,
      ...(isLocalOnlyHousingQuery(goal) ? { localOnly: true } : {}),
    },
  };
  if (domain === "HOUSING" && !state.distinctWhatIf) {
    run = appendAuditTrail(
      run,
      "WHAT_IF_NOT_DISTINCT",
      { actualCity: actualScenario.city ?? null },
      { evaluated: false, reason: "No distinct relocation / option-B scenario was defined." },
      "AGENTIC-PLAN",
      "SYSTEM"
    );
  }

  const proposals: Array<ProviderPlannerResult | Record<string, unknown> | null | undefined> =
    options?.plannerProposals ?? (plannerResult ? [plannerResult] : []);

  return executeBoundedSteps(run, state, proposals, maxSteps);
}

export function resumeAgentWithFieldResponse(
  run: AgentRun,
  field: SupportedMissingField,
  rawValue: unknown,
  actualScenarioOverride?: AddressScenario,
  whatIfScenarioOverride?: AddressScenario,
  options?: AgentLoopOptions
): AgentRun {
  const domain: BenefitDomain =
    options?.domain ?? run.domain ?? run.state?.domain ?? detectBenefitDomain(run.goal);
  const previousApplicant = run.state?.applicant ?? {};
  const previousActual = actualScenarioOverride ?? run.state?.actualScenario ?? {
    type: "ACTUAL",
    address: "新北市永和區合成測試地址",
    city: "新北市",
    district: "永和區",
    monthlyRent: 13500,
  };
  const previousWhatIf = whatIfScenarioOverride ?? run.state?.whatIfScenario ?? {
    type: "WHAT_IF",
    address: "臺北市文山區合成測試地址",
    city: "臺北市",
    district: "文山區",
    monthlyRent: 15500,
  };
  const requiredFields =
    run.state?.requiredFields ??
    deriveRequiredFields(previousApplicant, previousActual, options?.requiredFields, domain);
  const beforeState = summarizeSafeSnapshot(previousApplicant, previousActual);
  const question = run.humanInputRequired ?? getQuestionForMissingField(field);

  const validation = validateMissingFieldInput(field, rawValue);
  if (!validation.valid || validation.value === undefined) {
    const failedGateRun: AgentRun = {
      ...run,
      domain,
      status: "WAITING_FOR_HUMAN",
      currentStep: `Invalid input for ${field}: ${validation.error}`,
      missingField: field,
      humanInputRequired: question,
      errorCode: validation.error,
      trace: [
        ...run.trace,
        {
          timestamp: new Date().toISOString(),
          runId: run.runId,
          step: run.stepsTaken + 1,
          currentStateSummary: summarizeSafeState(
            "WAITING_FOR_HUMAN",
            previousApplicant,
            previousActual,
            previousWhatIf,
            run.state?.completedTools ?? [],
            requiredFields
          ),
          plannerProposal: null,
          plannerReasoningSummary: null,
          selectedTool: null,
          toolArgumentsSafeSummary: { field },
          validationResult: "REJECTED",
          proposalRejected: true,
          rejectionReason: validation.error ?? "INVALID_USER_INPUT",
          toolResultSummary: `User input rejected for ${field}`,
          coverageStatus: domain === "CHILDCARE" ? "COVERED" : assessCityCoverage(previousActual.city).status,
          eligibilityStatus: "UNCERTAIN",
          humanGate: {
            triggered: true,
            missingField: field,
            question,
            beforeState,
            userResponse: typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean" ? rawValue : String(rawValue),
            validatedUpdate: {
              field,
              value: null,
              valid: false,
              error: validation.error,
            },
            afterState: beforeState,
            nextPlannerAction: "ASK_HUMAN",
          },
          fallbackUsed: false,
          provider: "HUMAN_GATE",
          latencyMs: 0,
          finalStatus: "WAITING_FOR_HUMAN",
        },
      ],
    };
    return appendAuditTrail(
      failedGateRun,
      "AGENT_HUMAN_INPUT_INVALID",
      { field, error: validation.error },
      { valid: false },
      "HUMAN-GATE",
      "SYSTEM"
    );
  }

  const updated = applyValidatedFieldUpdate(previousApplicant, previousActual, field, validation.value);
  const afterState = summarizeSafeSnapshot(updated.applicant, updated.actualScenario);
  const nextRequiredFields = deriveRequiredFields(
    updated.applicant,
    updated.actualScenario,
    options?.requiredFields ?? run.state?.requiredFields,
    domain
  );
  const remainingMissing = detectMissingFields(updated.applicant, updated.actualScenario, nextRequiredFields);
  const evaluationToolName =
    domain === "CHILDCARE" ? "evaluate_childcare_rules" : "evaluate_central_rules";
  const nextPlannerAction =
    remainingMissing.length > 0 ? "ASK_HUMAN" : `CALL_TOOL:${evaluationToolName}`;

  let resumedRun: AgentRun = {
    ...run,
    domain,
    errorCode: undefined,
    trace: [
      ...run.trace,
      {
        timestamp: new Date().toISOString(),
        runId: run.runId,
        step: run.stepsTaken + 1,
        currentStateSummary: summarizeSafeState(
          "RESUMING",
          updated.applicant,
          updated.actualScenario,
          previousWhatIf,
          run.state?.completedTools ?? [],
          nextRequiredFields
        ),
        plannerProposal: { nextAction: "CALL_TOOL", toolName: evaluationToolName },
        plannerReasoningSummary: `Validated user update for ${field}; resuming deterministic evaluation.`,
        selectedTool: evaluationToolName,
        toolArgumentsSafeSummary: { updatedField: field },
        validationResult: "VALID",
        proposalRejected: false,
        rejectionReason: null,
        toolResultSummary: `State updated for ${field}`,
        coverageStatus: domain === "CHILDCARE" ? "COVERED" : assessCityCoverage(updated.actualScenario.city).status,
        eligibilityStatus: "UNCERTAIN",
        humanGate: {
          triggered: true,
          missingField: field,
          question,
          beforeState,
          userResponse: validation.value,
          validatedUpdate: {
            field,
            value: validation.value,
            valid: true,
          },
          afterState,
          nextPlannerAction,
        },
        fallbackUsed: false,
        provider: "HUMAN_GATE",
        latencyMs: 0,
        finalStatus: "RESUMING",
      },
    ],
  };

  resumedRun = resumeAgentRun(resumedRun, updated.applicant, updated.actualScenario, previousWhatIf, {
    ...options,
    domain,
    requiredFields: nextRequiredFields,
  });

  return resumedRun;
}

export function resumeAgentRun(
  run: AgentRun,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario,
  options?: AgentLoopOptions
): AgentRun {
  const domain: BenefitDomain =
    options?.domain ?? run.domain ?? run.state?.domain ?? detectBenefitDomain(run.goal);
  const beforeState = summarizeSafeSnapshot(run.state?.applicant ?? {}, run.state?.actualScenario ?? actualScenario);
  const afterState = summarizeSafeSnapshot(applicant, actualScenario);
  const defaultField: SupportedMissingField =
    domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome";
  const resolvedField = run.missingField ?? defaultField;
  const resolvedValue =
    resolvedField === "city"
      ? actualScenario.city
      : (applicant as Record<string, unknown>)[resolvedField];

  let nextRun: AgentRun = {
    ...run,
    domain,
    runId: run.runId ?? run.id,
    trace: [...(run.trace ?? [])],
    status: "RESUMING" as AgentStatus,
    currentStep: "Resuming after human confirmation",
    humanInputRequired: undefined,
    missingField: undefined,
    stepsTaken: run.stepsTaken + 1,
  };

  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_RESUMED",
    { applicant },
    { [resolvedField]: resolvedValue, ownsHome: applicant.ownsHome },
    "AGENTIC-ORCHESTRATOR",
    "AGENT"
  );

  const requiredFields = deriveRequiredFields(
    applicant,
    actualScenario,
    options?.requiredFields ?? run.state?.requiredFields,
    domain
  );
  const evaluationToolName =
    domain === "CHILDCARE" ? "evaluate_childcare_rules" : "evaluate_central_rules";

  // Record human gate resolution in trace if not already recorded by resumeAgentWithFieldResponse
  const hasResumeGateTrace = nextRun.trace.some(
    (entry) => entry.finalStatus === "RESUMING" && entry.humanGate?.validatedUpdate?.field === resolvedField
  );
  if (!hasResumeGateTrace) {
    nextRun.trace.push({
      timestamp: new Date().toISOString(),
      runId: nextRun.runId,
      step: nextRun.stepsTaken,
      currentStateSummary: summarizeSafeState(
        "RESUMING",
        applicant,
        actualScenario,
        whatIfScenario,
        [],
        requiredFields
      ),
      plannerProposal: { nextAction: "CALL_TOOL", toolName: evaluationToolName },
      plannerReasoningSummary: `Human confirmed ${resolvedField}; re-evaluating deterministic rules.`,
      selectedTool: evaluationToolName,
      toolArgumentsSafeSummary: { updatedField: resolvedField },
      validationResult: "VALID",
      proposalRejected: false,
      rejectionReason: null,
      toolResultSummary: `Human gate resolved for ${resolvedField}`,
      coverageStatus: domain === "CHILDCARE" ? "COVERED" : assessCityCoverage(actualScenario.city).status,
      eligibilityStatus: "UNCERTAIN",
      humanGate: {
        triggered: true,
        missingField: resolvedField,
        question: run.humanInputRequired ?? getQuestionForMissingField(resolvedField),
        beforeState,
        userResponse:
          typeof resolvedValue === "string" || typeof resolvedValue === "number" || typeof resolvedValue === "boolean"
            ? resolvedValue
            : String(resolvedValue ?? ""),
        validatedUpdate: {
          field: resolvedField,
          value: resolvedValue ?? null,
          valid: resolvedValue !== null && resolvedValue !== undefined,
        },
        afterState,
        nextPlannerAction: `CALL_TOOL:${evaluationToolName}`,
      },
      fallbackUsed: false,
      provider: "HUMAN_GATE",
      latencyMs: 0,
      finalStatus: "RESUMING",
    });
  }

  if (domain === "CHILDCARE") {
    const childcareResult = callTool("evaluate_childcare_rules", {
      profile: applicant,
      options: options?.ruleOptions,
    });
    nextRun.toolResult = childcareResult;
    nextRun.lastToolCall = "evaluate_childcare_rules";
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_REQUESTED",
      { toolName: "evaluate_childcare_rules" },
      undefined,
      "CHILDCARE-ALLOWANCE-115",
      "AGENT"
    );
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_COMPLETED",
      { toolName: "evaluate_childcare_rules" },
      childcareResult,
      "CHILDCARE-ALLOWANCE-115",
      "AGENT"
    );

    const remainingMissing = detectMissingFields(applicant, actualScenario, requiredFields);
    const childcareNextAsk = selectAskableField(applicant, actualScenario, requiredFields, remainingMissing[0] ?? "childAgeMonths");
    if (
      childcareNextAsk &&
      childcareResult.status !== "FAIL" &&
      (childcareResult.status === "UNCERTAIN" || remainingMissing.length > 0)
    ) {
      const nextMissing = childcareNextAsk;
      const question = gateQuestion(nextMissing, options?.fieldQuestions ?? run.state?.fieldQuestions);
      nextRun.status = "WAITING_FOR_HUMAN";
      nextRun.currentStep = "Childcare rules still have missing required fields";
      nextRun.missingField = nextMissing;
      nextRun.humanInputRequired = question;
      nextRun.state = {
        domain: "CHILDCARE",
        applicant: { ...applicant },
        actualScenario: { ...actualScenario },
        whatIfScenario: { ...whatIfScenario },
        requiredFields,
        completedTools: ["evaluate_childcare_rules"],
        childcareStatus: childcareResult.status as EligibilityStatus,
        overallEligibilityStatus: "UNCERTAIN",
      };
      return appendAuditTrail(
        nextRun,
        "AGENT_WAITING_FOR_HUMAN",
        { missingField: nextMissing },
        childcareResult,
        "CHILDCARE-ALLOWANCE-115",
        "AGENT"
      );
    }

    const childcareEval = childcareResult.result as ChildcareEvaluationResult;
    const evidenceResult = callTool("get_policy_evidence", {
      evaluations: childcareEval.evaluations,
    });
    nextRun.lastToolCall = "get_policy_evidence";
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_REQUESTED",
      { toolName: "get_policy_evidence" },
      undefined,
      "EVIDENCE-BINDING",
      "AGENT"
    );
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_COMPLETED",
      { toolName: "get_policy_evidence" },
      evidenceResult,
      "EVIDENCE-BINDING",
      "AGENT"
    );

    const passportResult = callTool("generate_childcare_passport", {
      caseId: caseIdOf(nextRun),
      profile: applicant,
      childcareResult: childcareEval,
      options: options?.ruleOptions,
    });
    nextRun.lastToolCall = "generate_childcare_passport";
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_REQUESTED",
      { toolName: "generate_childcare_passport" },
      undefined,
      "CHILDCARE-PASSPORT",
      "AGENT"
    );
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_COMPLETED",
      { toolName: "generate_childcare_passport" },
      passportResult,
      "CHILDCARE-PASSPORT",
      "AGENT"
    );

    nextRun.status = "COMPLETED";
    nextRun.currentStep = "Completed childcare evaluation after human input";
    nextRun.lastDecision = {
      reasoningSummary: "Missing childcare field was resolved by a human, and deterministic evaluation completed.",
      nextAction: "COMPLETE",
    };
    nextRun.state = {
      domain: "CHILDCARE",
      applicant: { ...applicant },
      actualScenario: { ...actualScenario },
      whatIfScenario: { ...whatIfScenario },
      requiredFields,
      completedTools: [
        "evaluate_childcare_rules",
        "get_policy_evidence",
        "generate_childcare_passport",
      ],
      childcareStatus: childcareResult.status as EligibilityStatus,
      overallEligibilityStatus: passportResult.status as EligibilityStatus,
    };

    nextRun.trace.push({
      timestamp: new Date().toISOString(),
      runId: nextRun.runId,
      step: nextRun.stepsTaken + 1,
      currentStateSummary: summarizeSafeState(
        "COMPLETED",
        applicant,
        actualScenario,
        whatIfScenario,
        nextRun.state.completedTools,
        requiredFields
      ),
      plannerProposal: { nextAction: "COMPLETE" },
      plannerReasoningSummary: nextRun.lastDecision.reasoningSummary,
      selectedTool: "generate_childcare_passport",
      toolArgumentsSafeSummary: { caseId: caseIdOf(nextRun) },
      validationResult: "VALID",
      proposalRejected: false,
      rejectionReason: null,
      toolResultSummary: passportResult.summary,
      coverageStatus: "COVERED",
      eligibilityStatus: passportResult.status as EligibilityStatus,
      humanGate: null,
      fallbackUsed: false,
      provider: "DETERMINISTIC",
      latencyMs: 0,
      finalStatus: "COMPLETED",
    });

    return appendAuditTrail(
      nextRun,
      "AGENT_COMPLETED",
      { goal: nextRun.goal },
      { status: nextRun.status, eligibilityStatus: passportResult.status },
      "AGENTIC-ORCHESTRATOR"
    );
  }

  const centralResult = callTool("evaluate_central_rules", {
    profile: applicant,
    options: options?.ruleOptions,
  });
  nextRun.toolResult = centralResult;
  nextRun.lastToolCall = "evaluate_central_rules";
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_REQUESTED",
    { toolName: "evaluate_central_rules" },
    undefined,
    "CENTRAL-RENT-115",
    "AGENT"
  );
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_COMPLETED",
    { toolName: "evaluate_central_rules" },
    centralResult,
    "CENTRAL-RENT-115",
    "AGENT"
  );

  const remainingMissing = detectMissingFields(applicant, actualScenario, requiredFields);
  const centralNextAsk = selectAskableField(applicant, actualScenario, requiredFields, remainingMissing[0] ?? "ownsHome");
  if (centralNextAsk && (centralResult.status === "UNCERTAIN" || remainingMissing.length > 0)) {
    const nextMissing = centralNextAsk;
    const question = gateQuestion(nextMissing, options?.fieldQuestions ?? run.state?.fieldQuestions);
    nextRun.status = "WAITING_FOR_HUMAN";
    nextRun.currentStep = "Central rules or required fields are still uncertain";
    nextRun.missingField = nextMissing;
    nextRun.humanInputRequired = question;
    nextRun.state = {
      domain: "HOUSING",
      applicant: { ...applicant },
      actualScenario: { ...actualScenario },
      whatIfScenario: { ...whatIfScenario },
      requiredFields,
      completedTools: ["evaluate_central_rules"],
      centralStatus: centralResult.status as EligibilityStatus,
      overallEligibilityStatus: "UNCERTAIN",
    };
    return appendAuditTrail(
      nextRun,
      "AGENT_WAITING_FOR_HUMAN",
      { missingField: nextMissing },
      centralResult,
      "CENTRAL-RENT-115",
      "AGENT"
    );
  }

  const actualResult = callTool("evaluate_actual_scenario", {
    profile: applicant,
    scenario: actualScenario,
    options: options?.ruleOptions,
  });
  nextRun.lastToolCall = "evaluate_actual_scenario";
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_REQUESTED",
    { toolName: "evaluate_actual_scenario" },
    undefined,
    "ACTUAL-SCENARIO",
    "AGENT"
  );
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_COMPLETED",
    { toolName: "evaluate_actual_scenario" },
    actualResult,
    "ACTUAL-SCENARIO"
  );

  const distinctWhatIf = hasDistinctWhatIf(actualScenario, whatIfScenario, options?.whatIfMirrorsActual);
  let whatIfResult: ToolExecutionResult;
  if (distinctWhatIf) {
    whatIfResult = callTool("evaluate_what_if_scenario", {
      profile: applicant,
      scenario: whatIfScenario,
      options: options?.ruleOptions,
    });
    nextRun.lastToolCall = "evaluate_what_if_scenario";
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_REQUESTED",
      { toolName: "evaluate_what_if_scenario" },
      undefined,
      "WHAT-IF-SCENARIO",
      "AGENT"
    );
    nextRun = appendAuditTrail(
      nextRun,
      "AGENT_TOOL_COMPLETED",
      { toolName: "evaluate_what_if_scenario" },
      whatIfResult,
      "WHAT-IF-SCENARIO"
    );
  } else {
    // No relocation / option B was defined: nothing to compare, so no second evaluation runs.
    whatIfResult = {
      ...actualResult,
      toolName: "evaluate_what_if_scenario",
      summary: "No distinct what-if scenario; not evaluated (mirrors the actual address).",
      result: mirrorAsWhatIf(actualResult.result as ScenarioResult),
    };
    nextRun = appendAuditTrail(
      nextRun,
      "WHAT_IF_NOT_DISTINCT",
      { actualCity: actualScenario.city ?? null },
      { evaluated: false, reason: "No distinct relocation / option-B scenario was defined." },
      "WHAT-IF-SCENARIO",
      "SYSTEM"
    );
  }

  const evidenceResult = callTool("get_policy_evidence", {
    evaluations: [
      ...((actualResult.result as { policyResults?: Array<{ evaluations?: unknown[] }> } | undefined)?.policyResults ?? [])
        .flatMap((policy) => policy.evaluations ?? []),
      ...(distinctWhatIf
        ? ((whatIfResult.result as { policyResults?: Array<{ evaluations?: unknown[] }> } | undefined)?.policyResults ?? [])
            .flatMap((policy) => policy.evaluations ?? [])
        : []),
    ],
  });
  nextRun.lastToolCall = "get_policy_evidence";
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_REQUESTED",
    { toolName: "get_policy_evidence" },
    undefined,
    "EVIDENCE-BINDING",
    "AGENT"
  );
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_COMPLETED",
    { toolName: "get_policy_evidence" },
    evidenceResult,
    "EVIDENCE-BINDING"
  );

  const passportResult = callTool("generate_decision_passport", {
    caseId: caseIdOf(nextRun),
    profile: applicant,
    actual: actualResult.result,
    whatIf: whatIfResult.result,
    options: options?.ruleOptions,
  });
  nextRun.lastToolCall = "generate_decision_passport";
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_REQUESTED",
    { toolName: "generate_decision_passport" },
    undefined,
    "DECISION-PASSPORT",
    "AGENT"
  );
  nextRun = appendAuditTrail(
    nextRun,
    "AGENT_TOOL_COMPLETED",
    { toolName: "generate_decision_passport" },
    passportResult,
    "DECISION-PASSPORT"
  );

  nextRun.status = "COMPLETED";
  nextRun.currentStep =
    nextRun.providerStatus === "UNAVAILABLE"
      ? "Deterministic safety workflow completed after human input (agent provider unavailable)"
      : "Completed after human input";
  nextRun.lastDecision = {
    reasoningSummary: "A missing field was resolved by a human, and deterministic evaluation resumed successfully.",
    nextAction: "COMPLETE",
  };
  nextRun.state = {
    domain: "HOUSING",
    applicant: { ...applicant },
    actualScenario: { ...actualScenario },
    whatIfScenario: { ...whatIfScenario },
    requiredFields,
    completedTools: [
      "evaluate_central_rules",
      "evaluate_actual_scenario",
      "evaluate_what_if_scenario",
      "get_policy_evidence",
      "generate_decision_passport",
    ],
    centralStatus: centralResult.status as EligibilityStatus,
    actualStatus: (actualResult.result as ScenarioResult).overallStatus,
    whatIfStatus: (whatIfResult.result as ScenarioResult).overallStatus,
    overallEligibilityStatus: passportResult.status as EligibilityStatus,
  };

  nextRun.trace.push({
    timestamp: new Date().toISOString(),
    runId: nextRun.runId,
    step: nextRun.stepsTaken + 1,
    currentStateSummary: summarizeSafeState(
      "COMPLETED",
      applicant,
      actualScenario,
      whatIfScenario,
      nextRun.state.completedTools,
      requiredFields
    ),
    plannerProposal: { nextAction: "COMPLETE" },
    plannerReasoningSummary: nextRun.lastDecision.reasoningSummary,
    selectedTool: "generate_decision_passport",
    toolArgumentsSafeSummary: { caseId: caseIdOf(nextRun) },
    validationResult: "VALID",
    proposalRejected: false,
    rejectionReason: null,
    toolResultSummary: passportResult.summary,
    coverageStatus: assessCityCoverage(actualScenario.city).status,
    eligibilityStatus: passportResult.status as EligibilityStatus,
    humanGate: null,
    fallbackUsed: false,
    provider: "DETERMINISTIC",
    latencyMs: 0,
    finalStatus: "COMPLETED",
  });

  return appendAuditTrail(
    nextRun,
    nextRun.providerStatus === "UNAVAILABLE" ? "DETERMINISTIC_WORKFLOW_COMPLETED" : "AGENT_COMPLETED",
    { goal: nextRun.goal },
    { status: nextRun.status, eligibilityStatus: passportResult.status },
    "AGENTIC-ORCHESTRATOR"
  );
}

export function runBoundedAgentLoop(
  goal: string,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario,
  options?: AgentLoopOptions
): AgentRun {
  const maxSteps = options?.maxSteps ?? MAX_AGENT_STEPS;
  let run = createAgentRun(goal, maxSteps, options?.runId);
  const domain = options?.domain ?? detectBenefitDomain(goal);
  const requiredFields = deriveRequiredFields(applicant, actualScenario, options?.requiredFields, domain);
  const completedTools: AgentToolName[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    run.stepsTaken = step + 1;
    const stepStartedAt = performance.now();
    const decision = decideNextStep({
      goal,
      domain,
      applicant,
      actualScenario,
      requiredFields,
      lastToolResult: run.toolResult,
    });

    run.lastDecision = decision;
    run.currentStep = `${step + 1}/${maxSteps}: ${decision.reasoningSummary}`;

    if (decision.nextAction === "ASK_HUMAN" && !options?.forceLoop) {
      const defaultField: SupportedMissingField =
        domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome";
      const missingField =
        selectAskableField(applicant, actualScenario, requiredFields, [decision.missingField, defaultField]) ?? defaultField;
      const question = decision.humanQuestion ?? getQuestionForMissingField(missingField);
      run.status = "WAITING_FOR_HUMAN";
      run.missingField = missingField;
      run.humanInputRequired = question;
      run.trace.push({
        timestamp: new Date().toISOString(),
        runId: run.runId,
        step: run.stepsTaken,
        currentStateSummary: summarizeSafeState(run.status, applicant, actualScenario, whatIfScenario, completedTools, requiredFields),
        plannerProposal: { nextAction: "ASK_HUMAN", missingField },
        plannerReasoningSummary: decision.reasoningSummary,
        selectedTool: "request_missing_field",
        toolArgumentsSafeSummary: { field: missingField },
        validationResult: "VALID",
        proposalRejected: false,
        rejectionReason: null,
        toolResultSummary: `Missing field: ${missingField}`,
        coverageStatus: domain === "CHILDCARE" ? "COVERED" : assessCityCoverage(actualScenario.city).status,
        eligibilityStatus: "UNCERTAIN",
        humanGate: {
          triggered: true,
          missingField,
          question,
          beforeState: summarizeSafeSnapshot(applicant, actualScenario),
        },
        fallbackUsed: false,
        provider: "DETERMINISTIC",
        latencyMs: Number((performance.now() - stepStartedAt).toFixed(3)),
        finalStatus: run.status,
      });
      return appendAuditTrail(run, "AGENT_WAITING_FOR_HUMAN", { step, missingField }, decision, "AGENTIC-ORCHESTRATOR");
    }

    if (decision.nextAction === "HUMAN_REVIEW_REQUIRED") {
      run.status = "HUMAN_REVIEW_REQUIRED";
      return appendAuditTrail(run, "HUMAN_REVIEW_REQUIRED", { step }, decision, "AGENTIC-ORCHESTRATOR");
    }

    if (decision.nextAction === "COMPLETE" && !options?.forceLoop) {
      run.status = "COMPLETED";
      run.currentStep = "Bounded loop completed";
      return appendAuditTrail(run, "AGENT_COMPLETED", { step }, decision, "AGENTIC-ORCHESTRATOR");
    }

    const evalTool: AgentToolName =
      domain === "CHILDCARE" ? "evaluate_childcare_rules" : "evaluate_central_rules";
    const toolResult = callTool(evalTool, { profile: applicant, options: options?.ruleOptions });
    run.toolResult = toolResult;
    run.lastToolCall = evalTool;
    if (!completedTools.includes(evalTool)) {
      completedTools.push(evalTool);
    }
    run = appendAuditTrail(
      run,
      "AGENT_TOOL_REQUESTED",
      { step, toolName: evalTool },
      toolResult,
      domain === "CHILDCARE" ? "CHILDCARE-ALLOWANCE-115" : "CENTRAL-RENT-115",
      "AGENT"
    );

    const missingAfter = detectMissingFields(applicant, actualScenario, requiredFields);
    const boundedAskField = selectAskableField(
      applicant,
      actualScenario,
      requiredFields,
      missingAfter[0] ?? (domain === "CHILDCARE" ? "childAgeMonths" : "ownsHome")
    );
    if (boundedAskField && (toolResult.status === "UNCERTAIN" || missingAfter.length > 0) && !options?.forceLoop) {
      const missingField = boundedAskField;
      run.status = "WAITING_FOR_HUMAN";
      run.missingField = missingField;
      run.humanInputRequired = getQuestionForMissingField(missingField);
      return appendAuditTrail(
        run,
        "AGENT_WAITING_FOR_HUMAN",
        { step, missingField },
        toolResult,
        domain === "CHILDCARE" ? "CHILDCARE-ALLOWANCE-115" : "CENTRAL-RENT-115",
        "AGENT"
      );
    }
  }

  run.status = "FAILED";
  run.errorCode = "MAX_AGENT_STEPS_EXCEEDED";
  run.currentStep = "Maximum agent steps exceeded";
  run.trace.push({
    timestamp: new Date().toISOString(),
    runId: run.runId,
    step: run.stepsTaken,
    currentStateSummary: summarizeSafeState(run.status, applicant, actualScenario, whatIfScenario, completedTools, requiredFields),
    plannerProposal: null,
    plannerReasoningSummary: "Maximum agent steps exceeded; aborting loop safely.",
    selectedTool: null,
    toolArgumentsSafeSummary: null,
    validationResult: "REJECTED",
    proposalRejected: true,
    rejectionReason: "MAX_AGENT_STEPS_EXCEEDED",
    toolResultSummary: "MAX_AGENT_STEPS_EXCEEDED",
    coverageStatus: domain === "CHILDCARE" ? "COVERED" : assessCityCoverage(actualScenario.city).status,
    eligibilityStatus: run.toolResult?.status ?? "UNCERTAIN",
    humanGate: null,
    fallbackUsed: true,
    provider: "DETERMINISTIC",
    latencyMs: 0,
    finalStatus: "FAILED",
  });
  return appendAuditTrail(run, "AGENT_FAILED", { limit: maxSteps }, { errorCode: run.errorCode }, "AGENTIC-ORCHESTRATOR");
}

export function getAvailableTools(): string[] {
  return listAllowedTools();
}

export {
  detectMissingFields,
  getQuestionForMissingField,
  isFieldMissing,
  validateMissingFieldInput,
  applyValidatedFieldUpdate,
};
