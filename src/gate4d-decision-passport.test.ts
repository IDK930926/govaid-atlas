import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseDraft, CASE_PRESETS, startCaseRun, submitHumanGateAnswer } from "./case-input";
import type { AgentRun } from "./agent/types";
import { evaluateChildcarePolicy } from "./childcare";
import {
  applyVerdictToGuide,
  CONDITIONAL_GUIDANCE_NOTE,
  guidanceModeFor,
  OFFICIAL_REFERENCE_LABEL,
  passportGuidanceNote,
} from "./guidance";
import { getApplicationGuide } from "./navigation";
import { buildChildcareDecisionPassport, type DecisionPassport } from "./passport";
import type { ApplicantProfile } from "./types";

// Gate 4D — Decision Passport consistency: the final verdict, amount, guide, next steps and
// risks of every program must agree. No eligibility rule is changed by these tests.

/** Text that tells the user to submit / apply now (online, at the office, by mail, upload). */
const SUBMIT_CTA = /提出申請|送件|上傳|線上申辦|臨櫃申辦|郵寄申辦|twbaby\.sfaa\.gov\.tw|has\.nlma\.gov\.tw|rent-allowance\.udd|nths\.ntpc/;
/** The stop step says "不建議送件申請" — a refusal, not a CTA. */
const isSubmitCta = (step: string) => SUBMIT_CTA.test(step) && !/不建議送件/.test(step);
/** Owner decision: one conditional notice above the steps, not a prefix on every step. */
const STEP_PREFIX = /^【/;
const TRANSITION_NOTE = "若後續改採托育補助，請依主管機關規定辦理原津貼停發／轉換；此為資訊提醒，不代表目前建議申請。";

function passportOf(run: AgentRun): DecisionPassport {
  const event = [...run.auditTrail].reverse().find(
    (item) =>
      item.action === "AGENT_TOOL_COMPLETED" &&
      /passport/.test(String((item.output as { toolName?: unknown } | undefined)?.toolName ?? ""))
  );
  const passport = (event?.output as { result?: DecisionPassport } | undefined)?.result;
  assert.ok(passport, "run produced a Decision Passport");
  return passport;
}

function answerAll(run: AgentRun, value: boolean): AgentRun {
  let current = run;
  for (let i = 0; i < 8 && current.status === "WAITING_FOR_HUMAN"; i++) {
    current = submitHumanGateAnswer(current, i === 0 ? value : false).run;
  }
  return current;
}

const childcareBase: ApplicantProfile = {
  childAgeMonths: 18,
  childHasBirthOrInitialHouseholdRegistration: true,
  receivesPublicOrQuasiPublicChildcare: false,
  isGovernmentPlaced: false,
  birthOrder: 1,
  childRegisteredCity: "新北市",
} as ApplicantProfile;

function childcarePassport(overrides: Partial<ApplicantProfile>) {
  const applicant = { ...childcareBase, ...overrides } as ApplicantProfile;
  return buildChildcareDecisionPassport("CASE-G4D", applicant, evaluateChildcarePolicy(applicant));
}

test("guidance mode mapping is total and verdict-driven", () => {
  assert.equal(guidanceModeFor("PASS"), "APPLY");
  assert.equal(guidanceModeFor("UNCERTAIN"), "CONDITIONAL");
  assert.equal(guidanceModeFor("PARTIAL_CHECK"), "CONDITIONAL");
  assert.equal(guidanceModeFor("FAIL"), "STOPPED");
  assert.equal(guidanceModeFor("NOT_COVERED"), "REFERENCE_ONLY");
});

test("DP1 — FAIL verdict suppresses the apply-now CTA", () => {
  const passport = childcarePassport({ receivesPublicOrQuasiPublicChildcare: true });
  assert.equal(passport.actual.overallStatus, "FAIL");
  const guide = passport.applicationGuides[0];
  for (const step of [...passport.nextSteps, ...guide.nextSteps]) {
    assert.ok(!isSubmitCta(step), `FAIL must not recommend submitting: ${step}`);
  }
  assert.ok(!passport.risks.some((risk) => /主動.*提出申請/.test(risk)), "no submission-procedure warning");
  assert.match(passport.nextSteps[0], /流程已停止/);
});

