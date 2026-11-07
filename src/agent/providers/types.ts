import type { AgentDecision } from "../types";

export type ProviderName = "OLLAMA" | "OPENAI" | "UNAVAILABLE";
export type ProviderStatus = "AVAILABLE" | "UNAVAILABLE";

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  localApiCost?: string;
};

export type ProviderPlannerInput = {
  goal: string;
  availableTools: string[];
  structuredSchema?: unknown;
};

export type ProviderPlannerResult = {
  provider: ProviderName;
  providerStatus: ProviderStatus;
  model: string;
  decision?: AgentDecision;
  usage?: ProviderUsage;
  error?: string;
};

export type ProviderHealth = {
  provider: ProviderName;
  providerStatus: ProviderStatus;
  model: string;
  error?: string;
};

export type AgentModelProvider = {
  readonly name: ProviderName;
  readonly model: string;
  healthCheck(): Promise<ProviderHealth>;
  isConfigured(): boolean;
  callPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult>;
};

export const AGENT_DECISION_SCHEMA = {
  type: "object",
  properties: {
    reasoningSummary: { type: "string" },
    nextAction: {
      type: "string",
      enum: ["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"],
    },
    toolName: { type: "string" },
    toolArguments: { type: "object" },
    humanQuestion: { type: "string" },
  },
  required: ["reasoningSummary", "nextAction"],
  additionalProperties: false,
} as const;

export const ALLOWED_AGENT_TOOL_NAMES = [
  "evaluate_central_rules",
  "evaluate_actual_scenario",
  "evaluate_what_if_scenario",
  "detect_policy_conflict",
  "generate_decision_passport",
  "get_policy_evidence",
] as const;

export function validateStructuredAgentDecision(value: unknown): value is AgentDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  const decision = value as Record<string, unknown>;
  const nextAction = decision.nextAction;

  if (typeof decision.reasoningSummary !== "string") {
    return false;
  }

  if (typeof nextAction !== "string") {
    return false;
  }

  if (!["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"].includes(nextAction)) {
    return false;
  }

  if (decision.toolName !== undefined && typeof decision.toolName !== "string") {
    return false;
  }

  if (
    decision.toolName !== undefined &&
    !ALLOWED_AGENT_TOOL_NAMES.includes(decision.toolName as (typeof ALLOWED_AGENT_TOOL_NAMES)[number])
  ) {
    return false;
  }

  if (decision.toolArguments !== undefined && typeof decision.toolArguments !== "object") {
    return false;
  }

  if (decision.humanQuestion !== undefined && typeof decision.humanQuestion !== "string") {
    return false;
  }

  if (nextAction === "CALL_TOOL") {
    if (typeof decision.toolName !== "string") {
      return false;
    }
  }

  if (nextAction === "ASK_HUMAN") {
    if (typeof decision.humanQuestion !== "string" || !decision.humanQuestion.trim()) {
      return false;
    }
  }

  return true;
}
