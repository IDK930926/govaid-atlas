// Wave 1 regression tests — Correctness & Safety Boundary.
// These cases reproduce audit findings G01 (overclaiming), G02 (wrong overall
// status aggregation) and G03 (coverage boundary). They must never be relaxed to
// match program output; if one fails, the production code is wrong.

import assert from "node:assert/strict";
import test from "node:test";

import { callTool } from "./agent/tools";
import { runAgenticGoldenCase } from "./agent/orchestrator";
import { buildDecisionPassport } from "./passport";
import { resultCopy } from "./ui-copy";
import * as statusModule from "./status";
import * as coverageModule from "./coverage";
import type { AddressScenario, ApplicantProfile } from "./types";

const FORBIDDEN_CLAIMS = [
  "符合所有資格",
  "符合所有條件",
  "資格通過",
  "確定可申請",
  "確定符合",
  "中央方案通過",
];

const supportedProfile: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",
  ownsHome: false,
  receivesOtherHousingAid: false,
  monthlyIncome: null,
  centralRentApproved: true,
  newTaipeiResidenceStudyWork: true,
};

const newTaipeiScenario: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const taipeiScenario: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

const taoyuanScenario: AddressScenario = {
  type: "ACTUAL",
  address: "桃園市桃園區合成測試地址",
  city: "桃園市",
  district: "桃園區",
  monthlyRent: 12000,
};

function userFacingLabel(status: string): string | undefined {
  return (resultCopy as Record<string, { zh: string } | undefined>)[status]?.zh;
}

function assertNoOverclaim(text: string) {
  for (const phrase of FORBIDDEN_CLAIMS) {
    assert.ok(!text.includes(phrase), `must not claim "${phrase}"`);
  }
}

// ---------------------------------------------------------------------------
// CASE A — unrealistic income must not yield a complete PASS
// ---------------------------------------------------------------------------
test("CASE A — monthlyIncome 999999 is not reported as central PASS", () => {
  const profile = { ...supportedProfile, monthlyIncome: 999999 };
  const central = callTool("evaluate_central_rules", { profile });
  assert.notEqual(central.status, "PASS");
  assert.notEqual(userFacingLabel(central.status), "通過");

  const actual = callTool("evaluate_actual_scenario", { profile, scenario: newTaipeiScenario });
  assert.notEqual(actual.status, "PASS");

  const whatIf = callTool("evaluate_what_if_scenario", { profile, scenario: taipeiScenario });
  const passport = buildDecisionPassport(
    "CASE-A",
    profile,
    actual.result as Parameters<typeof buildDecisionPassport>[2],
    whatIf.result as Parameters<typeof buildDecisionPassport>[3],
  );
  const centralProgram = passport.actual.programs.find((program) => program.policyId === "CENTRAL_RENT_115");
  assert.ok(centralProgram, "central program must be present in passport");
  assert.notEqual(centralProgram.status, "PASS");
  assert.notEqual(passport.actual.overallStatus, "PASS");
  assert.notEqual(passport.whatIf.overallStatus, "PASS");
  assertNoOverclaim(JSON.stringify(passport));
});

// ---------------------------------------------------------------------------
// CASE B — age 15 must not be declared fully eligible
// ---------------------------------------------------------------------------
test("CASE B — age 15 is not reported as eligible without full verification", () => {
  const profile = { ...supportedProfile, age: 15 };
  const central = callTool("evaluate_central_rules", { profile });
  assert.notEqual(central.status, "PASS");
  assert.notEqual(userFacingLabel(central.status), "通過");

  const actual = callTool("evaluate_actual_scenario", { profile, scenario: newTaipeiScenario });
  assert.notEqual(actual.status, "PASS");
  assertNoOverclaim(JSON.stringify(actual));
});

// ---------------------------------------------------------------------------
// CASE C — any explicit FAIL makes the overall result FAIL
// ---------------------------------------------------------------------------
test("CASE C — explicit rule FAIL (ownsHome = true) makes scenario overall FAIL", () => {
  const profile = { ...supportedProfile, ownsHome: true };

  const central = callTool("evaluate_central_rules", { profile });
  assert.equal(central.status, "FAIL");

  const actual = callTool("evaluate_actual_scenario", { profile, scenario: newTaipeiScenario });
  assert.equal(actual.status, "FAIL");

  const whatIf = callTool("evaluate_what_if_scenario", { profile, scenario: taipeiScenario });
  assert.equal(whatIf.status, "FAIL");

  const passport = buildDecisionPassport(
    "CASE-C",
    profile,
    actual.result as Parameters<typeof buildDecisionPassport>[2],
    whatIf.result as Parameters<typeof buildDecisionPassport>[3],
  );
  assert.equal(passport.actual.overallStatus, "FAIL");
  assert.equal(passport.whatIf.overallStatus, "FAIL");
});

// ---------------------------------------------------------------------------
// CASE D — Taoyuan supported central rental navigation vs uncovered local-only / uncovered city
// ---------------------------------------------------------------------------
test("CASE D — 桃園市 central rental workflow is PARTIAL_CHECK while local-only / uncovered city is NOT_COVERED and never PASS", () => {
  const actualSupported = callTool("evaluate_actual_scenario", { profile: supportedProfile, scenario: taoyuanScenario });
  assert.equal(actualSupported.status, "PARTIAL_CHECK");
  assert.notEqual(userFacingLabel(actualSupported.status), "通過");

  const actualLocalOnly = callTool("evaluate_actual_scenario", {
    profile: supportedProfile,
    scenario: taoyuanScenario,
    options: { localOnly: true },
  });
  assert.equal(actualLocalOnly.status, "NOT_COVERED");
  assert.notEqual(userFacingLabel(actualLocalOnly.status), "通過");
  const text = JSON.stringify(actualLocalOnly);
  assert.match(text, /尚未完整涵蓋桃園市/);
  assert.ok(!text.includes("不存在"), "must not claim the subsidy does not exist");
});

