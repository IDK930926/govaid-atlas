import type { CoverageAssessment } from "../coverage";
import type { AddressScenario, ApplicantProfile, BenefitDomain, EligibilityStatus } from "../types";

export type AgentStatus =
  | "IDLE"
  | "PLANNING"
  | "RUNNING_TOOL"
  | "WAITING_FOR_HUMAN"
  | "RESUMING"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED"
  | "HUMAN_REVIEW_REQUIRED"
  | "NOT_COVERED";

export type AgentToolName =
  | "evaluate_central_rules"
  | "evaluate_actual_scenario"
  | "evaluate_what_if_scenario"
  | "evaluate_childcare_rules"
  | "detect_policy_conflict"
  | "generate_decision_passport"
  | "generate_childcare_passport"
  | "get_policy_evidence"
  | "request_missing_field"
  | "request_human_confirmation"
  | "complete";

export type SupportedMissingField =
  | "ownsHome"
  | "receivesOtherHousingAid"
  | "city"
  | "monthlyIncome"
  | "age"
  | "centralRentApproved"
  | "newTaipeiResidenceStudyWork"
  | "registeredCity"
  | "childAgeMonths"
  | "childHasBirthOrInitialHouseholdRegistration"
  | "receivesPublicOrQuasiPublicChildcare"
  | "isGovernmentPlaced"
  | "birthOrder"
  | "childRegisteredCity";

export type AgentDecisionAction =
  | "CALL_TOOL"
  | "ASK_HUMAN"
  | "COMPLETE"
  | "HUMAN_REVIEW_REQUIRED";

export type AgentDecision = {
  reasoningSummary: string;
  nextAction: AgentDecisionAction;
  toolName?: AgentToolName;
  toolArguments?: unknown;
  humanQuestion?: string;
  missingField?: SupportedMissingField;
};

export type ToolExecutionResult = {
  toolName: string;
  ok: boolean;
  status: "PASS" | "FAIL" | "UNCERTAIN" | "PARTIAL_CHECK" | "NOT_COVERED" | "HUMAN_REVIEW_REQUIRED";
  summary: string;
  result?: unknown;
};

export type AgentAuditEvent = {
  timestamp: string;
  actor: "USER" | "AGENT" | "RULE_ENGINE" | "SYSTEM" | "LLM";
  action: string;
  input?: unknown;
  output?: unknown;
  policyVersion?: string;
};

export type AgentTraceStateSummary = {
  status: string;
  knownFields: string[];
  missingFields: string[];
  actualCity?: string;
  whatIfCity?: string;
  completedTools: string[];
};

export type AgentTraceHumanGate = {
  triggered: boolean;
  missingField?: string;
  question?: string;
  beforeState?: Record<string, unknown>;
  userResponse?: string | number | boolean;
  validatedUpdate?: {
    field: string;
    value: unknown;
    valid: boolean;
    error?: string;
  };
  afterState?: Record<string, unknown>;
  nextPlannerAction?: string;
};

export type AgentTraceEvent = {
  timestamp: string;
  runId: string;
  step: number;
  currentStateSummary: AgentTraceStateSummary;
  plannerProposal: {
    nextAction?: string;
    toolName?: string;
    missingField?: string;
  } | null;
  plannerReasoningSummary: string | null;
  selectedTool: string | null;
  toolArgumentsSafeSummary: Record<string, unknown> | null;
  validationResult: "VALID" | "REJECTED" | "NOT_APPLICABLE";
  proposalRejected: boolean;
  rejectionReason: string | null;
  toolResultSummary: string | null;
  coverageStatus: "COVERED" | "NOT_COVERED" | "MISSING";
  eligibilityStatus: EligibilityStatus | "HUMAN_REVIEW_REQUIRED" | null;
  humanGate: AgentTraceHumanGate | null;
  fallbackUsed: boolean;
  provider: string;
  latencyMs: number;
  finalStatus: string;
};

export type AgentWorkflowState = {
  domain?: BenefitDomain;
  applicant: ApplicantProfile;
  actualScenario: AddressScenario;
  whatIfScenario: AddressScenario;
  requiredFields: SupportedMissingField[];
  completedTools: AgentToolName[];
  centralStatus?: EligibilityStatus;
  actualStatus?: EligibilityStatus;
  whatIfStatus?: EligibilityStatus;
  childcareStatus?: EligibilityStatus;
  overallEligibilityStatus?: EligibilityStatus | "HUMAN_REVIEW_REQUIRED";
};

export type AgentRun = {
  id: string;
  runId: string;
  domain?: BenefitDomain;
  status: AgentStatus;
  goal: string;
  currentStep: string;
  plan: string[];
  stepsTaken: number;
  maximumSteps: number;
  lastToolCall?: string;
  lastDecision?: AgentDecision;
  toolResult?: ToolExecutionResult;
  humanInputRequired?: string;
  missingField?: SupportedMissingField;
  providerStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  errorCode?: string;
  coverage?: CoverageAssessment;
  state?: AgentWorkflowState;
  auditTrail: AgentAuditEvent[];
  trace: AgentTraceEvent[];
};
