import { getOllamaModel, healthCheckOllama, isOllamaConfigured, callOllamaPlanner } from "./providers/ollama";
import { getOpenAIModel, healthCheckOpenAI, isOpenAIConfigured, callOpenAIPlanner } from "./providers/openai";
import { estimateOpenAICostUsd, getOpenAIPricing } from "./providers/pricing";
import type {
  ProviderAttempt,
  ProviderAuditEvent,
  ProviderErrorClass,
  ProviderHealth,
  ProviderMode,
  ProviderName,
  ProviderPlannerInput,
  ProviderPlannerResult,
} from "./providers/types";

export { getOllamaModel, isOllamaConfigured, callOllamaPlanner };
export { getOpenAIModel, isOpenAIConfigured, callOpenAIPlanner };
export type { ProviderHealth, ProviderPlannerInput, ProviderPlannerResult, ProviderName, ProviderMode };

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

type ChainProvider = Exclude<ProviderName, "UNAVAILABLE">;

/**
 * AGENT_PROVIDER: auto (default) | openai | ollama. Anything else is a configuration error
 * and fails closed to the deterministic workflow rather than guessing a provider.
 */
export function getProviderMode(): ProviderMode | null {
  const raw = (process.env?.AGENT_PROVIDER ?? "auto").trim().toLowerCase() || "auto";
  return raw === "auto" || raw === "openai" || raw === "ollama" ? raw : null;
}

/** Ordered provider chain for a mode. Only `auto` contains more than one provider. */
export function getProviderChain(mode: ProviderMode | null = getProviderMode()): ChainProvider[] {
  if (mode === "auto") return ["OPENAI", "OLLAMA"];
  if (mode === "openai") return ["OPENAI"];
  if (mode === "ollama") return ["OLLAMA"];
  return [];
}

/** First provider in the chain; kept for callers that only need the primary. */
export function getConfiguredProviderName(): ProviderName {
  return getProviderChain()[0] ?? "UNAVAILABLE";
}

function modelFor(provider: ChainProvider): string {
  return provider === "OPENAI" ? getOpenAIModel() : getOllamaModel();
}

const PROVIDER_LABEL: Record<ChainProvider, string> = {
  OPENAI: "OpenAI cloud",
  OLLAMA: "Ollama local",
};

function safeReason(provider: ChainProvider, errorClass: ProviderErrorClass | undefined): string {
  return `${PROVIDER_LABEL[provider]} unavailable (${errorClass ?? "PROVIDER_UNAVAILABLE"})`;
}

export async function getProviderHealth(): Promise<ProviderHealth> {
  const mode = getProviderMode();
  const chain = getProviderChain(mode);
  if (!mode || chain.length === 0) {
    return {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: "N/A",
      error: "AGENT_PROVIDER_INVALID_MODE",
      errorClass: "INVALID_PROVIDER_MODE",
      mode: undefined,
    };
  }

  let firstFailure: { provider: ChainProvider; errorClass?: ProviderErrorClass } | undefined;
  for (const provider of chain) {
    const health = provider === "OPENAI" ? await healthCheckOpenAI() : await healthCheckOllama();
    if (health.providerStatus === "AVAILABLE") {
      return {
        ...health,
        mode,
        fallbackActive: Boolean(firstFailure),
        fallbackReason: firstFailure ? safeReason(firstFailure.provider, firstFailure.errorClass) : null,
      };
    }
    firstFailure ??= { provider, errorClass: health.errorClass };
    if (chain.length === 1) {
      // Single-provider mode: report that provider's own status, never another provider.
      return { ...health, mode, fallbackActive: false, fallbackReason: null };
    }
  }

  return {
    provider: "UNAVAILABLE",
    providerStatus: "UNAVAILABLE",
    model: "N/A",
    error: "AGENT_PROVIDER_UNAVAILABLE",
    errorClass: "PROVIDER_UNAVAILABLE",
    mode,
    fallbackActive: false,
    fallbackReason: null,
  };
}