// ---------------------------------------------------------------------------
// CASE E — childcare queries never claim rental eligibility; unsupported childcare is NOT_COVERED
// ---------------------------------------------------------------------------
test("CASE E — childcare query routes to CHILDCARE domain without rental tools, and unsupported childcare is NOT_COVERED", () => {
  const supportedChildcareRun = runAgenticGoldenCase(
    "我有一個 1 歲小孩，想知道可以申請哪些育兒津貼？",
    supportedProfile,
    newTaipeiScenario,
    taipeiScenario,
  );
  assert.equal(supportedChildcareRun.domain, "CHILDCARE");
  assert.equal(supportedChildcareRun.status, "WAITING_FOR_HUMAN");
  assert.equal(
    supportedChildcareRun.auditTrail.some(
      (event) =>
        event.action === "AGENT_TOOL_COMPLETED" &&
        ["evaluate_central_rules", "evaluate_actual_scenario", "evaluate_what_if_scenario"].includes(
          String((event.input as { toolName?: string } | undefined)?.toolName ?? "")
        )
    ),
    false,
    "no rental tool may run on a childcare query",
  );

  const unsupportedChildcareRun = runAgenticGoldenCase(
    "請問 1 歲幼兒的托育補助怎麼申請？",
    supportedProfile,
    newTaipeiScenario,
    taipeiScenario,
  );
  assert.equal(unsupportedChildcareRun.status, "NOT_COVERED");
  assert.equal(
    unsupportedChildcareRun.auditTrail.some((event) => event.action === "AGENT_TOOL_COMPLETED"),
    false,
    "no tool may run for an out-of-coverage childcare query",
  );
  assert.equal(unsupportedChildcareRun.coverage?.status, "NOT_COVERED");
  assert.equal(unsupportedChildcareRun.coverage?.domain, "CHILDCARE");
  assert.ok(Array.isArray(unsupportedChildcareRun.coverage?.officialReferrals), "official referral structure must exist");
  assert.ok(!(unsupportedChildcareRun.coverage?.message ?? "").includes("不符合"), "not covered must not be phrased as ineligible");
});

// ---------------------------------------------------------------------------
// CASE F — missing required information must not PASS
// ---------------------------------------------------------------------------
test("CASE F — missing scenario city / required fields never PASS", () => {
  const noCity: AddressScenario = { type: "ACTUAL", address: "未提供地址", monthlyRent: 10000 };
  const missingCity = callTool("evaluate_actual_scenario", { profile: supportedProfile, scenario: noCity });
  assert.notEqual(missingCity.status, "PASS");
  assert.notEqual(missingCity.status, "PARTIAL_CHECK");

  const missingFields = callTool("evaluate_actual_scenario", { profile: {}, scenario: newTaipeiScenario });
  assert.notEqual(missingFields.status, "PASS");
  assert.equal(missingFields.status, "UNCERTAIN");
});

// ---------------------------------------------------------------------------
// G02 — aggregation priority unit tests
// ---------------------------------------------------------------------------
test("G02 — aggregateEligibilityStatus priority FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS", () => {
  const aggregate = statusModule.aggregateEligibilityStatus;
  assert.equal(typeof aggregate, "function");
  assert.equal(aggregate(["PASS", "FAIL", "PASS"]), "FAIL");
  assert.equal(aggregate(["NOT_COVERED", "FAIL"]), "FAIL");
  assert.equal(aggregate(["PASS", "NOT_COVERED"]), "NOT_COVERED");
  assert.equal(aggregate(["PARTIAL_CHECK", "UNCERTAIN"]), "UNCERTAIN");
  assert.equal(aggregate(["NOT_COVERED", "UNCERTAIN"]), "NOT_COVERED");
  assert.equal(aggregate(["PASS", "PARTIAL_CHECK"]), "PARTIAL_CHECK");
  assert.equal(aggregate(["PASS", "PASS"]), "PASS");
  assert.equal(aggregate([]), "UNCERTAIN", "no evidence must never become PASS");
});

test("G03 — coverage module flags childcare and uncovered cities", () => {
  assert.equal(coverageModule.assessQueryCoverage("想申請托育補助").status, "NOT_COVERED");
  assert.equal(coverageModule.assessQueryCoverage("我想申請未滿2歲育兒津貼").status, "COVERED");
  assert.equal(coverageModule.assessQueryCoverage("我想比較租屋補助").status, "COVERED");
  assert.equal(coverageModule.assessCityCoverage("桃園市").status, "COVERED");
  assert.equal(coverageModule.assessCityCoverage("桃園市", { localOnly: true }).status, "NOT_COVERED");
  assert.equal(coverageModule.assessCityCoverage("臺中市").status, "NOT_COVERED");
  assert.equal(coverageModule.assessCityCoverage("台北市").status, "COVERED");
  assert.equal(coverageModule.assessCityCoverage(undefined).status, "MISSING");
});
