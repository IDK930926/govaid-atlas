export type RuntimeMetrics = {
  rulesEngineCalls: number;
  scenarioEvaluations: number;
  passportGenerations: number;
  conflictChecks: number;
  permissionChecks: number;

  measuredOperations: number;
  totalLatencyMs: number;
  lastLatencyMs: number | null;

  llmCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  /** Provenance of estimatedCostUsd when it comes from a cloud pricing snapshot. */
  pricingLabel: string | null;

  fallbackCount: number;
  fallbackReason: string | null;
};

export type RuntimeCounterKey =
  | "rulesEngineCalls"
  | "scenarioEvaluations"
  | "passportGenerations"
  | "conflictChecks"
  | "permissionChecks";

/**
 * Display text for the cloud API cost metric. Never presents a figure as billing truth:
 * a value is always "Estimated" from a versioned pricing snapshot; without a snapshot for the
 * model in use, it says the estimate is unavailable and why, instead of a bare N/A or a guess.
 */
export function describeCloudCost(metrics: RuntimeMetrics, model: string | null | undefined): string | null {
  const cost = metrics.estimatedCostUsd;
  if (cost === 0) return "$0（本機模型，無雲端費用）";
  if (cost === null) {
    if (metrics.llmCalls > 0 && model) {
      return `Cost estimate unavailable：尚無 ${model} 的已驗證價格快照`;
    }
    return null;
  }
  const amount = cost < 0.01 ? cost.toPrecision(2) : cost.toFixed(2);
  return `Estimated US$${amount}${metrics.pricingLabel ? `（${metrics.pricingLabel}）` : ""}`;
}

export function createRuntimeMetrics(): RuntimeMetrics {
  return {
    rulesEngineCalls: 0,
    scenarioEvaluations: 0,
    passportGenerations: 0,
    conflictChecks: 0,
    permissionChecks: 0,

    measuredOperations: 0,
    totalLatencyMs: 0,
    lastLatencyMs: null,

    llmCalls: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    pricingLabel: null,

    fallbackCount: 0,
    fallbackReason: null,
  };
}

export function measureSync<T>(
  operation: () => T
): {
  result: T;
  latencyMs: number;
} {
  const start = performance.now();

  const result = operation();

  const latencyMs =
    performance.now() - start;

  return {
    result,
    latencyMs,
  };
}

export function recordRuntimeOperation(
  metrics: RuntimeMetrics,
  counter: RuntimeCounterKey,
  latencyMs: number
): RuntimeMetrics {
  return {
    ...metrics,

    [counter]:
      metrics[counter] + 1,

    measuredOperations:
      metrics.measuredOperations + 1,

    totalLatencyMs:
      metrics.totalLatencyMs +
      latencyMs,

    lastLatencyMs:
      latencyMs,
  };
}

export function recordLlmCall(
  metrics: RuntimeMetrics,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  } | null,
  isLocalProvider: boolean
): RuntimeMetrics {
  return {
    ...metrics,
    llmCalls: metrics.llmCalls + 1,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    estimatedCostUsd: isLocalProvider ? 0 : null,
  };
}

/** Sum two provider-reported values; null (unknown) is contagious so N/A is never hidden. */
function addReported(previous: number | null, next: number | null, hadPrevious: boolean): number | null {
  if (!hadPrevious) return next;
  if (previous === null || next === null) return null;
  return previous + next;
}

/**
 * Records one planner request (which may include several provider attempts in auto mode).
 * Every value comes from the server's provider-chain result; nothing is synthesised.
 */
export function recordProviderRun(
  metrics: RuntimeMetrics,
  run: {
    llmCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCloudCostUsd: number | null;
    pricingLabel: string | null;
    fallbackCount: number;
    fallbackReason: string | null;
  }
): RuntimeMetrics {
  if (run.llmCalls === 0 && run.fallbackCount === 0) {
    return metrics;
  }
  const hadPrevious = metrics.llmCalls > 0;
  return {
    ...metrics,
    llmCalls: metrics.llmCalls + run.llmCalls,
    inputTokens: run.llmCalls ? addReported(metrics.inputTokens, run.inputTokens, hadPrevious) : metrics.inputTokens,
    outputTokens: run.llmCalls ? addReported(metrics.outputTokens, run.outputTokens, hadPrevious) : metrics.outputTokens,
    estimatedCostUsd: run.llmCalls ? addReported(metrics.estimatedCostUsd, run.estimatedCloudCostUsd, hadPrevious) : metrics.estimatedCostUsd,
    pricingLabel: run.pricingLabel ?? metrics.pricingLabel,
    fallbackCount: metrics.fallbackCount + run.fallbackCount,
    fallbackReason: run.fallbackReason ?? metrics.fallbackReason,
  };
}

export function recordRuntimeCall(
  metrics: RuntimeMetrics,
  counter: RuntimeCounterKey
): RuntimeMetrics {
  return {
    ...metrics,
    [counter]: metrics[counter] + 1,
  };
}
