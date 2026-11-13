import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaseDraft,
  buildPersonaChips,
  CASE_PRESETS,
  DEFAULT_GOAL,
  DUAL_CITY_ACTUAL_SCENARIO,
  extractFactsFromGoal,
  FIELD_SPECS,
  getGateControl,
  PRESET_CHILDCARE_APPLICANT,
  PRESET_HOUSING_APPLICANT,
  PRESET_TAOYUAN_APPLICANT,
  submitHumanGateAnswer,
  TAOYUAN_ACTUAL_SCENARIO,
  validateCaseFieldInput,
} from "../case-input";
import { runAgenticGoldenCase } from "./orchestrator";
import { validateMissingFieldInput } from "./missing-fields";
import type { AddressScenario, ApplicantProfile } from "../types";

const actualNewTaipei: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfTaipei: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

test("CUSTOM-HOUSING-01 — Arbitrary 28-year-old Taipei profile is evaluated (not 20yo preset)", () => {
  const goal = "我是 28 歲，住臺北市，戶籍在臺北市，月薪 42000 元，沒有房子";
  const draft = buildCaseDraft(goal);

  assert.equal(draft.domain, "HOUSING");
  assert.equal(draft.applicant.age, 28);
  assert.equal(draft.applicant.registeredCity, "臺北市");
  assert.equal(draft.applicant.monthlyIncome, 42000);
  assert.equal(draft.applicant.ownsHome, false);
  assert.equal(draft.actualScenario.city, "臺北市");

  // Persona chips match the extracted arbitrary facts
  const chips = buildPersonaChips(draft.domain, draft.applicant, draft.actualScenario);
  assert.ok(chips.some((c) => c.label.includes("28 歲")));
  assert.ok(chips.some((c) => c.label.includes("42,000")));
  assert.ok(chips.some((c) => c.label.includes("沒有")));

  // Run the Agent with this profile
  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    { includePassport: true }
  );

  assert.equal(run.state?.applicant.age, 28, "evaluated profile must contain age 28, not preset 20");
  assert.equal(run.state?.applicant.monthlyIncome, 42000);
  assert.equal(run.state?.applicant.ownsHome, false);
  assert.equal(run.state?.actualScenario.city, "臺北市");
  assert.notEqual(run.state?.applicant.age, PRESET_HOUSING_APPLICANT.age);
});

test("CUSTOM-HOUSING-01A — Dual-North requests default to Taipei and New Taipei with shared rent", () => {
  const goal = "想比較雙北租屋補助，月租 18,000 元";
  const draft = buildCaseDraft(goal);
  const facts = extractFactsFromGoal(goal, "HOUSING");

  assert.equal(facts.dualCityComparison, true);
  assert.equal(draft.actualScenario.city, "臺北市");
  assert.equal(draft.whatIfScenario.city, "新北市");
  assert.equal(draft.actualScenario.monthlyRent, 18000);
  assert.equal(draft.whatIfScenario.monthlyRent, 18000);

  const explicitCities = buildCaseDraft("目前住新北市、未來搬到臺北市，想比較雙北租屋補助");
  assert.equal(
    extractFactsFromGoal("目前住新北市、未來搬到臺北市，想比較雙北租屋補助", "HOUSING").dualCityComparison,
    undefined
  );
  assert.equal(explicitCities.actualScenario.city, "新北市");
  assert.equal(explicitCities.whatIfScenario.city, "臺北市");
  assert.equal(extractFactsFromGoal(DEFAULT_GOAL, "HOUSING").dualCityComparison, undefined);

  const manuallyChanged = buildCaseDraft(goal, {
    HOUSING: { whatIfCity: "桃園市" },
    CHILDCARE: {},
  });
  assert.equal(manuallyChanged.actualScenario.city, "臺北市");
  assert.equal(manuallyChanged.whatIfScenario.city, "桃園市");
  assert.equal(manuallyChanged.whatIfScenario.monthlyRent, 18000);

  const taipeiStudentFacts = extractFactsFromGoal(
    "申請人戶籍在桃園市，目前就讀國立政治大學，想查租屋補助",
    "HOUSING"
  );
  assert.equal(taipeiStudentFacts.registeredCity, "桃園市");
  assert.equal(taipeiStudentFacts.studyCity, "臺北市");
});

