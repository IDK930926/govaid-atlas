import assert from "node:assert/strict";
import test from "node:test";
import { evaluateChildcarePolicy } from "../childcare";
import { getApplicationGuide } from "../navigation";
import { buildChildcareDecisionPassport, buildDecisionPassport } from "../passport";
import { evaluatePolicyValidity } from "../rules";
import { callTool } from "./tools";
import {
  resumeAgentWithFieldResponse,
  runAgenticGoldenCase,
  validatePlannerProposal,
} from "./orchestrator";
import type { AddressScenario, ApplicantProfile } from "../types";
import type { ScenarioResult } from "../scenario";

const newTaipeiScenario: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區中正路100號",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const taipeiScenario: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區羅斯福路五段88號",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

const taoyuanScenario: AddressScenario = {
  type: "ACTUAL",
  address: "桃園市桃園區中正路50號",
  city: "桃園市",
  district: "桃園區",
  monthlyRent: 12000,
};

test("CHILD-01 — 10-month-old 1st child eligible for under-2 childcare allowance returns PASS and 5,000 NTD/month", () => {
  const applicant: ApplicantProfile = {
    childAgeMonths: 10,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
    childRegisteredCity: "臺北市",
  };

  const result = evaluateChildcarePolicy(applicant);
  assert.equal(result.policyId, "CHILDCARE_ALLOWANCE_UNDER_2_115");
  assert.equal(result.overallStatus, "PASS");
  assert.equal(result.eligibilityStatus, "PASS");
  assert.equal(result.estimatedMonthlyBenefitNtd, 5000);
  assert.ok(result.benefitTierLabel?.includes("5,000"));
  assert.equal(result.passedConditions.length, 5);
  assert.equal(result.failedConditions.length, 0);
  assert.equal(result.missingConditions.length, 0);

  const run = runAgenticGoldenCase(
    "我家寶寶目前 10 個月大，是第 1 胎，已完成出生登記且自己帶，想查詢未滿2歲育兒津貼資格",
    applicant,
    newTaipeiScenario,
    taipeiScenario,
    undefined,
    { includePassport: true }
  );
  assert.equal(run.domain, "CHILDCARE");
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.childcareStatus, "PASS");
  assert.equal(run.state?.overallEligibilityStatus, "PASS");
  assert.ok(run.state?.completedTools.includes("evaluate_childcare_rules"));
  assert.ok(run.state?.completedTools.includes("generate_childcare_passport"));
  assert.equal(run.state?.completedTools.includes("evaluate_central_rules"), false);
});

test("CHILD-02 — 18-month-old 2nd child returns PASS with 6,000 NTD/month, and 3rd child returns 7,000 NTD/month", () => {
  const secondChild: ApplicantProfile = {
    childAgeMonths: 18,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 2,
    childRegisteredCity: "新北市",
  };

  const res2 = evaluateChildcarePolicy(secondChild);
  assert.equal(res2.eligibilityStatus, "PASS");
  assert.equal(res2.estimatedMonthlyBenefitNtd, 6000);
  assert.ok(res2.benefitTierLabel?.includes("6,000"));

  const thirdChild: ApplicantProfile = {
    ...secondChild,
    birthOrder: 3,
  };
  const res3 = evaluateChildcarePolicy(thirdChild);
  assert.equal(res3.eligibilityStatus, "PASS");
  assert.equal(res3.estimatedMonthlyBenefitNtd, 7000);
  assert.ok(res3.benefitTierLabel?.includes("7,000"));
});

test("CHILD-03 — Child receiving public or quasi-public childcare service returns FAIL with exclusion explanation", () => {
  const excludedApplicant: ApplicantProfile = {
    childAgeMonths: 12,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: true,
    birthOrder: 1,
  };

  const result = evaluateChildcarePolicy(excludedApplicant);
  assert.equal(result.eligibilityStatus, "FAIL");
  assert.equal(result.estimatedMonthlyBenefitNtd, null);
  assert.ok(
    result.exclusionReasons.some((r) => r.includes("公共化或準公共托育服務")),
    "must explain public/quasi-public childcare exclusion"
  );

  const run = runAgenticGoldenCase(
    "請問 12 個月大寶寶送準公共保母還可以領未滿2歲育兒津貼嗎？",
    excludedApplicant,
    newTaipeiScenario,
    taipeiScenario
  );
  assert.equal(run.domain, "CHILDCARE");
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.overallEligibilityStatus, "FAIL");
});

