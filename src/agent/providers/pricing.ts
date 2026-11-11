/**
 * Centralised cloud API pricing snapshots used only for the "Estimated Cloud API Cost"
 * runtime metric. This is NOT a total cost: promotional credits, hardware, and other
 * spend are out of scope. Unknown models return null so the UI shows N/A instead of a guess.
 */
export type ModelPricing = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Human-readable provenance shown next to the estimate. */
  snapshot: string;
};

export const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4-mini": {
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 4.5,
    snapshot: "gpt-5.4-mini list price snapshot 2026-11-10 (USD 0.75 in / 4.50 out per 1M tokens)",
  },
};

export function getOpenAIPricing(model: string): ModelPricing | null {
  return OPENAI_PRICING[model] ?? null;
}

export function estimateOpenAICostUsd(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined
): number | null {
  const pricing = getOpenAIPricing(model);
  if (!pricing || typeof usage?.inputTokens !== "number" || typeof usage?.outputTokens !== "number") {
    return null;
  }
  return (usage.inputTokens * pricing.inputUsdPerMTok + usage.outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
}