test("CUSTOM-HOUSING-02 — Taoyuan workflow evaluates user-provided 60000 income (not preset 38000)", () => {
  const goal = "我目前租屋在桃園市，年齡 25 歲，月薪 60,000 元，想查詢可申請的租屋補助";
  const edits = {
    HOUSING: { ownsHome: "false", receivesOtherHousingAid: "false" },
    CHILDCARE: {},
  };
  const draft = buildCaseDraft(goal, edits);

  assert.equal(draft.domain, "HOUSING");
  assert.equal(draft.applicant.age, 25);
  assert.equal(draft.applicant.monthlyIncome, 60000);
  assert.equal(draft.actualScenario.city, "桃園市");
  assert.equal(draft.applicant.ownsHome, false);
  assert.equal(draft.applicant.receivesOtherHousingAid, false);

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    {
      includePassport: true,
      requiredFields: ["ownsHome", "receivesOtherHousingAid"],
    }
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.applicant.monthlyIncome, 60000);
  assert.notEqual(run.state?.applicant.monthlyIncome, 38000);

  // In Taoyuan, 60000 exceeds the cap 50,304 NTD
  // Rule TAOYUAN-115-INCOME-001 should evaluate to FAIL
  const passportCompleted = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_decision_passport"
  );
  const passport = (passportCompleted?.output as { result?: { actual?: { programs?: Array<{ policyId: string; status: string; ruleResults?: Array<{ ruleId: string; status: string }> }> } } })?.result;
  const taoProgram = passport?.actual?.programs?.find((p) => p.policyId === "TAOYUAN_CENTRAL_RENT_115");
  assert.ok(taoProgram, "Taoyuan program must be evaluated");
  const incomeRule = taoProgram?.ruleResults?.find((r) => r.ruleId === "TAOYUAN-115-INCOME-001");
  assert.ok(incomeRule, "Taoyuan income rule must be evaluated");
  assert.equal(incomeRule?.status, "FAIL", "Income 60000 > 50304 must FAIL the Taoyuan income rule");
});

test("CUSTOM-HOUSING-03 — Custom age 65 is preserved in the runtime profile", () => {
  const goal = "新北市青年租屋補助";
  const edits = {
    HOUSING: { age: "65" },
    CHILDCARE: {},
  };
  const draft = buildCaseDraft(goal, edits);

  assert.equal(draft.applicant.age, 65);
  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario
  );

  assert.equal(run.state?.applicant.age, 65, "runtime profile must preserve age 65");
});

test("CUSTOM-CHILD-01 — 18-month 2nd child evaluates entered values and calculates verified 6,000 NTD tier", () => {
  const goal = "我的小孩 18 個月，是第二胎，目前自己帶沒有送準公共托育，也沒有公費安置，已報戶口";
  const draft = buildCaseDraft(goal);

  assert.equal(draft.domain, "CHILDCARE");
  assert.equal(draft.applicant.childAgeMonths, 18);
  assert.equal(draft.applicant.birthOrder, 2);
  assert.equal(draft.applicant.receivesPublicOrQuasiPublicChildcare, false);
  assert.equal(draft.applicant.isGovernmentPlaced, false);
  assert.equal(draft.applicant.childHasBirthOrInitialHouseholdRegistration, true);

  const chips = buildPersonaChips(draft.domain, draft.applicant, draft.actualScenario);
  assert.ok(chips.some((c) => c.label.includes("18 個月")));
  assert.ok(chips.some((c) => c.label.includes("第 2 胎")));

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    { includePassport: true }
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.childcareStatus, "PASS");
  assert.equal(run.state?.applicant.childAgeMonths, 18);
  assert.equal(run.state?.applicant.birthOrder, 2);

  const passportCompleted = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_childcare_passport"
  );
  const passport = (passportCompleted?.output as { result?: { childcare?: { estimatedMonthlyBenefitNtd?: number; benefitTierLabel?: string } } })?.result;
  assert.equal(passport?.childcare?.estimatedMonthlyBenefitNtd, 6000, "Second child must receive 6,000 NTD/month");
  assert.ok(passport?.childcare?.benefitTierLabel?.includes("6,000"));
});

