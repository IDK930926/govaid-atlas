import type {
  AddressScenario,
  ApplicantProfile,
  PolicyRule,
  RuleEvaluation,
} from "./types";

import {
  evaluateRules,
  getOverallStatus,
} from "./rules";

export type PolicyResult = {
  policyId: string;
  evaluations: RuleEvaluation[];
  overallStatus:
  | "PASS"
  | "FAIL"
  | "UNCERTAIN";
};

export type ScenarioResult = {
  scenario: AddressScenario;
  policyResults: PolicyResult[];
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

  return {
    policyId,
    evaluations,
    overallStatus:
      getOverallStatus(evaluations),
  };
}

export function evaluateScenario(
  scenario: AddressScenario,
  applicant: ApplicantProfile,
  policySets: PolicySets
): ScenarioResult {
  const policyResults: PolicyResult[] = [];

  // 中央租補：兩個地址都要重新執行
  policyResults.push(
    evaluatePolicy(
      "CENTRAL_RENT_115",
      policySets.central,
      applicant
    )
  );

  // ACTUAL 永和
  if (scenario.city === "新北市") {
    policyResults.push(
      evaluatePolicy(
        "NEW_TAIPEI_RENT_115",
        policySets.newTaipei,
        applicant
      )
    );
  }

  // WHAT-IF 文山
  if (scenario.city === "臺北市") {
    policyResults.push(
      evaluatePolicy(
        "TAIPEI_RENT_115",
        policySets.taipei,
        applicant
      )
    );
  }

  return {
    scenario,
    policyResults,
  };
}