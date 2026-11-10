import type { AgentDecision } from "../types";
import {
  ALLOWED_AGENT_TOOL_NAMES,
  PLANNER_SYSTEM_PROMPT,
  type AgentModelProvider,
  type ProviderErrorClass,
  type ProviderHealth,
  type ProviderPlannerInput,
  type ProviderPlannerResult,
  classifyHttpStatus,
  classifyThrownError,
  validateStructuredAgentDecision,
} from "./types";

const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_TIMEOUT_MS = 20_000;
const DEFAULT_OPENAI_HEALTH_TIMEOUT_MS = 5_000;
const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI Structured Outputs (strict) schema for AgentDecision. Strict mode requires every
 * property to be listed in `required` and `additionalProperties: false`, so optional fields
 * are expressed as nullable. `toolArguments` is intentionally absent: the deterministic
 * orchestrator supplies tool arguments from server/UI state, so the model can never invent
 * applicant fields. Output is still re-validated at runtime by validateStructuredAgentDecision.
 */
export const OPENAI_AGENT_DECISION_SCHEMA = {
  type: "object",
  properties: {
    reasoningSummary: { type: "string" },
    nextAction: {
      type: "string",
      enum: ["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"],
    },
    toolName: { type: ["string", "null"], enum: [...ALLOWED_AGENT_TOOL_NAMES, null] },
    humanQuestion: { type: ["string", "null"] },
  },
  required: ["reasoningSummary", "nextAction", "toolName", "humanQuestion"],
  additionalProperties: false,
} as const;

function getEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }

  return process.env;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getOpenAIModel(): string {
  return getEnv().OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function getOpenAITimeoutMs(): number {
  return positiveInt(getEnv().OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS);
}

/** True when a key is present. Provider-mode selection lives in client.ts. */
export function isOpenAIConfigured(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY?.trim());
}

function failure(
  model: string,
  errorClass: ProviderErrorClass,
  callAttempted: boolean,
  extra?: Partial<ProviderPlannerResult>
): ProviderPlannerResult {
  return {
    provider: "OPENAI",
    providerStatus: "UNAVAILABLE",
    model,
    callAttempted,
    error: `OPENAI_${errorClass}`,
    errorClass,
    ...extra,
  };
}

function healthFailure(model: string, errorClass: ProviderErrorClass): ProviderHealth {
  return { provider: "OPENAI", providerStatus: "UNAVAILABLE", model, error: `OPENAI_${errorClass}`, errorClass };
}

/** Reachability + key + model-access check (GET /models/{model}); bills no tokens. */
export async function healthCheckOpenAI(): Promise<ProviderHealth> {
  const model = getOpenAIModel();
  const apiKey = getEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return healthFailure(model, "MISSING_API_KEY");
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/models/${encodeURIComponent(model)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(positiveInt(getEnv().OPENAI_HEALTH_TIMEOUT_MS, DEFAULT_OPENAI_HEALTH_TIMEOUT_MS)),
    });
    await response.text().catch(() => undefined);
    if (!response.ok) {
      return healthFailure(model, classifyHttpStatus(response.status));
    }
    return { provider: "OPENAI", providerStatus: "AVAILABLE", model };
  } catch (error) {
    return healthFailure(model, classifyThrownError(error));
  }
}

type ResponsesApiBody = {
  status?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

export async function callOpenAIPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const apiKey = getEnv().OPENAI_API_KEY?.trim();
  const model = getOpenAIModel();

  if (!apiKey) {
    return failure(model, "MISSING_API_KEY", false);
  }

  const toolList = input.availableTools.filter((tool) =>
    (ALLOWED_AGENT_TOOL_NAMES as readonly string[]).includes(tool)
  );

  // Responses API + strict Structured Outputs. No function tools are sent: the orchestrator
  // executes the allowlisted deterministic tools itself, so no parallel tool calls can occur.
  const payload = {
    model,
    instructions: PLANNER_SYSTEM_PROMPT,
    input: `Goal: ${input.goal}\nAvailable tools: ${toolList.join(", ")}\nReturn only a valid decision that follows the required schema. Use null for toolName or humanQuestion when not applicable.`,
    text: {
      format: {
        type: "json_schema",
        name: "agent_decision",
        strict: true,
        schema: OPENAI_AGENT_DECISION_SCHEMA,
      },
    },
    reasoning: { effort: getEnv().OPENAI_REASONING_EFFORT?.trim() || "low" },
    max_output_tokens: 2048,
    store: false,
  };

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(getOpenAITimeoutMs()),
    });
  } catch (error) {
    return failure(model, classifyThrownError(error), true);
  }

  if (!response.ok) {
    // Drain and discard: error bodies can echo request details (e.g. a masked key).
    await response.text().catch(() => undefined);
    return failure(model, classifyHttpStatus(response.status), true);
  }

  let json: ResponsesApiBody;
  try {
    json = (await response.json()) as ResponsesApiBody;
  } catch (error) {
    return failure(model, classifyThrownError(error) === "TIMEOUT" ? "TIMEOUT" : "MALFORMED_RESPONSE", true);
  }

  const usage = {
    inputTokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : undefined,
    outputTokens: typeof json.usage?.output_tokens === "number" ? json.usage.output_tokens : undefined,
    totalTokens: typeof json.usage?.total_tokens === "number" ? json.usage.total_tokens : undefined,
  };

  const parts = (json.output ?? []).flatMap((item) =>
    item.type === undefined || item.type === "message" ? item.content ?? [] : []
  );
  if (parts.some((part) => part.type === "refusal")) {
    return failure(model, "REFUSAL", true, { usage });
  }
  const textPayload = parts.find((part) => part.type === "output_text")?.text;
  if ((json.status && json.status !== "completed") || typeof textPayload !== "string") {
    return failure(model, "MALFORMED_RESPONSE", true, { usage });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    return failure(model, "MALFORMED_RESPONSE", true, { usage });
  }

  // Strict schema uses null for "not applicable"; AgentDecision uses undefined.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const key of ["toolName", "humanQuestion"]) {
      if (record[key] === null) delete record[key];
    }
  }

  if (!validateStructuredAgentDecision(parsed)) {
    return failure(model, "SCHEMA_INVALID", true, { usage });
  }

  return {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model,
    callAttempted: true,
    decision: parsed as AgentDecision,
    usage,
  };
}

export const openaiProvider: AgentModelProvider = {
  name: "OPENAI",
  get model() {
    return getOpenAIModel();
  },
  isConfigured: () => isOpenAIConfigured(),
  healthCheck: async () => healthCheckOpenAI(),
  callPlanner: async (input) => callOpenAIPlanner(input),
};