test("CHILD-04 — Missing childcare required field triggers WAITING_FOR_HUMAN and dynamic question, then resumes to PASS", () => {
  const incompleteApplicant: ApplicantProfile = {
    childAgeMonths: 8,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: null,
    birthOrder: 1,
  };

  const initialRun = runAgenticGoldenCase(
    "我想查詢 8 個月大寶寶的育兒津貼資格",
    incompleteApplicant,
    newTaipeiScenario,
    taipeiScenario
  );

  assert.equal(initialRun.domain, "CHILDCARE");
  assert.equal(initialRun.status, "WAITING_FOR_HUMAN");
  assert.equal(initialRun.missingField, "receivesPublicOrQuasiPublicChildcare");
  assert.ok(initialRun.humanInputRequired?.includes("公共化或準公共托育服務"));

  const resumedRun = resumeAgentWithFieldResponse(
    initialRun,
    "receivesPublicOrQuasiPublicChildcare",
    false,
    newTaipeiScenario,
    taipeiScenario
  );

  assert.equal(resumedRun.status, "COMPLETED");
  assert.equal(resumedRun.state?.childcareStatus, "PASS");
  assert.equal(resumedRun.state?.overallEligibilityStatus, "PASS");
  assert.ok(resumedRun.state?.completedTools.includes("generate_childcare_passport"));
});

test("CHILD-05 — 26-month-old child (over age boundary < 24 months) returns FAIL", () => {
  const overAgeApplicant: ApplicantProfile = {
    childAgeMonths: 26,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const result = evaluateChildcarePolicy(overAgeApplicant);
  assert.equal(result.eligibilityStatus, "FAIL");
  assert.equal(result.estimatedMonthlyBenefitNtd, null);
  assert.ok(result.failedConditions.some((c) => c.includes("26 個月") && c.includes("未滿 24 個月")));
});

test("TAO-01 — Supported Taoyuan rental workflow returns PARTIAL_CHECK (not NOT_COVERED) and enforces Taoyuan income cap", () => {
  const taoyuanApplicant: ApplicantProfile = {
    age: 26,
    maritalStatus: "single",
    childrenCount: 0,
    registeredCity: "桃園市",
    ownsHome: false,
    receivesOtherHousingAid: false,
    monthlyIncome: 38000,
  };

  const scenarioTool = callTool("evaluate_actual_scenario", {
    profile: taoyuanApplicant,
    scenario: taoyuanScenario,
  });
  assert.equal(scenarioTool.status, "PARTIAL_CHECK");
  const scenarioResult = scenarioTool.result as ScenarioResult;
  const policyIds = scenarioResult.policyResults.map((p) => p.policyId);
  assert.ok(policyIds.includes("CENTRAL_RENT_115"));
  assert.ok(policyIds.includes("TAOYUAN_CENTRAL_RENT_115"));
  assert.equal(policyIds.includes("LOCAL_COVERAGE_BOUNDARY"), false);

  const run = runAgenticGoldenCase(
    "我目前租屋在桃園市桃園區，想查詢可申請的租屋補助與申辦方式",
    taoyuanApplicant,
    taoyuanScenario,
    taipeiScenario,
    undefined,
    { includePassport: true }
  );
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.actualStatus, "PARTIAL_CHECK");
  assert.notEqual(run.state?.actualStatus, "NOT_COVERED");
  assert.notEqual(run.state?.actualStatus, "PASS");

  // Exceeding Taoyuan's 50,304 NTD/month income threshold causes deterministic FAIL
  const overIncomeApplicant: ApplicantProfile = {
    ...taoyuanApplicant,
    monthlyIncome: 55000,
  };
  const overIncomeTool = callTool("evaluate_actual_scenario", {
    profile: overIncomeApplicant,
    scenario: taoyuanScenario,
  });
  assert.equal(overIncomeTool.status, "FAIL");
});

test("TAO-02 — Unsupported Taoyuan local-only or out-of-scope housing queries remain NOT_COVERED", () => {
  const taoyuanApplicant: ApplicantProfile = {
    age: 26,
    maritalStatus: "single",
    childrenCount: 0,
    registeredCity: "桃園市",
    ownsHome: false,
    receivesOtherHousingAid: false,
    monthlyIncome: 38000,
  };

  const localOnlyRun = runAgenticGoldenCase(
    "我住在桃園市桃園區，想確認地方租屋補助",
    taoyuanApplicant,
    taoyuanScenario,
    taoyuanScenario
  );
  assert.equal(localOnlyRun.state?.actualStatus, "NOT_COVERED");
  assert.equal(localOnlyRun.state?.overallEligibilityStatus, "NOT_COVERED");

  const indigenousRun = runAgenticGoldenCase(
    "請問桃園市原住民族租金補貼怎麼申請？",
    taoyuanApplicant,
    taoyuanScenario,
    taipeiScenario
  );
  assert.equal(indigenousRun.status, "NOT_COVERED");
  assert.equal(indigenousRun.coverage?.status, "NOT_COVERED");
});