test("CUSTOM-CHILD-02 — 18-month child receiving public or quasi-public childcare evaluates to FAIL", () => {
  const goal = "我的小孩 18 個月，正在送托準公共保母，想查詢育兒津貼";
  const draft = buildCaseDraft(goal);

  assert.equal(draft.domain, "CHILDCARE");
  assert.equal(draft.applicant.childAgeMonths, 18);
  assert.equal(draft.applicant.receivesPublicOrQuasiPublicChildcare, true);

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.childcareStatus, "FAIL");
  assert.equal(run.state?.overallEligibilityStatus, "FAIL");
});

test("CUSTOM-MISSING-01 — Missing monthlyIncome triggers WAITING_FOR_HUMAN, accepts numeric input, and resumes", () => {
  const applicant: ApplicantProfile = {
    ...PRESET_HOUSING_APPLICANT,
    ownsHome: false,
    receivesOtherHousingAid: false,
    monthlyIncome: null,
  };

  const run = runAgenticGoldenCase(
    "我想查詢桃園市租屋補助",
    applicant,
    TAOYUAN_ACTUAL_SCENARIO,
    whatIfTaipei,
    undefined,
    { requiredFields: ["ownsHome", "receivesOtherHousingAid", "monthlyIncome"] }
  );

  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.missingField, "monthlyIncome");

  // Human Gate control exists and is numeric
  const control = getGateControl("monthlyIncome");
  assert.ok(control);
  assert.equal(control?.kind, "number");

  // Invalid input fails safely
  const invalid = submitHumanGateAnswer(run, "invalid-income");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.run.status, "WAITING_FOR_HUMAN");
  assert.ok(invalid.error);

  // Valid arbitrary numeric input resumes and completes
  const valid = submitHumanGateAnswer(run, 45000);
  assert.equal(valid.ok, true);
  assert.equal(valid.run.status, "COMPLETED");
  assert.equal(valid.run.state?.applicant.monthlyIncome, 45000);
});

test("CUSTOM-MISSING-02 — Missing childAgeMonths accepts arbitrary valid numeric month values", () => {
  const applicant: ApplicantProfile = {
    childAgeMonths: null,
    birthOrder: 1,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
  };

  const run = runAgenticGoldenCase(
    "我想查詢未滿2歲育兒津貼",
    applicant,
    actualNewTaipei,
    whatIfTaipei
  );

  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.missingField, "childAgeMonths");

  const control = getGateControl("childAgeMonths");
  assert.ok(control);
  assert.equal(control?.kind, "integer");

  // Enter arbitrary 15 months (not hardcoded 10 or 26)
  const submission = submitHumanGateAnswer(run, "15");
  assert.equal(submission.ok, true);
  assert.equal(submission.run.status, "COMPLETED");
  assert.equal(submission.run.state?.applicant.childAgeMonths, 15);
  assert.equal(submission.run.state?.childcareStatus, "PASS");
});

