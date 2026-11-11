import type { CoverageAssessment } from "../coverage";

export type AgentStatus =
  | "IDLE"
  | "PLANNING"
  | "RUNNING_TOOL"
  | "WAITING_FOR_HUMAN"
  | "RESUMING"
  | "COMPLETED"
  | "FAILED"
  | "HUMAN_REVIEW_REQUIRED"
  | "NOT_COVERED";

export type AgentToolName =
  | "evaluate_central_rules"
  | "evaluate_actual_scenario"
  | "evaluate_what_if_scenario"
  | "detect_policy_conflict"
  | "generate_decision_passport"
  | "get_policy_evidence";

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

export type AgentRun = {
  id: string;
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
  providerStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  errorCode?: string;
  coverage?: CoverageAssessment;
  auditTrail: AgentAuditEvent[];
};
