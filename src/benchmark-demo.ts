import {
  runBenchmark,
} from "./benchmark";

console.log(
  "\n=== GovAid Atlas Benchmark ===\n"
);

console.log(
  "Deterministic P0 evaluation only."
);

console.log(
  "Manual / RAG baselines are not measured yet.\n"
);

const {
  results,
  summary,
} = runBenchmark();

console.table(
  results.map(
    (result) => ({
      id: result.id,
      category:
        result.category,
      expected:
        result.expected,
      actual:
        result.actual,
      passed:
        result.passed,
      evidence:
        result
          .evidenceChecked
          ? result
              .evidenceComplete
          : "N/A",
      unsafeCertainty:
        result.unsafeCertainty,
    })
  )
);

console.log(
  "\n=== Summary ==="
);

console.table({
  totalCases:
    summary.totalCases,

  passedCases:
    summary.passedCases,

  failedCases:
    summary.failedCases,

  accuracy:
    `${summary.accuracyPercent}%`,

  evidenceCoverage:
    `${summary.evidenceCoveragePercent}%`,

  unsafeCertainty:
    summary.unsafeCertaintyCount,

  conflict:
    `${summary.conflictCasesPassed}/${summary.conflictCases}`,

  recovery:
    `${summary.recoveryCasesPassed}/${summary.recoveryCases}`,

  manualBaseline:
    summary.manualBaseline,

  ragBaseline:
    summary.ragBaseline,
});