test("PRESET-SYNC-01 — Three one-click presets synchronize visible persona immediately", () => {
  // Preset A: Dual-city housing
  const draftA = buildCaseDraft(CASE_PRESETS[0].goal);
  assert.equal(draftA.domain, "HOUSING");
  assert.equal(draftA.applicant.age, 20);
  assert.equal(draftA.actualScenario.city, "新北市");
  const chipsA = buildPersonaChips(draftA.domain, draftA.applicant, draftA.actualScenario);
  assert.ok(chipsA.some((c) => c.label.includes("20 歲")));
  assert.ok(chipsA.some((c) => c.label.includes("新北")));

  // Preset B: Taoyuan housing
  const draftB = buildCaseDraft(CASE_PRESETS[1].goal);
  assert.equal(draftB.domain, "HOUSING");
  assert.equal(draftB.applicant.registeredCity, "桃園市");
  assert.equal(draftB.applicant.monthlyIncome, 38000);
  assert.equal(draftB.actualScenario.city, "桃園市");
  const chipsB = buildPersonaChips(draftB.domain, draftB.applicant, draftB.actualScenario);
  assert.ok(chipsB.some((c) => c.label.includes("桃園")));
  assert.ok(chipsB.some((c) => c.label.includes("38,000")));

  // Preset C: Childcare under-2
  const draftC = buildCaseDraft(CASE_PRESETS[2].goal);
  assert.equal(draftC.domain, "CHILDCARE");
  assert.equal(draftC.applicant.childAgeMonths, 10);
  assert.equal(draftC.applicant.birthOrder, 1);
  const chipsC = buildPersonaChips(draftC.domain, draftC.applicant, draftC.actualScenario);
  assert.ok(chipsC.some((c) => c.label.includes("10 個月")));
  assert.ok(chipsC.some((c) => c.label.includes("第 1 胎")));
  // Must NOT contain housing chips
  assert.ok(!chipsC.some((c) => c.label.includes("租屋")));
  assert.ok(!chipsC.some((c) => c.label.includes("月租")));
});

test("DOMAIN-ISOLATION — Facts do not leak across housing and childcare domains", () => {
  const edits = {
    HOUSING: { ownsHome: "false", monthlyIncome: "45000" },
    CHILDCARE: { childAgeMonths: "14", birthOrder: "1" },
  };

  // Build housing draft
  const housingDraft = buildCaseDraft("租屋補助查詢", edits);
  assert.equal(housingDraft.domain, "HOUSING");
  assert.equal(housingDraft.applicant.childAgeMonths, undefined, "Childcare fields must not leak into housing");
  assert.equal(housingDraft.applicant.birthOrder, undefined);

  // Build childcare draft
  const childcareDraft = buildCaseDraft("育兒津貼查詢", edits);
  assert.equal(childcareDraft.domain, "CHILDCARE");
  assert.equal(childcareDraft.applicant.ownsHome, undefined, "Housing fields must not leak into childcare");
  assert.equal(childcareDraft.applicant.monthlyIncome, undefined);
});

test("HUMAN-GATE-ALL-FIELDS — All 14 supported fields have gate controls and validate safely", () => {
  const fields = [
    "monthlyIncome",
    "age",
    "city",
    "registeredCity",
    "ownsHome",
    "receivesOtherHousingAid",
    "centralRentApproved",
    "newTaipeiResidenceStudyWork",
    "childAgeMonths",
    "birthOrder",
    "childHasBirthOrInitialHouseholdRegistration",
    "receivesPublicOrQuasiPublicChildcare",
    "isGovernmentPlaced",
    "childRegisteredCity",
  ] as const;

  for (const field of fields) {
    const control = getGateControl(field);
    assert.ok(control, `Field ${field} must have a gate control`);
    assert.ok(control?.label, `Field ${field} must have a descriptive label`);
  }

  // Validate negative number rejected
  assert.equal(validateMissingFieldInput("age", -5).valid, false);
  assert.equal(validateMissingFieldInput("age", 150).valid, false);
  assert.equal(validateMissingFieldInput("age", "not-num").valid, false);
  assert.equal(validateMissingFieldInput("monthlyIncome", -100).valid, false);
  assert.equal(validateMissingFieldInput("childAgeMonths", -1).valid, false);
  assert.equal(validateMissingFieldInput("birthOrder", 0).valid, false);
  assert.equal(validateMissingFieldInput("city", "InvalidCityXYZ").valid, false);
});
