export type RuntimeMetrics = {
  rulesEngineCalls: number;
  scenarioEvaluations: number;
  passportGenerations: number;
  conflictChecks: number;
  permissionChecks: number;

  measuredOperations: number;
  totalLatencyMs: number;
  lastLatencyMs: number | null;

  // P0 尚未連接 LLM，所以必須保持真實
  llmCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

export type RuntimeCounterKey =
  | "rulesEngineCalls"
  | "scenarioEvaluations"
  | "passportGenerations"
  | "conflictChecks"
  | "permissionChecks";

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