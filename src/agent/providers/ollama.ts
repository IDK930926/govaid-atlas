import type { AgentDecision } from "../types";
import {
  AGENT_DECISION_SCHEMA,
  type AgentModelProvider,
  type ProviderHealth,
  type ProviderPlannerInput,
  type ProviderPlannerResult,
  validateStructuredAgentDecision,
} from "./types";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";

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

export function isOllamaConfigured(): boolean {
  return (getEnv().AGENT_PROVIDER ?? "ollama").toLowerCase() === "ollama" || Boolean(getEnv().OLLAMA_MODEL);
}

export async function healthCheckOllama(): Promise<ProviderHealth> {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET" });
    if (!response.ok) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: `OLLAMA_PROVIDER_UNAVAILABLE: ${response.status}`,
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
    };
  }
}

export async function callOllamaPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();

  const health = await healthCheckOllama();
  if (health.providerStatus !== "AVAILABLE") {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      error: health.error ?? "AGENT_PROVIDER_UNAVAILABLE",
    };
  }

  const schema = (input.structuredSchema as Record<string, unknown>) ?? AGENT_DECISION_SCHEMA;
  const payload = {
    model,
    stream: false,
    format: {
      type: "json_schema",
      name: "agent_decision",
      schema,
    },
    options: {
      temperature: 0,
    },
    messages: [
      {
        role: "system",
        content:
          "You are the planning and tool-routing layer for GovAid Atlas. You do not determine eligibility. You may only choose from allowed tools. All policy eligibility status comes exclusively from deterministic tool results. Never convert UNCERTAIN into PASS or FAIL. Never invent policy evidence. If required applicant data is missing, ask for human confirmation. If policies conflict, request human review. Return only the required structured decision.",
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
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: `OLLAMA_REQUEST_FAILED: ${response.status} ${text}`,
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
        error: "OLLAMA_DECISION_PARSE_FAILED",
      };
    }

    if (!validateStructuredAgentDecision(parsed)) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: "AGENT_DECISION_SCHEMA_INVALID",
      };
    }

    return {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model,
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
      error: error instanceof Error ? `OLLAMA_REQUEST_ERROR: ${error.message}` : "AGENT_PROVIDER_UNAVAILABLE",
    };
  }
}

export const ollamaProvider: AgentModelProvider = {
  name: "OLLAMA",
  model: getOllamaModel(),
  isConfigured: () => isOllamaConfigured(),
  healthCheck: async () => healthCheckOllama(),
  callPlanner: async (input) => callOllamaPlanner(input),
};
