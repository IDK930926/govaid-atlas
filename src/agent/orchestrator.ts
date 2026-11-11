import type { ApplicantProfile, AddressScenario } from "../types";
import { callTool, listAllowedTools } from "./tools";
import { assessQueryCoverage } from "../coverage";
import { validateStructuredAgentDecision } from "./providers/types";
import type { AgentDecision, AgentRun, AgentStatus, ToolExecutionResult } from "./types";
import type { ProviderPlannerResult } from "./providers/types";

export const MAX_AGENT_STEPS = 8;

export function buildSafePlan(goal: string): string[] {
  return [
    "Check central rental rules",
    "Resolve missing applicant fields",
    "Evaluate ACTUAL scenario",
    "Evaluate WHAT-IF scenario",
    "Check policy evidence",
    "Generate Decision Passport",
  ].map((step, index) => `${index + 1}. ${step} — ${goal}`);
}

export function createAgentRun(goal: string): AgentRun {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    status: "IDLE",
    goal,
    currentStep: "Awaiting goal input",
    plan: buildSafePlan(goal),
    stepsTaken: 0,
    maximumSteps: MAX_AGENT_STEPS,
    providerStatus: "UNKNOWN",
    auditTrail: [
      {
        timestamp: new Date().toISOString(),
        actor: "SYSTEM",
        action: "AGENT_RUN_STARTED",
        input: { goal },
      },
    ],
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

export function decideNextStep(context: {
  goal: string;
  applicant: ApplicantProfile;
  lastToolResult?: ToolExecutionResult;
  conflictStatus?: "CLEAR" | "CONFLICT";
}): AgentDecision {
  if (context.conflictStatus === "CONFLICT") {
    return {
      reasoningSummary: "A policy conflict was found; the system must stop and ask for human review.",
      nextAction: "HUMAN_REVIEW_REQUIRED",
      humanQuestion: "請人工核對衝突的政策資料後再繼續。",
    };
  }

  if (context.applicant.ownsHome === null) {
    return {
      reasoningSummary: "Central rules still need ownership status before the rule engine can determine eligibility.",
      nextAction: "ASK_HUMAN",
      humanQuestion: "本人是否持有住宅？",
    };
  }

  if (context.lastToolResult && context.lastToolResult.status === "UNCERTAIN") {
    return {
      reasoningSummary: "The deterministic engine remains uncertain and cannot be upgraded to PASS by the agent.",
      nextAction: "ASK_HUMAN",
      humanQuestion: "請補充缺少的個人或政策資訊，再由 deterministic engine 重新評估。",
    };
  }

  if (context.lastToolResult?.status === "HUMAN_REVIEW_REQUIRED") {
    return {
      reasoningSummary: "The policy engine requires human review for a conflict or blocked decision.",
      nextAction: "HUMAN_REVIEW_REQUIRED",
      humanQuestion: "請人工審核政策衝突或未決條件。",
    };
  }

  return {
    reasoningSummary: "Deterministic engine output is ready for the next step in the workflow.",
    nextAction: "COMPLETE",
  };
}

export function runAgenticGoldenCase(
  goal: string,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario,
  plannerResult?: ProviderPlannerResult
): AgentRun {
  let run = createAgentRun(goal);
  run = appendAuditTrail(run, "AGENT_PLAN_CREATED", { goal, plan: run.plan }, run.plan, "AGENTIC-PLAN");
  run.status = "PLANNING";
  run.currentStep = "Planning goal and allowed tools";

  const fallbackDecision = decideNextStep({
    goal,
    applicant,
  });
  const decision = plannerResult?.decision ?? fallbackDecision;
  run.lastDecision = decision;
  if (plannerResult) {
    run.providerStatus = plannerResult.providerStatus;
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

  const coverage = assessQueryCoverage(goal);
  if (coverage.status === "NOT_COVERED") {
    // Coverage boundary: no rental tool may answer an out-of-scope request,
    // and "not implemented" must never be phrased as "not eligible".
    run.status = "NOT_COVERED";
    run.coverage = coverage;
    run.currentStep = coverage.message;
    run.lastDecision = {
      reasoningSummary: "The request is outside the policies currently covered; no eligibility determination is made.",
      nextAction: "COMPLETE",
    };
    return appendAuditTrail(run, "AGENT_NOT_COVERED", { goal }, coverage, "COVERAGE-BOUNDARY", "SYSTEM");
  }

  const toolName = "evaluate_central_rules" as const;
  run.status = "RUNNING_TOOL";
  run.currentStep = `Calling tool: ${toolName}`;
  run.lastToolCall = toolName;

  const toolResult = callTool(toolName, { profile: applicant });
  run.toolResult = toolResult;
  run.stepsTaken += 1;
  run = appendAuditTrail(run, "AGENT_TOOL_REQUESTED", { toolName }, undefined, "CENTRAL-RENT-115", "AGENT");
  run = appendAuditTrail(run, "AGENT_TOOL_COMPLETED", { toolName }, toolResult, "CENTRAL-RENT-115", "AGENT");

  if (toolResult.status === "UNCERTAIN") {
    run.status = "WAITING_FOR_HUMAN";
    run.currentStep = "Deterministic result is uncertain and requires human input";
    run.humanInputRequired = "本人是否持有住宅？";
    run.lastDecision = decideNextStep({ goal, applicant, lastToolResult: toolResult });
    run = appendAuditTrail(run, "AGENT_WAITING_FOR_HUMAN", { missingField: "ownsHome" }, toolResult, "CENTRAL-RENT-115", "AGENT");
    return run;
  }

  const scenarioTool = callTool("evaluate_actual_scenario", {
    profile: applicant,
    scenario: actualScenario,
  });
  run.lastToolCall = "evaluate_actual_scenario";
  run = appendAuditTrail(run, "AGENT_TOOL_REQUESTED", { toolName: "evaluate_actual_scenario" }, undefined, "ACTUAL-SCENARIO");
  run = appendAuditTrail(run, "AGENT_TOOL_COMPLETED", { toolName: "evaluate_actual_scenario" }, scenarioTool, "ACTUAL-SCENARIO");

  const whatIfTool = callTool("evaluate_what_if_scenario", {
    profile: applicant,
    scenario: whatIfScenario,
  });
  run.lastToolCall = "evaluate_what_if_scenario";
  run = appendAuditTrail(run, "AGENT_TOOL_REQUESTED", { toolName: "evaluate_what_if_scenario" }, undefined, "WHAT-IF-SCENARIO");
  run = appendAuditTrail(run, "AGENT_TOOL_COMPLETED", { toolName: "evaluate_what_if_scenario" }, whatIfTool, "WHAT-IF-SCENARIO");

  const evidenceTool = callTool("get_policy_evidence", {
    evaluations: [
      ...(toolResult.result as { evaluations?: unknown[] } | undefined)?.evaluations ?? [],
    ],
  });
  run.lastToolCall = "get_policy_evidence";
  run = appendAuditTrail(run, "AGENT_TOOL_REQUESTED", { toolName: "get_policy_evidence" }, undefined, "EVIDENCE-BINDING");
  run = appendAuditTrail(run, "AGENT_TOOL_COMPLETED", { toolName: "get_policy_evidence" }, evidenceTool, "EVIDENCE-BINDING");

  run.status = "COMPLETED";
  run.currentStep = "Golden case flow completed";
  run = appendAuditTrail(run, "AGENT_COMPLETED", { goal }, { finalStatus: run.status }, "AGENTIC-ORCHESTRATOR");

  return run;
}

export function resumeAgentRun(
  run: AgentRun,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario
): AgentRun {
  let nextRun: AgentRun = {
    ...run,
    status: "RESUMING" as AgentStatus,
    currentStep: "Resuming after human confirmation",
    humanInputRequired: undefined,
    stepsTaken: run.stepsTaken + 1,
  };

  nextRun = appendAuditTrail(nextRun, "AGENT_RESUMED", { applicant }, { ownsHome: applicant.ownsHome }, "AGENTIC-ORCHESTRATOR", "AGENT");

  const centralResult = callTool("evaluate_central_rules", { profile: applicant });
  nextRun.toolResult = centralResult;
  nextRun.lastToolCall = "evaluate_central_rules";
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_REQUESTED", { toolName: "evaluate_central_rules" }, undefined, "CENTRAL-RENT-115", "AGENT");
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_COMPLETED", { toolName: "evaluate_central_rules" }, centralResult, "CENTRAL-RENT-115", "AGENT");

  if (centralResult.status === "UNCERTAIN") {
    nextRun.status = "WAITING_FOR_HUMAN";
    nextRun.currentStep = "Central rules are still uncertain";
    nextRun.humanInputRequired = "請補充必要資料後再嘗試。";
    return appendAuditTrail(nextRun, "AGENT_WAITING_FOR_HUMAN", { missingField: "ownsHome" }, centralResult, "CENTRAL-RENT-115", "AGENT");
  }

  const actualResult = callTool("evaluate_actual_scenario", {
    profile: applicant,
    scenario: actualScenario,
  });
  nextRun.lastToolCall = "evaluate_actual_scenario";
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_REQUESTED", { toolName: "evaluate_actual_scenario" }, undefined, "ACTUAL-SCENARIO", "AGENT");
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_COMPLETED", { toolName: "evaluate_actual_scenario" }, actualResult, "ACTUAL-SCENARIO");

  const whatIfResult = callTool("evaluate_what_if_scenario", {
    profile: applicant,
    scenario: whatIfScenario,
  });
  nextRun.lastToolCall = "evaluate_what_if_scenario";
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_REQUESTED", { toolName: "evaluate_what_if_scenario" }, undefined, "WHAT-IF-SCENARIO", "AGENT");
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_COMPLETED", { toolName: "evaluate_what_if_scenario" }, whatIfResult, "WHAT-IF-SCENARIO");

  const evidenceResult = callTool("get_policy_evidence", {
    evaluations: [
      ...((actualResult.result as { policyResults?: Array<{ evaluations?: unknown[] }> } | undefined)?.policyResults ?? [])
        .flatMap((policy) => policy.evaluations ?? []),
      ...((whatIfResult.result as { policyResults?: Array<{ evaluations?: unknown[] }> } | undefined)?.policyResults ?? [])
        .flatMap((policy) => policy.evaluations ?? []),
    ],
  });
  nextRun.lastToolCall = "get_policy_evidence";
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_REQUESTED", { toolName: "get_policy_evidence" }, undefined, "EVIDENCE-BINDING", "AGENT");
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_COMPLETED", { toolName: "get_policy_evidence" }, evidenceResult, "EVIDENCE-BINDING");

  const passportResult = callTool("generate_decision_passport", {
    caseId: "CASE-P0-001",
    profile: applicant,
    actual: actualResult.result,
    whatIf: whatIfResult.result,
  });
  nextRun.lastToolCall = "generate_decision_passport";
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_REQUESTED", { toolName: "generate_decision_passport" }, undefined, "DECISION-PASSPORT", "AGENT");
  nextRun = appendAuditTrail(nextRun, "AGENT_TOOL_COMPLETED", { toolName: "generate_decision_passport" }, passportResult, "DECISION-PASSPORT");

  nextRun.status = "COMPLETED";
  nextRun.currentStep = "Completed after human input";
  nextRun.lastDecision = {
    reasoningSummary: "A missing field was resolved by a human, and deterministic evaluation resumed successfully.",
    nextAction: "COMPLETE",
  };
  return appendAuditTrail(nextRun, "AGENT_COMPLETED", { goal: nextRun.goal }, { status: nextRun.status }, "AGENTIC-ORCHESTRATOR");
}

export function runBoundedAgentLoop(
  goal: string,
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  whatIfScenario: AddressScenario,
  options?: { forceLoop?: boolean }
): AgentRun {
  let run = createAgentRun(goal);

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    run.stepsTaken = step + 1;
    const decision = decideNextStep({
      goal,
      applicant,
      lastToolResult: run.toolResult,
    });

    run.lastDecision = decision;
    run.currentStep = `${step + 1}/${MAX_AGENT_STEPS}: ${decision.reasoningSummary}`;

    if (decision.nextAction === "ASK_HUMAN" && !options?.forceLoop) {
      run.status = "WAITING_FOR_HUMAN";
      run.humanInputRequired = decision.humanQuestion ?? "Please provide missing information.";
      return appendAuditTrail(run, "AGENT_WAITING_FOR_HUMAN", { step }, decision, "AGENTIC-ORCHESTRATOR");
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

    const toolResult = callTool("evaluate_central_rules", { profile: applicant });
    run.toolResult = toolResult;
    run.lastToolCall = "evaluate_central_rules";
    run = appendAuditTrail(run, "AGENT_TOOL_REQUESTED", { step, toolName: "evaluate_central_rules" }, toolResult, "CENTRAL-RENT-115", "AGENT");

    if (toolResult.status === "UNCERTAIN" && applicant.ownsHome === null && !options?.forceLoop) {
      run.status = "WAITING_FOR_HUMAN";
      run.humanInputRequired = "本人是否持有住宅";
      return appendAuditTrail(run, "AGENT_WAITING_FOR_HUMAN", { step, missingField: "ownsHome" }, toolResult, "CENTRAL-RENT-115", "AGENT");
    }
  }

  run.status = "FAILED";
  run.errorCode = "MAX_AGENT_STEPS_EXCEEDED";
  run.currentStep = "Maximum agent steps exceeded";
  return appendAuditTrail(run, "AGENT_FAILED", { limit: MAX_AGENT_STEPS }, { errorCode: run.errorCode }, "AGENTIC-ORCHESTRATOR");
}

export function getAvailableTools(): string[] {
  return listAllowedTools();
}
