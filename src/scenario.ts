import taoyuanRulesJson from "./policies/taoyuan-rent-115.json";
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
  type RuleEvaluationOptions,
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

const defaultTaoyuanRules = taoyuanRulesJson as PolicyRule[];

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
  // Upstream program this one requires (derived from its encoded rules), if any.
  requiresPolicyId?: string;
  // Set when that upstream program has FAILed in the same scenario.
  blockedByPolicyId?: string;
};

export type ScenarioResult = {
  scenario: AddressScenario;
  policyResults: PolicyResult[];
  // Aggregated user-facing status for this scenario (FAIL-first priority).
  overallStatus: EligibilityStatus;
  coverage: CityCoverage;
};

export type PolicySets = {
  central: PolicyRule[];
  taipei: PolicyRule[];
  newTaipei: PolicyRule[];
  taoyuan?: PolicyRule[];
};

// Encoded rule field meaning "this program requires an approved central rental subsidy".
const CENTRAL_APPROVAL_FIELD = "centralRentApproved";
const CENTRAL_POLICY_ID = "CENTRAL_RENT_115";

function evaluatePolicy(
  policyId: string,
  rules: PolicyRule[],
  applicant: ApplicantProfile,
  options?: RuleEvaluationOptions
): PolicyResult {
  const evaluations =
    evaluateRules(rules, applicant, options);

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
    ...(policyId !== CENTRAL_POLICY_ID && rules.some((rule) => rule.field === CENTRAL_APPROVAL_FIELD)
      ? { requiresPolicyId: CENTRAL_POLICY_ID }
      : {}),
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

export const UPSTREAM_CENTRAL_FAIL_NOTE =
  "此方案須先取得中央租金補貼核定；本情境中央租金補貼資格未通過，因此無法申請此方案。";

/**
 * A local program whose encoded rules require central approval cannot remain "possibly
 * claimable" when the central program FAILs in the same scenario. Only the user-facing
 * eligibilityStatus changes; the rule-level overallStatus (benchmark input) is untouched.
 */
function applyUpstreamCentralDependency(policyResults: PolicyResult[]): void {
  const central = policyResults.find((policy) => policy.policyId === CENTRAL_POLICY_ID);
  if (central?.eligibilityStatus !== "FAIL") {
    return;
  }
  for (const policy of policyResults) {
    if (policy !== central && policy.requiresPolicyId === CENTRAL_POLICY_ID && policy.eligibilityStatus !== "FAIL") {
      policy.eligibilityStatus = "FAIL";
      policy.coverageNote = UPSTREAM_CENTRAL_FAIL_NOTE;
      policy.blockedByPolicyId = CENTRAL_POLICY_ID;
    }
  }
}

export function evaluateScenario(
  scenario: AddressScenario,
  applicant: ApplicantProfile,
  policySets: PolicySets,
  options?: RuleEvaluationOptions & { localOnly?: boolean }
): ScenarioResult {
  const policyResults: PolicyResult[] = [];
  const coverage = assessCityCoverage(scenario.city, {
    localOnly: options?.localOnly,
  });

  // 中央租補：兩個地址都要重新執行
  policyResults.push(
    evaluatePolicy(
      "CENTRAL_RENT_115",
      policySets.central,
      applicant,
      options
    )
  );

  // ACTUAL 永和 / 新北市
  if (coverage.city === "新北市") {
    policyResults.push(
      evaluatePolicy(
        "NEW_TAIPEI_RENT_115",
        policySets.newTaipei,
        applicant,
        options
      )
    );
  }

  // WHAT-IF 文山 / 臺北市
  if (coverage.city === "臺北市") {
    policyResults.push(
      evaluatePolicy(
        "TAIPEI_RENT_115",
        policySets.taipei,
        applicant,
        options
      )
    );
  }

  // 桃園市：300億元中央擴大租金補貼（桃園市政府住宅發展處協辦受理與桃園所得門檻檢核）
  if (coverage.city === "桃園市" && coverage.status === "COVERED") {
    policyResults.push(
      evaluatePolicy(
        "TAOYUAN_CENTRAL_RENT_115",
        policySets.taoyuan ?? defaultTaoyuanRules,
        applicant,
        options
      )
    );
  }

  // 未涵蓋或缺少縣市：明確標示邊界，不得退回只用中央規則判定
  if (coverage.status !== "COVERED") {
    policyResults.push(
      coverageBoundaryResult(coverage)
    );
  }

  applyUpstreamCentralDependency(policyResults);

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
