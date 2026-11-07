import type { AgentDecision } from "./types";

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
  return Boolean(getEnv().OPENAI_API_KEY);
}

export async function callOpenAIPlanner(input: {
  goal: string;
  availableTools: string[];
  structuredSchema?: unknown;
}): Promise<{
  providerStatus: "AVAILABLE" | "UNAVAILABLE";
  model: string;
  decision?: AgentDecision;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}> {
  const apiKey = getEnv().OPENAI_API_KEY;
  const model = getOpenAIModel();

  if (!apiKey) {
    return {
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
        schema: {
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
        },
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
        providerStatus: "UNAVAILABLE",
        model,
        error: `OpenAI API error: ${response.status} ${text}`,
      };
    }

    const json = (await response.json()) as {
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };

    const textPayload = json.output
      ?.flatMap((section) => section.content ?? [])
      .find((part) => part.type === "output_text")?.text ?? "{}";

    const parsed = JSON.parse(textPayload) as AgentDecision;

    return {
      providerStatus: "AVAILABLE",
      model,
      decision: parsed,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        totalTokens: json.usage?.total_tokens,
      },
    };
  } catch (error) {
    return {
      providerStatus: "UNAVAILABLE",
      model,
      error: error instanceof Error ? error.message : "OpenAI request failed.",
    };
  }
}