test("DP2 — FAIL verdict suppresses application submission steps (housing guide, generic helper)", () => {
  for (const policyId of ["CENTRAL_RENT_115", "TAIPEI_RENT_115", "NEW_TAIPEI_RENT_115", "TAOYUAN_CENTRAL_RENT_115", "CHILDCARE_ALLOWANCE_UNDER_2_115"]) {
    const base = getApplicationGuide(policyId, { status: "FAIL", estimatedMonthlyBenefitNtd: 5000 });
    assert.ok(base, policyId);
    assert.ok(base.nextSteps.some(isSubmitCta), `${policyId} static guide has submission steps to suppress`);
    const guide = applyVerdictToGuide(base, { status: "FAIL", failedConditions: ["名下持有住宅"] });
    assert.deepEqual(guide.nextSteps.length, 1, policyId);
    assert.match(guide.nextSteps[0], /流程已停止：名下持有住宅/);
    assert.ok(!guide.nextSteps.some(isSubmitCta), policyId);
    assert.deepEqual(guide.warnings, base.stoppedNotes ?? [], `${policyId}: only informational stoppedNotes survive`);
    assert.ok(!guide.warnings.some(isSubmitCta), `${policyId}: no submission-procedure warnings`);
  }
});

test("DP3 — FAIL verdict suppresses a misleading estimated benefit", () => {
  const base = getApplicationGuide("CHILDCARE_ALLOWANCE_UNDER_2_115", { estimatedMonthlyBenefitNtd: 5000 })!;
  const guide = applyVerdictToGuide(base, { status: "FAIL", failedConditions: [] });
  assert.equal(guide.estimatedMonthlyBenefitNtd, null);
  assert.equal(guide.benefitAmountFormula, undefined);

  const passport = childcarePassport({ receivesPublicOrQuasiPublicChildcare: true });
  const program = passport.actual.programs[0];
  assert.equal(program.estimatedMonthlyBenefitNtd, null);
  assert.equal(program.benefitSummary, undefined);
  assert.equal(passport.childcare?.estimatedMonthlyBenefitNtd, null);
});

test("DP4 — FAIL retains official evidence and contact as reference only", () => {
  const passport = childcarePassport({ receivesPublicOrQuasiPublicChildcare: true });
  const program = passport.actual.programs[0];
  assert.ok(program.evidence.some((item) => item.sourceId === "R8"));
  const guide = passport.applicationGuides[0];
  assert.ok(guide.officialSources.some((item) => item.sourceId === "R8"));
  assert.ok(guide.contactInformation.includes("1957"));
  const reference = passport.nextSteps.find((step) => step.startsWith(OFFICIAL_REFERENCE_LABEL));
  assert.ok(reference, "official contact kept, labelled as reference, not a recommendation");
  assert.ok(reference.includes("1957"));
});

test("DP5 — UNCERTAIN stays conditional: one notice above concise steps, never apply-now", () => {
  const passport = childcarePassport({ receivesPublicOrQuasiPublicChildcare: null });
  assert.equal(passport.actual.overallStatus, "UNCERTAIN");
  assert.ok(passport.missingItems.length > 0, "the open condition is listed");
  assert.equal(passport.guidanceNote, CONDITIONAL_GUIDANCE_NOTE);
  assert.match(passport.guidanceNote!, /初步／條件式結果/);
  assert.ok(!passport.nextSteps.some((step) => STEP_PREFIX.test(step)), "no per-step prefix");
  assert.ok(!passport.nextSteps.some((step) => /流程已停止/.test(step)));
  assert.equal(passport.actual.programs[0].estimatedMonthlyBenefitNtd, null);
});

