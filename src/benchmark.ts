import centralRulesJson
  from "./policies/central-rent-115.json";

import taipeiRulesJson
  from "./policies/taipei-rent-115.json";

import newTaipeiRulesJson
  from "./policies/new-taipei-rent-115.json";

import type {
  PolicyRule,
  RuleEvaluation,
} from "./types";

import {
  evaluateRules,
  getOverallStatus,
} from "./rules";

import {
  evaluateScenario,
} from "./scenario";

import {
  detectConflicts,
} from "./conflict";

import {
  getEvidence,
} from "./evidence";

import {
  benchmarkCases,
} from "./benchmark-cases";

const centralRules =
  centralRulesJson as PolicyRule[];

const taipeiRules =
  taipeiRulesJson as PolicyRule[];

const newTaipeiRules =
  newTaipeiRulesJson as PolicyRule[];

export type BenchmarkResult = {
  id: string;
  name: string;
  category: string;

  expected: string;
  actual: string;

  passed: boolean;

  evidenceChecked: boolean;
  evidenceComplete: boolean;

  unsafeCertainty: boolean;
};

export type BenchmarkSummary = {
  totalCases: number;
  passedCases: number;
  failedCases: number;

  accuracyPercent: number;

  evidenceCoveragePercent:
    number;

  uncertainCases: number;
  unsafeCertaintyCount: number;

  conflictCases: number;
  conflictCasesPassed: number;

  recoveryCases: number;
  recoveryCasesPassed: number;

  manualBaseline:
    "NOT_MEASURED";
  ragBaseline:
    "NOT_MEASURED";
};

function evidenceComplete(
  evaluations: RuleEvaluation[]
): boolean {
  return evaluations.every(
    (evaluation) =>
      Boolean(
        getEvidence(
          evaluation.sourceId
        )
      )
  );
}

export function runBenchmark(): {
  results: BenchmarkResult[];
  summary: BenchmarkSummary;
} {
  const results:
    BenchmarkResult[] = [];

  for (
    const benchmarkCase of
      benchmarkCases
  ) {
    if (
      benchmarkCase.category ===
      "CENTRAL"
    ) {
      const evaluations =
        evaluateRules(
          centralRules,
          benchmarkCase.profile
        );

      const actual =
        getOverallStatus(
          evaluations
        );

      const expected =
        benchmarkCase.expectedStatus;

      results.push({
        id: benchmarkCase.id,
        name: benchmarkCase.name,
        category:
          benchmarkCase.category,

        expected,
        actual,

        passed:
          actual === expected,

        evidenceChecked: true,
        evidenceComplete:
          evidenceComplete(
            evaluations
          ),

        unsafeCertainty:
          expected ===
            "UNCERTAIN" &&
          actual !== "UNCERTAIN",
      });

      continue;
    }

    if (
      benchmarkCase.category ===
      "SCENARIO"
    ) {
      const scenarioResult =
        evaluateScenario(
          benchmarkCase.scenario,
          benchmarkCase.profile,
          {
            central:
              centralRules,

            taipei:
              taipeiRules,

            newTaipei:
              newTaipeiRules,
          }
        );

      const policy =
        scenarioResult.policyResults.find(
          (item) =>
            item.policyId ===
            benchmarkCase.expectedPolicyId
        );

      const actual =
        policy
          ?.overallStatus ??
        "POLICY_NOT_FOUND";

      const expected =
        benchmarkCase.expectedStatus;

      const evaluations =
        policy?.evaluations ?? [];

      results.push({
        id: benchmarkCase.id,
        name: benchmarkCase.name,
        category:
          benchmarkCase.category,

        expected,
        actual,

        passed:
          actual === expected,

        evidenceChecked: true,

        evidenceComplete:
          policy
            ? evidenceComplete(
                evaluations
              )
            : false,

        unsafeCertainty:
          expected ===
            "UNCERTAIN" &&
          actual !== "UNCERTAIN",
      });

      continue;
    }

    if (
      benchmarkCase.category ===
      "CONFLICT"
    ) {
      const result =
        detectConflicts(
          benchmarkCase.claims
        );

      const actual =
        `${result.status}/${result.resolution}`;

      const expected =
        `${benchmarkCase.expectedStatus}/${benchmarkCase.expectedResolution}`;

      results.push({
        id: benchmarkCase.id,
        name: benchmarkCase.name,
        category:
          benchmarkCase.category,

        expected,
        actual,

        passed:
          actual === expected,

        evidenceChecked: false,
        evidenceComplete: true,

        unsafeCertainty: false,
      });

      continue;
    }

    if (
      benchmarkCase.category ===
      "RECOVERY"
    ) {
      const before =
        getOverallStatus(
          evaluateRules(
            centralRules,
            benchmarkCase.before
          )
        );

      const after =
        getOverallStatus(
          evaluateRules(
            centralRules,
            benchmarkCase.after
          )
        );

      const actual =
        `${before} → ${after}`;

      const expected =
        `${benchmarkCase.expectedBefore} → ${benchmarkCase.expectedAfter}`;

      results.push({
        id: benchmarkCase.id,
        name: benchmarkCase.name,
        category:
          benchmarkCase.category,

        expected,
        actual,

        passed:
          actual === expected,

        evidenceChecked: false,
        evidenceComplete: true,

        unsafeCertainty: false,
      });
    }
  }

  const totalCases =
    results.length;

  const passedCases =
    results.filter(
      (item) => item.passed
    ).length;

  const failedCases =
    totalCases - passedCases;

  const evidenceResults =
    results.filter(
      (item) =>
        item.evidenceChecked
    );

  const evidencePassed =
    evidenceResults.filter(
      (item) =>
        item.evidenceComplete
    ).length;

  const uncertainCases =
    results.filter(
      (item) =>
        item.expected ===
        "UNCERTAIN"
    ).length;

  const unsafeCertaintyCount =
    results.filter(
      (item) =>
        item.unsafeCertainty
    ).length;

  const conflictResults =
    results.filter(
      (item) =>
        item.category ===
        "CONFLICT"
    );

  const recoveryResults =
    results.filter(
      (item) =>
        item.category ===
        "RECOVERY"
    );

  return {
    results,

    summary: {
      totalCases,
      passedCases,
      failedCases,

      accuracyPercent:
        totalCases
          ? Number(
              (
                passedCases /
                totalCases *
                100
              ).toFixed(1)
            )
          : 0,

      evidenceCoveragePercent:
        evidenceResults.length
          ? Number(
              (
                evidencePassed /
                evidenceResults.length *
                100
              ).toFixed(1)
            )
          : 0,

      uncertainCases,

      unsafeCertaintyCount,

      conflictCases:
        conflictResults.length,

      conflictCasesPassed:
        conflictResults.filter(
          (item) => item.passed
        ).length,

      recoveryCases:
        recoveryResults.length,

      recoveryCasesPassed:
        recoveryResults.filter(
          (item) => item.passed
        ).length,

      manualBaseline:
        "NOT_MEASURED",

      ragBaseline:
        "NOT_MEASURED",
    },
  };
}