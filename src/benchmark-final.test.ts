import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import path from "node:path";
import test from "node:test";

import {finalBenchmark} from "./benchmark-final";

function runSummary(): string {
  const tsxCli = require.resolve("tsx/cli");
  return execFileSync(process.execPath, [tsxCli, path.join("src", "benchmark-runner.ts"), "--summary"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
}

function section(summary: string, method: string, runId: string): string {
  const start = summary.indexOf(`${method} | ${runId}`);
  assert.ok(start >= 0, `missing ${method} run ${runId} in benchmark summary`);
  const next = summary.indexOf("\n\n", start);
  return summary.slice(start, next === -1 ? undefined : next);
}

test("displayed final benchmark numbers match recorded benchmark/results.csv", () => {
  const summary = runSummary();
  const llm = section(summary, "LLM_CONTEXT", finalBenchmark.llmContextRunId);
  const atlas = section(summary, "GOVAID_ATLAS", finalBenchmark.govaidAtlasRunId);

  assert.match(llm, new RegExp(`\\(${finalBenchmark.caseCount} completed cases\\)`));
  assert.match(atlas, new RegExp(`\\(${finalBenchmark.caseCount} completed cases\\)`));

  for (const metric of finalBenchmark.metrics) {
    for (const [block, value] of [[llm, metric.llmContext], [atlas, metric.govaidAtlas]] as const) {
      const expected = `${metric.summaryLabel}: ${value.percent.toFixed(1)}% (${value.numerator}/${value.denominator}`;
      assert.ok(block.includes(expected), `expected "${expected}" in:\n${block}`);
    }
  }
});
