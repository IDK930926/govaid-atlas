import assert from "node:assert/strict";
import test from "node:test";
import newTaipeiRules from "./policies/new-taipei-rent-115.json";
import { callTool } from "./agent/tools";
import { estimateRentalSubsidyComparison } from "./navigation";
import { buildDecisionPassport } from "./passport";
import type { ScenarioResult } from "./scenario";
import type { AddressScenario, ApplicantProfile, PolicyRule } from "./types";

// Official basis: 116年度新北市青年租金補貼申請書（新北市政府城鄉發展局，R7）申請條件 3（115年度相同）：
// 「申請人及家庭成員於本市、臺北市、桃園市及基隆市均無自有住宅」；申請期限 115/10/1–116/12/31 或經費用罄止。
// The profile records only whether a home is owned, not where, so an owned home leaves R7
// undetermined (never PASS, never an estimate) rather than a blanket FAIL.

const newTaipei: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};
const taipei: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

function profile(overrides: Partial<ApplicantProfile>): ApplicantProfile {
  return {
    maritalStatus: "single",
    childrenCount: 0,
    age: 20,
    registeredCity: "臺北市",
    monthlyIncome: null,
    ownsHome: false,
    receivesOtherHousingAid: false,
    centralRentApproved: null,
    newTaipeiResidenceStudyWork: true,
    ...overrides,
  } as ApplicantProfile;
}

function evaluate(applicant: ApplicantProfile, scenario: AddressScenario): ScenarioResult {
  const tool = scenario.type === "ACTUAL" ? "evaluate_actual_scenario" : "evaluate_what_if_scenario";
  return callTool(tool, { profile: applicant, scenario }).result as ScenarioResult;
}

const r7 = (result: ScenarioResult) => result.policyResults.find((policy) => policy.policyId === "NEW_TAIPEI_RENT_115")!;

test("NT1 — R7 home rule is encoded from the official application period and source", () => {
  const rule = (newTaipeiRules as PolicyRule[]).find((item) => item.ruleId === "NEWTAIPEI-115-HOME-001");
  assert.ok(rule, "home-ownership rule must exist");
  assert.equal(rule.field, "ownsHome");
  assert.equal(rule.expected, false);
  assert.equal(rule.sourceId, "R7");
  assert.equal(rule.validFrom, "2026-10-01");
  assert.equal(rule.validTo, "2027-12-31");
  assert.equal(rule.mismatchStatus, "UNCERTAIN");
  for (const city of ["新北市", "臺北市", "桃園市", "基隆市"]) {
    assert.ok(rule.mismatchReason?.includes(city), `scope must name ${city}`);
  }
  assert.ok(!/\s/.test(rule.mismatchReason ?? ""), "UI gap label splits on whitespace");
});

test("NT2 — owning a home never leaves an R7 subsidy estimate visible", () => {
  const result = evaluate(profile({ ownsHome: true }), newTaipei);
  const program = r7(result);

  assert.notEqual(program.eligibilityStatus, "PASS");
  assert.notEqual(program.eligibilityStatus, "PARTIAL_CHECK");
  const home = program.evaluations.find((evaluation) => evaluation.ruleId === "NEWTAIPEI-115-HOME-001");
  assert.equal(home?.status, "UNCERTAIN");
  assert.equal(home?.blocksEstimate, true);

  const estimate = estimateRentalSubsidyComparison(result, "臺北市");
  assert.doesNotMatch(estimate.maxSubsidy, /NT\$3,500/);
  assert.doesNotMatch(estimate.maxSubsidy, /R7/);
  assert.doesNotMatch(estimate.outOfPocket, /NT\$/);
  // Central also FAILs on ownsHome, so nothing in this scenario may be estimated.
  assert.doesNotMatch(estimate.maxSubsidy, /資格皆未通過/, "R7 is pending, not failed");
});

test("NT3 — Decision Passport stays consistent for an owned home", () => {
  const applicant = profile({ ownsHome: true });
  const passport = buildDecisionPassport("CASE-TEST", applicant, evaluate(applicant, newTaipei), evaluate(applicant, { ...taipei }));
  const program = passport.actual.programs.find((item) => item.policyId === "NEW_TAIPEI_RENT_115")!;

  assert.equal(program.estimatedMonthlyBenefitNtd, null);
  assert.equal(program.applicationGuide?.estimatedMonthlyBenefitNtd ?? null, null);
  assert.ok(passport.missingItems.some((item) => item.includes("自有住宅") && item.includes("基隆市")));

  for (const scenario of [passport.actual, passport.whatIf]) {
    for (const item of scenario.programs.filter((p) => p.status === "FAIL")) {
      assert.equal(item.estimatedMonthlyBenefitNtd, null, `${item.policyId}: FAIL must not carry an amount`);
    }
  }
});

test("NT4 — no owned home keeps the existing R7 path and estimate unchanged", () => {
  const result = evaluate(profile({ ownsHome: false }), newTaipei);
  const home = r7(result).evaluations.find((evaluation) => evaluation.ruleId === "NEWTAIPEI-115-HOME-001");
  assert.equal(home?.status, "PASS");
  assert.equal(home?.blocksEstimate, undefined);
  assert.match(estimateRentalSubsidyComparison(result, "臺北市").maxSubsidy, /新北青年 R7.*NT\$3,500/);
});
