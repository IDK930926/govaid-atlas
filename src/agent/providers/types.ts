import type { AgentDecision } from "../types";

export type ProviderName = "OLLAMA" | "OPENAI" | "UNAVAILABLE";
export type ProviderStatus = "AVAILABLE" | "UNAVAILABLE";
export type ProviderMode = "auto" | "openai" | "ollama";
export type RuntimeDisplayMode = "cloud" | "local" | "fallback";

export function getRuntimeDisplayMode(
  provider: ProviderName,
  available: boolean,
  fallbackActive = false
): RuntimeDisplayMode {
  if (!available || fallbackActive || provider === "UNAVAILABLE") {
    return "fallback";
  }
  return provider === "OPENAI" ? "cloud" : "local";
}

/**
 * Safe, enumerable provider failure classes. These are the only error strings that may
 * leave the server: raw provider bodies can echo request details (OpenAI 401 bodies echo a
 * masked API key), so they are never forwarded to the browser or written to audit.
 */
export type ProviderErrorClass =
  | "MISSING_API_KEY"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "BAD_REQUEST"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE"
  | "SCHEMA_INVALID"
  | "REFUSAL"
  | "MODEL_NOT_AVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_MODE";

export function classifyHttpStatus(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return "AUTH_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  if (status === 404) return "MODEL_NOT_AVAILABLE";
  return "BAD_REQUEST";
}

export function classifyThrownError(error: unknown): ProviderErrorClass {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "TIMEOUT";
  }
  return "NETWORK_ERROR";
}

export const PLANNER_SYSTEM_PROMPT =
  "You are the planning and tool-routing layer for GovAid Atlas. You do not determine eligibility. You may only choose from allowed tools. All policy eligibility status comes exclusively from deterministic tool results. Never convert UNCERTAIN into PASS or FAIL. Never invent policy evidence. For a housing request mentioning 雙北 without two distinct current and target cities, the input layer resolves the comparison to 臺北市 and 新北市 using the shared monthly rent; trust the supplied scenario values and do not ask the user to repeat them. If other required applicant data is missing, ask for human confirmation and include a non-empty humanQuestion. If policies conflict, request human review. Return only the required structured decision.";

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  localApiCost?: string;
};

/** One provider attempt inside a single planner request (auto mode may make two). */
export type ProviderAttempt = {
  provider: Exclude<ProviderName, "UNAVAILABLE">;
  model: string;
  /** True only when a request actually reached the provider's generation endpoint. */
  callAttempted: boolean;
  outcome: "COMPLETED" | "FAILED";
  latencyMs: number;
  errorClass?: ProviderErrorClass;
  usage?: ProviderUsage;
};

export type ProviderAuditEvent = {
  timestamp: string;
  action:
    | "AGENT_PROVIDER_SELECTED"
    | "AGENT_PROVIDER_CALL_STARTED"
    | "AGENT_PROVIDER_CALL_COMPLETED"
    | "AGENT_PROVIDER_CALL_FAILED"
    | "AGENT_MODEL_FALLBACK"
    | "AGENT_PROVIDER_FALLBACK"
    | "AGENT_PROVIDER_UNAVAILABLE";
  detail: {
    mode?: ProviderMode;
    provider?: ProviderName;
    model?: string;
    fromModel?: string;
    toModel?: string;
    from?: ProviderName;
    to?: ProviderName;
    latencyMs?: number;
    errorClass?: ProviderErrorClass;
    reason?: string;
  };
};

export type ProviderPlannerInput = {
  goal: string;
  availableTools: string[];
  structuredSchema?: unknown;
  timeoutMs?: number;
  /** Aborted by the client when this attempt's time budget expires, so the HTTP call stops too. */
  signal?: AbortSignal;
};

export type ProviderPlannerResult = {
  provider: ProviderName;
  providerStatus: ProviderStatus;
  model: string;
  callAttempted?: boolean;
  decision?: AgentDecision;
  usage?: ProviderUsage;
  error?: string;
  errorClass?: ProviderErrorClass;
  /** Populated by the provider chain in client.ts; absent on direct provider calls. */
  mode?: ProviderMode;
  attempts?: ProviderAttempt[];
  fallbackCount?: number;
  fallbackReason?: string | null;
  providerEvents?: ProviderAuditEvent[];
  /** Estimated cloud API cost in USD; null = unknown (shown as N/A), 0 = local only. */
  estimatedCloudCostUsd?: number | null;
  pricingLabel?: string | null;
};

export type ProviderHealth = {
  provider: ProviderName;
  providerStatus: ProviderStatus;
  model: string;
  error?: string;
  errorClass?: ProviderErrorClass;
  mode?: ProviderMode;
  fallbackActive?: boolean;
  fallbackReason?: string | null;
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
  "evaluate_childcare_rules",
  "detect_policy_conflict",
  "generate_decision_passport",
  "generate_childcare_passport",
  "get_policy_evidence",
  "request_missing_field",
  "request_human_confirmation",
  "complete",
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
