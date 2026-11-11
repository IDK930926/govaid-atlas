import { getOllamaModel, healthCheckOllama, isOllamaConfigured, callOllamaPlanner } from "./providers/ollama";
import { getOpenAIModel, healthCheckOpenAI, isOpenAIConfigured, callOpenAIPlanner } from "./providers/openai";
import type { ProviderHealth, ProviderPlannerInput, ProviderPlannerResult, ProviderName } from "./providers/types";

export { getOllamaModel, isOllamaConfigured, callOllamaPlanner };
export { getOpenAIModel, isOpenAIConfigured, callOpenAIPlanner };
export type { ProviderHealth, ProviderPlannerInput, ProviderPlannerResult, ProviderName };

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export function getConfiguredProviderName(): ProviderName {
  const raw = (process.env?.AGENT_PROVIDER ?? "ollama").trim().toLowerCase();
  if (raw === "openai") {
    return "OPENAI";
  }
  if (raw === "ollama") {
    return "OLLAMA";
  }
  return "UNAVAILABLE";
}

export async function getProviderHealth(): Promise<ProviderHealth> {
  const provider = getConfiguredProviderName();
  if (provider === "OLLAMA") {
    return healthCheckOllama();
  }
  if (provider === "OPENAI") {
    return healthCheckOpenAI();
  }
  return {
    provider: "UNAVAILABLE",
    providerStatus: "UNAVAILABLE",
    model: getOllamaModel(),
    error: "AGENT_PROVIDER_UNAVAILABLE",
  };
}

function getTimeoutMs(explicitTimeoutMs?: number): number {
  if (typeof explicitTimeoutMs === "number" && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envTimeout = Number(process.env?.AGENT_PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }
  return DEFAULT_PROVIDER_TIMEOUT_MS;
}

export async function callPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const provider = getConfiguredProviderName();
  const timeoutMs = getTimeoutMs(input.timeoutMs);

  const invoke = async (): Promise<ProviderPlannerResult> => {
    if (provider === "OLLAMA") {
      return callOllamaPlanner(input);
    }

    if (provider === "OPENAI") {
      return callOpenAIPlanner(input);
    }

    return {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: getOllamaModel(),
      error: "AGENT_PROVIDER_UNAVAILABLE",
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<ProviderPlannerResult>((resolveTimeout) => {
      timer = setTimeout(() => {
        resolveTimeout({
          provider: provider === "UNAVAILABLE" ? "UNAVAILABLE" : provider,
          providerStatus: "UNAVAILABLE",
          model: provider === "OPENAI" ? getOpenAIModel() : getOllamaModel(),
          callAttempted: true,
          error: "AGENT_PROVIDER_TIMEOUT",
        });
      }, timeoutMs);
    });

    return await Promise.race([invoke(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
