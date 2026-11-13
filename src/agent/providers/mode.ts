import type { ProviderMode, ProviderName } from "./types";

export type ChainProvider = Exclude<ProviderName, "UNAVAILABLE">;

/**
 * Single source of truth for AGENT_PROVIDER.
 * auto (default, also when unset or blank) | openai | ollama. Anything else is a
 * configuration error and fails closed to the deterministic workflow.
 */
export function getProviderMode(): ProviderMode | null {
  const raw = (typeof process !== "undefined" ? process.env?.AGENT_PROVIDER : undefined) ?? "auto";
  const normalized = raw.trim().toLowerCase() || "auto";
  return normalized === "auto" || normalized === "openai" || normalized === "ollama" ? normalized : null;
}

/** Ordered provider chain for a mode. Only `auto` contains more than one provider. */
export function getProviderChain(mode: ProviderMode | null = getProviderMode()): ChainProvider[] {
  if (mode === "auto") return ["OPENAI", "OLLAMA"];
  if (mode === "openai") return ["OPENAI"];
  if (mode === "ollama") return ["OLLAMA"];
  return [];
}
