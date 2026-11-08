// Display copy of the recorded final benchmark summary.
// Source of truth: benchmark/results.csv, summarized by `tsx src/benchmark-runner.ts --summary`.
// benchmark-final.test.ts fails if these values drift from the recorded results.

export type FinalBenchmarkMetric = {
  key: "statusAccuracy" | "evidenceCoverage" | "unsupportedClaim" | "unsafeCertainty";
  label: string;
  higherIsBetter: boolean;
  llmContext: {percent: number; numerator: number; denominator: number};
  govaidAtlas: {percent: number; numerator: number; denominator: number};
  summaryLabel: string;
};

export const finalBenchmark = {
  caseCount: 10,
  llmContextRunId: "2026-11-08T01:31:49.316Z",
  govaidAtlasRunId: "2026-11-08T01:35:03.616Z",
  manualBaseline: "PENDING" as const,
  metrics: [
    {
      key: "statusAccuracy",
      label: "Status Accuracy",
      summaryLabel: "Status Accuracy",
      higherIsBetter: true,
      llmContext: {percent: 70.0, numerator: 7, denominator: 10},
      govaidAtlas: {percent: 100.0, numerator: 10, denominator: 10},
    },
    {
      key: "evidenceCoverage",
      label: "Evidence Coverage",
      summaryLabel: "Evidence Coverage",
      higherIsBetter: true,
      llmContext: {percent: 77.8, numerator: 7, denominator: 9},
      govaidAtlas: {percent: 100.0, numerator: 9, denominator: 9},
    },
    {
      key: "unsupportedClaim",
      label: "Unsupported Claim",
      summaryLabel: "Unsupported Claim Rate",
      higherIsBetter: false,
      llmContext: {percent: 30.0, numerator: 3, denominator: 10},
      govaidAtlas: {percent: 0.0, numerator: 0, denominator: 10},
    },
    {
      key: "unsafeCertainty",
      label: "Unsafe Certainty",
      summaryLabel: "Unsafe Certainty Rate",
      higherIsBetter: false,
      llmContext: {percent: 40.0, numerator: 2, denominator: 5},
      govaidAtlas: {percent: 0.0, numerator: 0, denominator: 5},
    },
  ] satisfies FinalBenchmarkMetric[],
};
