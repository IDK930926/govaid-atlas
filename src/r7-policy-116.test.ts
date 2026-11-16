import assert from "node:assert/strict";
import test from "node:test";
import newTaipeiRules from "./policies/new-taipei-rent-115.json";
import { callTool } from "./agent/tools";
import { getEvidence } from "./evidence";
import { estimateRentalSubsidyComparison, getApplicationGuide, RENTAL_SUBSIDY_COMPARISON_METADATA } from "./navigation";
import { buildDecisionPassport } from "./passport";
import type { ScenarioResult } from "./scenario";
import type { AddressScenario, ApplicantProfile, PolicyRule } from "./types";
import { getPolicyCoverageLimitation } from "./ui-copy";

// Verified 2026-11-16 against 新北市政府城鄉發展局 official materials:
//  - 公告 新北城住字第1151855676號 (115/9/23): 116年度 受理 115/10/1–116/12/31 或經費用罄止；
//    115年度方案自 115/10/1 廢止並停止受理；補貼額度 3,500/4,500/5,000/6,000/7,000。
//  - 116年度新北市青年租金補貼申請書；線上申請 https://nths.ntpc.gov.tw/FC

const guide = () => getApplicationGuide("NEW_TAIPEI_RENT_115", { asOfDate: "2026-11-16" })!;
const rules = newTaipeiRules as PolicyRule[];

test("R7-116-1 — the displayed New Taipei youth rental programme is 116年度", () => {
  assert.match(guide().programTitle, /^116年度新北市青年租金補貼$/);
  assert.match(getEvidence("R7")!.policyName, /^116年度/);
  for (const rule of rules) assert.equal(rule.program, "116新北市青年租金補貼");
});

test("R7-116-2 — application period begins 2026-10-01 (115/10/1)", () => {
  assert.equal(guide().validFrom, "2026-10-01");
  for (const rule of rules) assert.equal(rule.validFrom, "2026-10-01");
  assert.match(guide().applicationPeriod, /^115年10月1日起/);
});

test("R7-116-3 — period ends 2027-12-31 with the official budget-exhausted caveat", () => {
  assert.equal(guide().validTo, "2027-12-31");
  assert.equal(guide().deadlineDate, "2027-12-31");
  for (const rule of rules) assert.equal(rule.validTo, "2027-12-31");
  assert.match(guide().applicationPeriod, /116年12月31日止，或至年度經費用罄為止/);
  assert.equal(guide().applicationStatus, "OPEN");
});

test("R7-116-4 — evidence points to the 116年度 announcement, with 115 provenance kept", () => {
  const evidence = getEvidence("R7")!;
  assert.match(evidence.url, /^https:\/\/www\.planning\.ntpc\.gov\.tw\/uploaddowndoc\?file=planningapply\/202610010829240\.pdf/);
  assert.match(evidence.policyName, /新北城住字第1151855676號/);
  assert.equal(evidence.policyVersion, "NTPC-YOUTH-RENT-116");
  assert.match(evidence.supersedes ?? "", /115年度.*115\/10\/1 廢止/);
  assert.equal(evidence.lastVerifiedAt, "2026-11-16");
  assert.doesNotMatch(evidence.url, /shulin\.ris/, "the 115 application form is no longer the evidence");
});

test("R7-116-5 — application link and form are the current 116年度 ones", () => {
  const g = guide();
  assert.equal(g.onlineApplicationUrl, "https://nths.ntpc.gov.tw/FC");
  assert.match(g.formUrl ?? "", /planningapply\/202610010853260\.pdf/);
  assert.ok(g.requiredDocuments.some((doc) => doc.title.startsWith("116年度新北市青年租金補貼申請書")));
  assert.ok(!JSON.stringify(g).includes("115年度新北市青年租金補貼申請書"));
});

const newTaipei: AddressScenario = { type: "ACTUAL", address: "新北市永和區合成測試地址", city: "新北市", district: "永和區", monthlyRent: 13500 };
const profile = (overrides: Partial<ApplicantProfile>): ApplicantProfile => ({
  maritalStatus: "single", childrenCount: 0, age: 25, registeredCity: "臺北市", monthlyIncome: null,
  ownsHome: false, receivesOtherHousingAid: false, centralRentApproved: null, newTaipeiResidenceStudyWork: true,
  ...overrides,
}) as ApplicantProfile;
const evaluate = (applicant: ApplicantProfile) =>
  callTool("evaluate_actual_scenario", { profile: applicant, scenario: newTaipei }).result as ScenarioResult;

test("R7-116-6 — no-home-in-北北桃基 safety handling still works under the 116 validity window", () => {
  const owned = evaluate(profile({ ownsHome: true }));
  const r7 = owned.policyResults.find((policy) => policy.policyId === "NEW_TAIPEI_RENT_115")!;
  const home = r7.evaluations.find((evaluation) => evaluation.ruleId === "NEWTAIPEI-115-HOME-001")!;
  assert.equal(home.status, "UNCERTAIN");
  assert.equal(home.blocksEstimate, true);
  assert.doesNotMatch(estimateRentalSubsidyComparison(owned, "臺北市").maxSubsidy, /R7/);
});

test("R7-116-7 — subsidy amounts match the 116年度 announcement", () => {
  const option = RENTAL_SUBSIDY_COMPARISON_METADATA["新北市"].options.find((item) => item.policyId === "NEW_TAIPEI_RENT_115")!;
  assert.equal(option.minNtd, 3500, "single-person amount (only bracket the estimate uses)");
  assert.equal(option.maxNtd, 3500);
  for (const amount of ["3,500", "4,500", "5,000", "6,000", "7,000"]) {
    assert.ok(guide().benefitAmountFormula?.includes(amount), `formula lists ${amount}`);
  }
});

test("R7-116-8 — no income rule is claimed as evaluated; the limitation is explicit", () => {
  assert.ok(!rules.some((rule) => rule.field === "monthlyIncome"), "R7 encodes no income rule");
  assert.match(getPolicyCoverageLimitation("NEW_TAIPEI_RENT_115"), /家庭所得門檻未由本系統檢核/);
  assert.ok(guide().warnings.some((warning) => /本系統未檢核.*145萬元.*62,125元/.test(warning)));

  // A high-income applicant gets no income-based verdict and no "所得…通過" claim.
  const rich = profile({ monthlyIncome: 300000 });
  const result = evaluate(rich);
  const passport = buildDecisionPassport("CASE-TEST", rich, result, { ...result, scenario: { ...result.scenario, type: "WHAT_IF" } });
  const program = passport.actual.programs.find((item) => item.policyId === "NEW_TAIPEI_RENT_115")!;
  assert.ok(!program.passedConditions.some((condition) => condition.includes("所得")));
  assert.ok(!program.ruleResults.some((evaluation) => /income/i.test(evaluation.ruleId)));
});
