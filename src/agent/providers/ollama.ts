import type { AgentDecision } from "../types";
import {
  AGENT_DECISION_SCHEMA,
  type AgentModelProvider,
  type ProviderHealth,
  type ProviderPlannerInput,
  type ProviderPlannerResult,
  validateStructuredAgentDecision,
  PLANNER_SYSTEM_PROMPT,
  classifyHttpStatus,
  classifyThrownError,
} from "./types";
import { getProviderChain } from "./mode";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";
// Local daemon: a reachable /api/tags answers in milliseconds, so a short health cap is safe.
const DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS = 2_000;
// Defensive ceiling only; the client aborts each attempt at its own (<=) budget. See client.ts.
const DEFAULT_OLLAMA_TIMEOUT_MS = 8_000;

function getEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }

  return process.env;
}

export function getOllamaBaseUrl(): string {
  return getEnv().OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
}

export function getOllamaModel(): string {
  return getEnv().OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getOllamaTimeoutMs(): number {
  return positiveInt(getEnv().OLLAMA_TIMEOUT_MS, DEFAULT_OLLAMA_TIMEOUT_MS);
}

export function getOllamaHealthTimeoutMs(): number {
  return positiveInt(getEnv().OLLAMA_HEALTH_TIMEOUT_MS, DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS);
}

/** True when the configured AGENT_PROVIDER chain (mode.ts, default auto) includes Ollama. */
export function isOllamaConfigured(): boolean {
  return getProviderChain().includes("OLLAMA");
}

export async function healthCheckOllama(signal?: AbortSignal): Promise<ProviderHealth> {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();

  try {
    const timeout = AbortSignal.timeout(getOllamaHealthTimeoutMs());
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: `OLLAMA_PROVIDER_UNAVAILABLE: ${response.status}`,
        errorClass: "PROVIDER_UNAVAILABLE",
      };
    }

    const json = (await response.json()) as { models?: Array<{ name?: string }> };
    const modelNames = (json.models ?? []).map((entry) => entry.name ?? "").filter(Boolean);
    const hasModel = modelNames.some((name) => name === model || name.startsWith(`${model}:`) || name === `${model}.gguf`);

    if (!hasModel) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: "OLLAMA_MODEL_NOT_AVAILABLE",
        errorClass: "MODEL_NOT_AVAILABLE",
      };
    }

    return {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model,
    };
  } catch (error) {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      error: error instanceof Error ? `OLLAMA_PROVIDER_UNAVAILABLE: ${error.message}` : "OLLAMA_PROVIDER_UNAVAILABLE",
      errorClass: classifyThrownError(error) === "TIMEOUT" ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
    };
  }
}

export async function callOllamaPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();

  const health = await healthCheckOllama(input.signal);
  if (health.providerStatus !== "AVAILABLE") {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      error: health.error ?? "AGENT_PROVIDER_UNAVAILABLE",
      errorClass: health.errorClass ?? "PROVIDER_UNAVAILABLE",
    };
  }

  const schema = (input.structuredSchema as Record<string, unknown>) ?? AGENT_DECISION_SCHEMA;
  const payload = {
    model,
    stream: false,
    format: schema,
    options: {
      temperature: 0,
      num_predict: 512,
    },
    think: false,
    messages: [
      {
        role: "system",
        content: PLANNER_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Goal: ${input.goal}. Available tools: ${input.availableTools.join(", ")}. Return only a valid decision that follows the required schema.`,
      },
    ],
  };

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(getOllamaTimeoutMs())])
        : AbortSignal.timeout(getOllamaTimeoutMs()),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: `OLLAMA_REQUEST_FAILED: ${response.status} ${text}`,
        errorClass: classifyHttpStatus(response.status),
      };
    }

    const json = (await response.json()) as {
      message?: { content?: string | { text?: string } };
      done?: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const contentValue = json.message?.content;
    const contentText =
      typeof contentValue === "string"
        ? contentValue
        : contentValue && typeof contentValue === "object"
          ? contentValue.text ?? "{}"
          : "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(contentText);
    } catch {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "OLLAMA_DECISION_PARSE_FAILED",
        errorClass: "MALFORMED_RESPONSE",
      };
    }

    if (!validateStructuredAgentDecision(parsed)) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "AGENT_DECISION_SCHEMA_INVALID",
        errorClass: "SCHEMA_INVALID",
      };
    }

    return {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model,
      callAttempted: true,
      decision: parsed as AgentDecision,
      usage: {
        inputTokens: typeof json.prompt_eval_count === "number" ? json.prompt_eval_count : undefined,
        outputTokens: typeof json.eval_count === "number" ? json.eval_count : undefined,
        totalTokens:
          typeof json.prompt_eval_count === "number" && typeof json.eval_count === "number"
            ? json.prompt_eval_count + json.eval_count
            : undefined,
        localApiCost: "$0",
      },
    };
  } catch (error) {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      callAttempted: true,
      error: error instanceof Error ? `OLLAMA_REQUEST_ERROR: ${error.message}` : "AGENT_PROVIDER_UNAVAILABLE",
      errorClass: classifyThrownError(error),
    };
  }
}

export const ollamaProvider: AgentModelProvider = {
  name: "OLLAMA",
  get model() {
    return getOllamaModel();
  },
  isConfigured: () => isOllamaConfigured(),
  healthCheck: async () => healthCheckOllama(),
  callPlanner: async (input) => callOllamaPlanner(input),
};