test("DP6 — PARTIAL_CHECK stays conditional (dual-city: one notice, steps concise)", () => {
  const base = getApplicationGuide("CENTRAL_RENT_115", { status: "PARTIAL_CHECK", estimatedMonthlyBenefitNtd: 3000 })!;
  const guide = applyVerdictToGuide(base, { status: "PARTIAL_CHECK", failedConditions: [] });
  assert.deepEqual(guide.nextSteps, base.nextSteps, "guide steps stay concise");
  assert.equal(guide.estimatedMonthlyBenefitNtd, 3000, "a preliminary amount is not suppressed by PARTIAL_CHECK");

  const preset = CASE_PRESETS.find((item) => item.id === "housing-dual-city")!;
  const passport = passportOf(answerAll(startCaseRun(buildCaseDraft(preset.goal)), false));
  assert.equal(passport.guidanceNote, CONDITIONAL_GUIDANCE_NOTE);
  assert.ok(!passport.nextSteps.some((step) => STEP_PREFIX.test(step)), passport.nextSteps.join(" / "));
  assert.equal(passport.nextSteps.filter((step) => step === CONDITIONAL_GUIDANCE_NOTE).length, 0, "notice is not repeated as a step");
});

test("DP6b — notice mapping: PASS normal, FAIL stopped, NOT_COVERED reference-only", () => {
  assert.equal(passportGuidanceNote(["PASS"]), undefined);
  assert.equal(passportGuidanceNote([]), undefined, "FAIL-only passports have no pursuable program");
  assert.equal(passportGuidanceNote(["NOT_COVERED"]), undefined);
  assert.equal(passportGuidanceNote(["PASS", "PARTIAL_CHECK"]), CONDITIONAL_GUIDANCE_NOTE);
  assert.equal(passportGuidanceNote(["UNCERTAIN"]), CONDITIONAL_GUIDANCE_NOTE);
  assert.equal(childcarePassport({}).guidanceNote, undefined, "PASS");
  assert.equal(childcarePassport({ receivesPublicOrQuasiPublicChildcare: true }).guidanceNote, undefined, "FAIL");
  const notCovered = applyVerdictToGuide(getApplicationGuide("CENTRAL_RENT_115")!, { status: "NOT_COVERED", failedConditions: [] });
  assert.equal(guidanceModeFor("NOT_COVERED"), "REFERENCE_ONLY");
  assert.ok(notCovered.officialSources.length > 0, "reference content kept");
});

test("DP7 — PASS keeps the normal application guidance", () => {
  const passport = childcarePassport({});
  assert.equal(passport.actual.overallStatus, "PASS");
  assert.equal(passport.actual.programs[0].estimatedMonthlyBenefitNtd, 5000);
  const guide = passport.applicationGuides[0];
  assert.ok(guide.requiredDocuments.length >= 3);
  assert.ok(guide.applicationMethods.length >= 2);
  assert.ok(passport.nextSteps.some((step) => step.includes("https://twbaby.sfaa.gov.tw/") && !STEP_PREFIX.test(step)));
  assert.equal(passport.guidanceNote, undefined, "PASS shows no conditional notice");
  assert.ok(!passport.nextSteps.some((step) => /流程已停止/.test(step)));
  assert.ok(passport.risks.some((risk) => /申請制/.test(risk)), "procedure warning still shown when pursuable");
});

// Exact frozen C06 input (test data only; the frozen manifest and its expectation are untouched).
const C06 =
  "我在新北，第一胎18個月，具我國籍已設戶籍，未公費安置；就讀政府公設民營托嬰中心每週40小時，正在領公共托育補助。可以同時請領中央0到2歲育兒津貼嗎？";

