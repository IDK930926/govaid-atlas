import type { AgentDecision } from "../types";
import {
  AGENT_DECISION_SCHEMA,
  type AgentModelProvider,
  type ProviderHealth,
  type ProviderPlannerInput,
  type ProviderPlannerResult,
  validateStructuredAgentDecision,
} from "./types";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function getEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }

  return process.env;
}

export function getOpenAIModel(): string {
  return getEnv().OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY) && (getEnv().AGENT_PROVIDER ?? "ollama").toLowerCase() !== "ollama";
}

export async function healthCheckOpenAI(): Promise<ProviderHealth> {
  const model = getOpenAIModel();
  if (!isOpenAIConfigured()) {
    return {
      provider: "OPENAI",
      providerStatus: "UNAVAILABLE",
      model,
      error: "OPENAI_API_KEY is missing.",
    };
  }

  return {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model,
  };
}

export async function callOpenAIPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const apiKey = getEnv().OPENAI_API_KEY;
  const model = getOpenAIModel();

  if (!apiKey) {
    return {
      provider: "OPENAI",
      providerStatus: "UNAVAILABLE",
      model,
      error: "OPENAI_API_KEY is missing.",
    };
  }

  const payload = {
    model,
    input: [
      {
        role: "user",
        content: `Create a short structured plan for this goal. Goal: ${input.goal}. Available tools: ${input.availableTools.join(", ")}. Use only the listed tools.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "agent_decision",
        schema: (input.structuredSchema as Record<string, unknown>) ?? AGENT_DECISION_SCHEMA,
      },
    },
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        provider: "OPENAI",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: `OpenAI API error: ${response.status} ${text}`,
      };
    }

    const json = (await response.json()) as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };

    const textPayload = json.output
      ?.flatMap((section) => section.content ?? [])
      .find((part) => part.type === "output_text")?.text ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(textPayload);
    } catch {
      return {
        provider: "OPENAI",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "OPENAI_DECISION_PARSE_FAILED",
      };
    }

    if (!validateStructuredAgentDecision(parsed)) {
      return {
        provider: "OPENAI",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "AGENT_DECISION_SCHEMA_INVALID",
      };
    }

    return {
      provider: "OPENAI",
      providerStatus: "AVAILABLE",
      model,
      callAttempted: true,
      decision: parsed as AgentDecision,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        totalTokens: json.usage?.total_tokens,
      },
    };
  } catch (error) {
    return {
      provider: "OPENAI",
      providerStatus: "UNAVAILABLE",
      model,
      callAttempted: true,
      error: error instanceof Error ? error.message : "OpenAI request failed.",
    };
  }
}

export const openaiProvider: AgentModelProvider = {
  name: "OPENAI",
  model: getOpenAIModel(),
  isConfigured: () => isOpenAIConfigured(),
  healthCheck: async () => healthCheckOpenAI(),
  callPlanner: async (input) => callOpenAIPlanner(input),
};
