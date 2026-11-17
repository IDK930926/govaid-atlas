import assert from "node:assert/strict";
import test from "node:test";
import { finalBenchmark } from "./benchmark-final";
import { evaluationScopeRows } from "./evaluation-scope";
import { describeCloudCost } from "./metrics";
import { createRuntimeMetrics } from "./metrics";

// ---------------------------------------------------------------- 2I
test("2I — unmeasured figures are never shown as percentages", () => {
  const rows = evaluationScopeRows({
    regressionPassed: 12,
    regressionTotal: 12,
    benchmarkCaseCount: finalBenchmark.caseCount,
    manualBaseline: finalBenchmark.manualBaseline,
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  assert.equal(byKey.get("agentEndToEnd")?.status, "NOT_MEASURED");
  assert.doesNotMatch(byKey.get("agentEndToEnd")!.value, /%|\d/);
  assert.equal(byKey.get("humanBaseline")?.value, "PENDING", "the human baseline is still blank");
  assert.equal(byKey.get("fieldValidation")?.value, "PENDING");
  assert.equal(byKey.get("ruleEngineRegression")?.value, "12/12");
  assert.match(byKey.get("syntheticBenchmark")!.note, /規則引擎/);
  assert.match(byKey.get("syntheticBenchmark")!.note, /尚待獨立審查/);
});

test("2I — underlying benchmark results are untouched", () => {
  const accuracy = finalBenchmark.metrics.find((metric) => metric.key === "statusAccuracy")!;
  assert.deepEqual(accuracy.govaidAtlas, { percent: 100.0, numerator: 10, denominator: 10 });
  assert.deepEqual(accuracy.llmContext, { percent: 70.0, numerator: 7, denominator: 10 });
});

// ---------------------------------------------------------------- 2H
test("2H — no pricing snapshot for the model in use: says unavailable, never a guessed amount", () => {
  const metrics = { ...createRuntimeMetrics(), llmCalls: 1, inputTokens: 422, outputTokens: 94, estimatedCostUsd: null };
  const text = describeCloudCost(metrics, "gpt-4o-mini");
  assert.match(text ?? "", /Cost estimate unavailable/);
  assert.match(text ?? "", /gpt-4o-mini/);
  assert.doesNotMatch(text ?? "", /\$\s?\d/);
});

test("2H — a snapshot-based figure is always labelled Estimated, with provenance", () => {
  const metrics = {
    ...createRuntimeMetrics(),
    llmCalls: 1,
    estimatedCostUsd: 0.00074,
    pricingLabel: "gpt-5.4-mini list price snapshot 2026-11-10",
  };
  const text = describeCloudCost(metrics, "gpt-5.4-mini") ?? "";
  assert.match(text, /^Estimated US\$0\.00074/);
  assert.match(text, /snapshot 2026-11-10/);
});

test("2H — before any model call there is nothing to estimate", () => {
  assert.equal(describeCloudCost(createRuntimeMetrics(), "gpt-4o-mini"), null);
});