function sumKnown(values: Array<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length ? known.reduce((total, value) => total + value, 0) : undefined;
}

/**
 * Estimated cloud API cost across every attempt in this request.
 * - Local-only attempts cost $0 cloud API.
 * - An OpenAI attempt that reached the API without reporting usage (timeout, 5xx, …) has an
 *   unknown bill, so the whole estimate is null (N/A) rather than a guess.
 */
function estimateCloudCost(attempts: ProviderAttempt[]): { usd: number | null; label: string | null } {
  const openaiAttempts = attempts.filter((attempt) => attempt.provider === "OPENAI" && attempt.callAttempted);
  if (openaiAttempts.length === 0) {
    return { usd: attempts.some((attempt) => attempt.callAttempted) ? 0 : null, label: null };
  }
  let total = 0;
  for (const attempt of openaiAttempts) {
    const cost = estimateOpenAICostUsd(attempt.model, attempt.usage);
    if (cost === null) {
      return { usd: null, label: getOpenAIPricing(attempt.model)?.snapshot ?? null };
    }
    total += cost;
  }
  return { usd: total, label: getOpenAIPricing(openaiAttempts[0].model)?.snapshot ?? null };
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

async function callProviderWithTimeout(
  provider: ChainProvider,
  model: string,
  caller: typeof callOpenAIPlanner,
  input: ProviderPlannerInput,
  timeoutMs: number
): Promise<ProviderPlannerResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<ProviderPlannerResult>((resolveTimeout) => {
      timer = setTimeout(() => {
        resolveTimeout({
          provider,
          providerStatus: "UNAVAILABLE",
          model,
          callAttempted: true,
          error: "AGENT_PROVIDER_TIMEOUT",
          errorClass: "TIMEOUT",
        });
      }, timeoutMs);
    });
    return await Promise.race([caller(input), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export type PlannerDependencies = {
  callOpenAI?: typeof callOpenAIPlanner;
  callOllama?: typeof callOllamaPlanner;
  now?: () => number;
};

/**
 * Runs the planner across the configured provider chain. Fallback happens ONLY on
 * provider-level failure (missing key, timeout, network, 4xx/429/5xx, malformed or
 * schema-invalid output). Deterministic outcomes such as UNCERTAIN, FAIL, policy conflict,
 * or a denied tool are produced later by the rules engine and can never reach this loop.
 */
export async function callPlanner(input: ProviderPlannerInput, deps: PlannerDependencies = {}): Promise<ProviderPlannerResult> {
  const now = deps.now ?? (() => performance.now());
  const callers: Record<ChainProvider, typeof callOpenAIPlanner> = {
    OPENAI: deps.callOpenAI ?? callOpenAIPlanner,
    OLLAMA: deps.callOllama ?? callOllamaPlanner,
  };
  const mode = getProviderMode();
  const chain = getProviderChain(mode);
  const timeoutMs = getTimeoutMs(input.timeoutMs);
  const events: ProviderAuditEvent[] = [];
  const attempts: ProviderAttempt[] = [];
  const emit = (action: ProviderAuditEvent["action"], detail: ProviderAuditEvent["detail"]) =>
    events.push({ timestamp: new Date().toISOString(), action, detail });

  if (!mode) {
    emit("AGENT_PROVIDER_UNAVAILABLE", { reason: "Invalid AGENT_PROVIDER value", errorClass: "INVALID_PROVIDER_MODE" });
    return {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: "N/A",
      callAttempted: false,
      error: "AGENT_PROVIDER_INVALID_MODE",
      errorClass: "INVALID_PROVIDER_MODE",
      attempts,
      fallbackCount: 0,
      fallbackReason: null,
      providerEvents: events,
      estimatedCloudCostUsd: null,
      pricingLabel: null,
    };
  }

  let fallbackCount = 0;
  let fallbackReason: string | null = null;
  let lastResult: ProviderPlannerResult | undefined;

  for (let index = 0; index < chain.length; index += 1) {
    const provider = chain[index];
    const model = modelFor(provider);
    emit("AGENT_PROVIDER_SELECTED", { mode, provider, model });

    const started = now();
    let result: ProviderPlannerResult;
    if (provider === "OPENAI" && !isOpenAIConfigured()) {
      // Skipped, not called: no request leaves the server without a key.
      result = { provider, providerStatus: "UNAVAILABLE", model, callAttempted: false, error: "OPENAI_MISSING_API_KEY", errorClass: "MISSING_API_KEY" };
    } else {
      emit("AGENT_PROVIDER_CALL_STARTED", { provider, model });
      try {
        result = await callProviderWithTimeout(provider, model, callers[provider], input, timeoutMs);
      } catch {
        result = { provider, providerStatus: "UNAVAILABLE", model, callAttempted: true, errorClass: "NETWORK_ERROR" };
      }
    }
    lastResult = result;
    const latencyMs = Math.max(0, now() - started);
    const succeeded = result.providerStatus === "AVAILABLE" && Boolean(result.decision);
    const errorClass: ProviderErrorClass | undefined = succeeded ? undefined : result.errorClass ?? "PROVIDER_UNAVAILABLE";

    attempts.push({
      provider,
      model: result.model || model,
      callAttempted: result.callAttempted ?? false,
      outcome: succeeded ? "COMPLETED" : "FAILED",
      latencyMs,
      errorClass,
      usage: result.usage,
    });

    if (succeeded) {
      emit("AGENT_PROVIDER_CALL_COMPLETED", {
        provider,
        model: result.model,
        latencyMs: Math.round(latencyMs),
      });
      const cost = estimateCloudCost(attempts);
      return {
        ...result,
        callAttempted: attempts.some((attempt) => attempt.callAttempted),
        usage: {
          ...result.usage,
          inputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.inputTokens)),
          outputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.outputTokens)),
          totalTokens: sumKnown(attempts.map((attempt) => attempt.usage?.totalTokens)),
        },
        error: undefined,
        errorClass: undefined,
        mode,
        attempts,
        fallbackCount,
        fallbackReason,
        providerEvents: events,
        estimatedCloudCostUsd: cost.usd,
        pricingLabel: cost.label,
      };
    }

    emit("AGENT_PROVIDER_CALL_FAILED", { provider, model, latencyMs: Math.round(latencyMs), errorClass });

    const next = chain[index + 1];
    if (next) {
      fallbackCount += 1;
      fallbackReason ??= safeReason(provider, errorClass);
      emit("AGENT_PROVIDER_FALLBACK", { from: provider, to: next, errorClass, reason: safeReason(provider, errorClass) });
    }
  }

  const lastError = attempts[attempts.length - 1]?.errorClass ?? "PROVIDER_UNAVAILABLE";
  emit("AGENT_PROVIDER_UNAVAILABLE", {
    mode,
    reason: "All configured agent providers are unavailable; deterministic safety workflow only.",
    errorClass: lastError,
  });
  const cost = estimateCloudCost(attempts);
  return {
    provider: "UNAVAILABLE",
    providerStatus: "UNAVAILABLE",
    model: chain.length === 1 ? modelFor(chain[0]) : "N/A",
    callAttempted: attempts.some((attempt) => attempt.callAttempted),
    usage: {
      inputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.inputTokens)),
      outputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.outputTokens)),
    },
    // Single-provider modes keep the provider's own error code (server-side only).
    error: chain.length === 1 ? lastResult?.error ?? "AGENT_PROVIDER_UNAVAILABLE" : "AGENT_PROVIDER_UNAVAILABLE",
    errorClass: lastError,
    mode,
    attempts,
    fallbackCount,
    fallbackReason,
    providerEvents: events,
    estimatedCloudCostUsd: cost.usd,
    pricingLabel: cost.label,
  };
}