test("NAV-01 — Housing Decision Passport exposes complete ApplicationGuide (required docs, official URLs, agency, next steps)", () => {
  const applicant: ApplicantProfile = {
    age: 26,
    maritalStatus: "single",
    childrenCount: 0,
    registeredCity: "桃園市",
    ownsHome: false,
    receivesOtherHousingAid: false,
    monthlyIncome: 38000,
    centralRentApproved: true,
  };

  const actual = callTool("evaluate_actual_scenario", {
    profile: applicant,
    scenario: taoyuanScenario,
  }).result as ScenarioResult;
  const whatIf = callTool("evaluate_what_if_scenario", {
    profile: applicant,
    scenario: taipeiScenario,
  }).result as ScenarioResult;

  const passport = buildDecisionPassport("CASE-NAV-01", applicant, actual, whatIf);
  assert.equal(passport.domain, "HOUSING");
  assert.ok(passport.applicationGuides.length >= 2);

  const taoyuanGuide = passport.applicationGuides.find((g) => g.policyId === "TAOYUAN_CENTRAL_RENT_115");
  assert.ok(taoyuanGuide, "Taoyuan ApplicationGuide must be attached to DecisionPassport");
  assert.equal(taoyuanGuide.applicationStatus, "OPEN");
  assert.equal(taoyuanGuide.onlineApplicationUrl, "https://has.nlma.gov.tw/subsidyOnline/");
  assert.ok(taoyuanGuide.administeringAgency.includes("桃園市政府住宅發展處"));
  assert.ok(taoyuanGuide.requiredDocuments.length >= 3);
  assert.ok(taoyuanGuide.applicationMethods.length >= 2);
  assert.ok(taoyuanGuide.nextSteps.length >= 2);
  assert.ok(taoyuanGuide.officialSources.some((s) => s.sourceId === "R9"));
  assert.ok(passport.disclaimer.includes("受理主管機關正式審查為準"));
});

test("NAV-02 — Childcare Decision Passport exposes complete ApplicationGuide (required docs, twbaby.sfaa.gov.tw link, next steps)", () => {
  const applicant: ApplicantProfile = {
    childAgeMonths: 6,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
    childRegisteredCity: "桃園市",
  };

  const evalResult = evaluateChildcarePolicy(applicant);
  const passport = buildChildcareDecisionPassport("CASE-NAV-02", applicant, evalResult);

  assert.equal(passport.domain, "CHILDCARE");
  assert.equal(passport.actual.overallStatus, "PASS");
  assert.equal(passport.childcare?.estimatedMonthlyBenefitNtd, 5000);
  assert.equal(passport.applicationGuides.length, 1);

  const guide = passport.applicationGuides[0]!;
  assert.equal(guide.policyId, "CHILDCARE_ALLOWANCE_UNDER_2_115");
  assert.equal(guide.applicationStatus, "ROLLING");
  assert.equal(guide.onlineApplicationUrl, "https://twbaby.sfaa.gov.tw/");
  assert.ok(guide.administeringAgency.includes("衛生福利部社會及家庭署"));
  assert.ok(guide.officeInformation.includes("桃園市"));
  assert.ok(guide.requiredDocuments.length >= 3);
  assert.ok(guide.officialSources.some((s) => s.sourceId === "R8"));
  assert.ok(passport.nextSteps.some((step) => step.includes("https://twbaby.sfaa.gov.tw/")));
});

test("Policy Validity & Expiration — expired policy never produces a current PASS and marks guide CLOSED", () => {
  const validity = evaluatePolicyValidity("2026-01-01", "2026-12-31", {
    asOfDate: "2028-01-01",
  });
  assert.equal(validity.isValidNow, false);
  assert.equal(validity.validityStatus, "EXPIRED");

  const applicant: ApplicantProfile = {
    childAgeMonths: 10,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const expiredEval = evaluateChildcarePolicy(applicant, { asOfDate: "2028-01-01" });
  assert.equal(expiredEval.eligibilityStatus, "FAIL", "expired policy must never return PASS");
  assert.equal(expiredEval.applicationGuide.applicationStatus, "CLOSED");
  assert.equal(expiredEval.applicationGuide.validityStatus, "EXPIRED");

  const historicalGuide = getApplicationGuide("CENTRAL_RENT_115", {
    asOfDate: "2028-01-01",
    allowHistorical: true,
  });
  assert.equal(historicalGuide?.applicationStatus, "CLOSED");
  assert.equal(historicalGuide?.validityStatus, "HISTORICAL_MODE");
});

test("Domain Isolation — planner proposal to call housing tool on CHILDCARE run is rejected and falls back to childcare tool", () => {
  const childcareApplicant: ApplicantProfile = {
    childAgeMonths: 10,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const validation = validatePlannerProposal(
    {
      reasoningSummary: "Wrongly propose housing tool for a childcare run.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
    },
    {
      domain: "CHILDCARE",
      applicant: childcareApplicant,
      actualScenario: newTaipeiScenario,
      whatIfScenario: taipeiScenario,
      requiredFields: [],
      completedTools: [],
      executedAtSignature: new Set(),
    }
  );
  assert.equal(validation.valid, false);
  assert.equal(validation.proposalRejected, true);
  assert.match(String(validation.rejectionReason), /DOMAIN_MISMATCH_HOUSING_TOOL_ON_CHILDCARE_RUN/);
});
