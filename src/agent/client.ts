import { getOllamaModel, healthCheckOllama, isOllamaConfigured, callOllamaPlanner } from "./providers/ollama";
import { getOpenAIModel, healthCheckOpenAI, isOpenAIConfigured, callOpenAIPlanner } from "./providers/openai";
import type { ProviderHealth, ProviderPlannerInput, ProviderPlannerResult, ProviderName } from "./providers/types";

export { getOllamaModel, isOllamaConfigured, callOllamaPlanner };
export { getOpenAIModel, isOpenAIConfigured, callOpenAIPlanner };
export type { ProviderHealth, ProviderPlannerInput, ProviderPlannerResult, ProviderName };

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

export async function callPlanner(input: ProviderPlannerInput): Promise<ProviderPlannerResult> {
  const provider = getConfiguredProviderName();

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
}
