import { getOllamaModel, healthCheckOllama, isOllamaConfigured, callOllamaPlanner } from "./providers/ollama";
import { getOpenAIModel, healthCheckOpenAI, isOpenAIConfigured, callOpenAIPlanner } from "./providers/openai";
import { estimateOpenAICostUsd, getOpenAIPricing } from "./providers/pricing";
import { getProviderChain, getProviderMode, type ChainProvider } from "./providers/mode";
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

/**
 * Timeout hierarchy (all overridable by env):
 * - AGENT_PLANNER_BUDGET_MS (default 10 s): wall-clock budget for the WHOLE provider chain.
 *   After it is spent the request takes the deterministic safe path; no 25–30 s dead wait.
 * - AGENT_PROVIDER_TIMEOUT_MS (default 8 s): cap for ONE provider attempt; each attempt
 *   gets min(this, remaining budget) and its HTTP call is aborted when it expires.
 * - Provider-internal caps (OPENAI_TIMEOUT_MS / OLLAMA_TIMEOUT_MS, default 8 s) are a
 *   defensive ceiling only and never exceed the per-attempt cap by default.
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
export const DEFAULT_PLANNER_BUDGET_MS = 10_000;
/**
 * A fallback attempt (never the first) is skipped instead of started when less than
 * min(this, per-attempt cap / 2) of the planner budget remains.
 */
export const MIN_ATTEMPT_BUDGET_MS = 1_000;

export { getProviderMode, getProviderChain };

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

function positiveEnvMs(name: string): number | undefined {
  const value = Number(process.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Per-attempt cap: explicit input, else AGENT_PROVIDER_TIMEOUT_MS, else default. */
export function getTimeoutMs(explicitTimeoutMs?: number): number {
  if (typeof explicitTimeoutMs === "number" && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  return positiveEnvMs("AGENT_PROVIDER_TIMEOUT_MS") ?? DEFAULT_PROVIDER_TIMEOUT_MS;
}

/** Whole-chain budget; never smaller than one attempt's cap so a single-provider mode is unaffected. */
export function getPlannerBudgetMs(attemptTimeoutMs: number): number {
  return Math.max(attemptTimeoutMs, positiveEnvMs("AGENT_PLANNER_BUDGET_MS") ?? DEFAULT_PLANNER_BUDGET_MS);
}

async function callProviderWithTimeout(
  provider: ChainProvider,
  model: string,
  caller: typeof callOpenAIPlanner,
  input: ProviderPlannerInput,
  timeoutMs: number
): Promise<ProviderPlannerResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<ProviderPlannerResult>((resolveTimeout) => {
      timer = setTimeout(() => {
        // Abort the in-flight HTTP request as well, so it cannot keep running after we move on.
        controller.abort();
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
    return await Promise.race([caller({ ...input, timeoutMs, signal: controller.signal }), timeoutPromise]);
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
  const budgetMs = getPlannerBudgetMs(timeoutMs);
  const chainStarted = now();
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
    const remainingBudgetMs = budgetMs - Math.max(0, started - chainStarted);
    let result: ProviderPlannerResult;
    if (provider === "OPENAI" && !isOpenAIConfigured()) {
      // Skipped, not called: no request leaves the server without a key.
      result = { provider, providerStatus: "UNAVAILABLE", model, callAttempted: false, error: "OPENAI_MISSING_API_KEY", errorClass: "MISSING_API_KEY" };
    } else if (index > 0 && remainingBudgetMs < Math.min(MIN_ATTEMPT_BUDGET_MS, timeoutMs / 2)) {
      // Planner budget spent by earlier attempts: skip rather than start a call that cannot finish.
      result = { provider, providerStatus: "UNAVAILABLE", model, callAttempted: false, error: "AGENT_PLANNER_BUDGET_EXHAUSTED", errorClass: "TIMEOUT" };
    } else {
      emit("AGENT_PROVIDER_CALL_STARTED", { provider, model });
      try {
        result = await callProviderWithTimeout(provider, model, callers[provider], input, Math.min(timeoutMs, remainingBudgetMs));
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
