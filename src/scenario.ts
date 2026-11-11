import type {
  AddressScenario,
  ApplicantProfile,
  EligibilityStatus,
  PolicyRule,
  RuleEvaluation,
  RuleStatus,
} from "./types";

import {
  evaluateRules,
  getOverallStatus,
} from "./rules";

import {
  aggregateEligibilityStatus,
  toEligibilityStatus,
} from "./status";

import {
  assessCityCoverage,
  getPolicyCompleteness,
  PARTIAL_CHECK_NOTE,
  type CityCoverage,
} from "./coverage";

// Pseudo policy id used to make the coverage boundary explicit in results.
export const LOCAL_COVERAGE_BOUNDARY_ID = "LOCAL_COVERAGE_BOUNDARY";

export type PolicyResult = {
  policyId: string;
  evaluations: RuleEvaluation[];
  // Rule-level aggregation of the encoded rules only (used by the benchmark).
  overallStatus: RuleStatus;
  // User-facing claim: never PASS unless the policy is completely encoded.
  eligibilityStatus: EligibilityStatus;
  coverageNote?: string;
};

export type ScenarioResult = {
  scenario: AddressScenario;
  policyResults: PolicyResult[];
  // Aggregated user-facing status for this scenario (FAIL-first priority).
  overallStatus: EligibilityStatus;
  coverage: CityCoverage;
};

type PolicySets = {
  central: PolicyRule[];
  taipei: PolicyRule[];
  newTaipei: PolicyRule[];
};

function evaluatePolicy(
  policyId: string,
  rules: PolicyRule[],
  applicant: ApplicantProfile
): PolicyResult {
  const evaluations =
    evaluateRules(rules, applicant);

  const overallStatus =
    getOverallStatus(evaluations);

  const eligibilityStatus =
    toEligibilityStatus(
      overallStatus,
      getPolicyCompleteness(policyId)
    );

  return {
    policyId,
    evaluations,
    overallStatus,
    eligibilityStatus,
    coverageNote:
      eligibilityStatus === "PARTIAL_CHECK"
        ? PARTIAL_CHECK_NOTE
        : undefined,
  };
}

function coverageBoundaryResult(
  coverage: CityCoverage
): PolicyResult {
  return {
    policyId: LOCAL_COVERAGE_BOUNDARY_ID,
    evaluations: [],
    overallStatus: "UNCERTAIN",
    eligibilityStatus:
      coverage.status === "NOT_COVERED"
        ? "NOT_COVERED"
        : "UNCERTAIN",
    coverageNote: coverage.message,
  };
}

export function evaluateScenario(
  scenario: AddressScenario,
  applicant: ApplicantProfile,
  policySets: PolicySets
): ScenarioResult {
  const policyResults: PolicyResult[] = [];
  const coverage = assessCityCoverage(scenario.city);

  // 中央租補：兩個地址都要重新執行
  policyResults.push(
    evaluatePolicy(
      "CENTRAL_RENT_115",
      policySets.central,
      applicant
    )
  );

  // ACTUAL 永和
  if (coverage.city === "新北市") {
    policyResults.push(
      evaluatePolicy(
        "NEW_TAIPEI_RENT_115",
        policySets.newTaipei,
        applicant
      )
    );
  }

  // WHAT-IF 文山
  if (coverage.city === "臺北市") {
    policyResults.push(
      evaluatePolicy(
        "TAIPEI_RENT_115",
        policySets.taipei,
        applicant
      )
    );
  }

  // 未涵蓋或缺少縣市：明確標示邊界，不得退回只用中央規則判定
  if (coverage.status !== "COVERED") {
    policyResults.push(
      coverageBoundaryResult(coverage)
    );
  }

  return {
    scenario,
    policyResults,
    overallStatus:
      aggregateEligibilityStatus(
        policyResults.map(
          (policy) => policy.eligibilityStatus
        )
      ),
    coverage,
  };
}
