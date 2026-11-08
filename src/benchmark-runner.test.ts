import assert from "node:assert/strict";
import test from "node:test";
import benchmarkData from "../benchmark/cases.json";
import { completionTimeSummary, evaluateAtlasCase, percentage, unsafeCertaintySummary } from "./benchmark-runner";

test("final benchmark Gold Answers match the current GovAid Atlas evaluation", () => {
  assert.equal(benchmarkData.cases.length, 10);
  assert.deepEqual(
    benchmarkData.cases.map((testCase) => testCase.caseId),
    ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10"],
  );
  for (const testCase of benchmarkData.cases) {
    assert.equal(testCase.input.synthetic, true, `${testCase.caseId} must be synthetic`);
    for (const sourceId of testCase.evidenceIds) {
      assert.ok(benchmarkData.evidenceContext.some((source) => source.sourceId === sourceId), `${testCase.caseId} evidence`);
    }
    const result = evaluateAtlasCase(testCase);
    assert.equal(result.status, testCase.gold.expectedStatus, testCase.caseId);
    if (testCase.gold.expectedMissingCondition) {
      assert.match(result.answer, new RegExp(testCase.gold.expectedMissingCondition));
    }
  }
});

test("unsafe certainty is calculated only over the five safety-critical cases", () => {
  const rows = [
    { "Case ID": "B01", "Unsafe Certainty": "YES" },
    { "Case ID": "B02", "Unsafe Certainty": "YES" },
    { "Case ID": "B04", "Unsafe Certainty": "YES" },
    { "Case ID": "B05", "Unsafe Certainty": "NO" },
    { "Case ID": "B06", "Unsafe Certainty": "NO" },
    { "Case ID": "B08", "Unsafe Certainty": "YES" },
    { "Case ID": "B10", "Unsafe Certainty": "NO" },
  ];
  assert.equal(unsafeCertaintySummary(rows), "40.0% (2/5 safety-critical cases)");
});

test("GovAid Atlas timing is N/A unless the complete agent workflow is measured", () => {
  assert.equal(
    completionTimeSummary("GOVAID_ATLAS", [{ "Completion Time Seconds": "0.000" }]),
    "N/A (deterministic-only; full Agent workflow not run)",
  );
  assert.equal(
    completionTimeSummary("LLM_CONTEXT", [
      { "Completion Time Seconds": "10.000" },
      { "Completion Time Seconds": "20.000" },
    ]),
    "15.000s",
  );
});

test("unsupported claim summary accepts human adjudication values 1 and 0", () => {
  const rows = [
    { "Unsupported Claim": "1" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "1" },
    { "Unsupported Claim": "0" },
    { "Unsupported Claim": "1" },
    { "Unsupported Claim": "0" },
  ];
  assert.equal(percentage(rows, "Unsupported Claim"), "30.0% (3/10)");
});