test("DP8 — exact frozen C06: FAIL, R8 retained, no application recommendation, Passport consistent", () => {
  const run = startCaseRun(buildCaseDraft(C06));
  assert.equal(run.status, "COMPLETED");
  const passport = passportOf(run);
  assert.equal(passport.domain, "CHILDCARE");
  const program = passport.actual.programs[0];
  assert.equal(program.status, "FAIL");
  assert.ok(program.ruleResults.some((rule) => rule.ruleId === "CHILDCARE-115-CARE-001" && rule.status === "FAIL"), "non-duplication rule reached");
  assert.ok(program.evidence.some((item) => item.sourceId === "R8"));
  assert.equal(program.estimatedMonthlyBenefitNtd, null);
  assert.equal(passport.childcare?.estimatedMonthlyBenefitNtd, null);
  assert.deepEqual(passport.missingItems, []);
  for (const step of [...passport.nextSteps, ...program.applicationGuide!.nextSteps]) {
    assert.ok(!isSubmitCta(step), `C06 must not recommend applying: ${step}`);
  }
  assert.match(passport.nextSteps[0], /流程已停止.*不得同時領取/);
  assert.ok(passport.nextSteps.some((step) => step.startsWith(OFFICIAL_REFERENCE_LABEL)));
  assert.ok(!passport.risks.some((risk) => /主動.*提出申請/.test(risk)));
  assert.equal(passport.guidanceNote, undefined, "stopped, not conditional");
  assert.ok(passport.risks.includes(TRANSITION_NOTE), "transition note kept as information");
  assert.ok(!passport.nextSteps.includes(TRANSITION_NOTE), "transition note is not a next action");
});

test("DP8b — childcare FAIL transition note is informational only; PASS keeps its original warnings", () => {
  const failed = childcarePassport({ receivesPublicOrQuasiPublicChildcare: true });
  assert.ok(failed.risks.includes(TRANSITION_NOTE));
  assert.match(TRANSITION_NOTE, /此為資訊提醒，不代表目前建議申請/);
  assert.ok(!isSubmitCta(TRANSITION_NOTE), "the note itself is not a submission CTA");
  assert.deepEqual(failed.applicationGuides[0].warnings, [TRANSITION_NOTE]);
  const passed = childcarePassport({});
  assert.ok(!passed.risks.includes(TRANSITION_NOTE), "PASS copy unchanged");
  assert.ok(passed.risks.some((risk) => /停發或轉換/.test(risk)));
});

// Exact frozen H04 input (test data only).
const H04 =
  "我42歲，本國籍設籍台北，在中山區租屋每月14000，有租約。我在文山名下有一間完整產權、可正常住的住宅。沒有其他補助，單身月所得36000。想問中央租補。";

test("DP9 — housing own-home FAIL (exact H04) stays internally consistent", () => {
  const passport = passportOf(startCaseRun(buildCaseDraft(H04)));
  const programs = [...passport.actual.programs, ...passport.whatIf.programs];
  assert.ok(programs.length > 0);
  for (const program of programs) {
    assert.equal(program.status, "FAIL", program.policyId);
    assert.equal(program.estimatedMonthlyBenefitNtd, null, program.policyId);
    assert.ok(!(program.applicationGuide?.nextSteps ?? []).some(isSubmitCta), program.policyId);
  }
  assert.ok(!passport.nextSteps.some(isSubmitCta), passport.nextSteps.join("\n"));
  assert.ok(passport.nextSteps.some((step) => /名下持有住宅/.test(step)));
  assert.equal(passport.guidanceNote, undefined, "FAIL is stopped, not conditional");
});

test("DP10 — dual-city normal flow: verdicts, amounts and application path unchanged (one conditional notice)", () => {
  const preset = CASE_PRESETS.find((item) => item.id === "housing-dual-city")!;
  const run = answerAll(startCaseRun(buildCaseDraft(preset.goal)), false);
  assert.equal(run.status, "COMPLETED");
  const passport = passportOf(run);
  const statuses = Object.fromEntries(passport.actual.programs.map((program) => [program.policyId, program.status]));
  const whatIf = Object.fromEntries(passport.whatIf.programs.map((program) => [program.policyId, program.status]));
  assert.equal(statuses.CENTRAL_RENT_115, "PARTIAL_CHECK");
  assert.ok(Object.values({ ...statuses, ...whatIf }).every((status) => status !== "FAIL"));
  assert.ok(!passport.nextSteps.some((step) => /流程已停止/.test(step)));
  assert.ok(passport.nextSteps.some((step) => step.includes("has.nlma.gov.tw")), "central application path still shown");
  assert.ok(passport.applicationGuides.every((guide) => guide.requiredDocuments.length > 0));
  assert.ok(passport.nextSteps.includes("送件前再次查核受理機關最新官方公告版本"), "steps are the original concise wording");
});
