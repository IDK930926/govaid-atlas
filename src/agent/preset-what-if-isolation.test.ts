// Regression: the Taoyuan navigation preset must not inherit the dual-city Taipei what-if.
import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseDraft, CASE_PRESETS, EMPTY_CASE_EDITS, submitHumanGateAnswer, type CaseDraft } from "../case-input";
import { runAgenticGoldenCase } from "./orchestrator";
import { displayedPassportPrograms, displayedPassportRisks, displayedPassportScenarios } from "../scenario-view";
import type { DecisionPassport } from "../passport";
import type { ScenarioResult } from "../scenario";

const DUAL_CITY = CASE_PRESETS.find((preset) => preset.id === "housing-dual-city")!;
const TAOYUAN = CASE_PRESETS.find((preset) => preset.id === "housing-taoyuan")!;

// Mirrors App.handleSelectPreset: goal := preset goal, edits for that domain cleared.
function selectPreset(goal: string): CaseDraft {
  return buildCaseDraft(goal, { ...EMPTY_CASE_EDITS, HOUSING: {} });
}

function hasWhatIf(draft: CaseDraft): boolean {
  return draft.domain === "HOUSING" && !draft.whatIfMirrorsActual;
}

function completedTool<T>(run: ReturnType<typeof runAgenticGoldenCase>, toolName: string): T | undefined {
  const event = [...run.auditTrail].reverse().find(
    (entry) => entry.action === "AGENT_TOOL_COMPLETED" && (entry.output as { toolName?: string } | undefined)?.toolName === toolName
  );
  return (event?.output as { result: T } | undefined)?.result;
}

function runToCompletion(draft: CaseDraft) {
  let run = runAgenticGoldenCase(draft.goal, draft.applicant, draft.actualScenario, draft.whatIfScenario, undefined, {
    includePassport: true,
    domain: draft.domain,
    ...(draft.requiredFields ? { requiredFields: [...draft.requiredFields] } : {}),
  });
  for (let guard = 0; run.status === "WAITING_FOR_HUMAN" && guard < 5; guard += 1) {
    const answer = run.missingField === "monthlyIncome" ? 38000 : false;
    const submission = submitHumanGateAnswer(run, answer, { whatIfMirrorsActual: draft.whatIfMirrorsActual });
    assert.equal(submission.ok, true, `gate answer for ${run.missingField} must be accepted`);
    run = submission.run;
  }
  assert.equal(run.status, "COMPLETED");
  return run;
}

test("T1 — Dual-city preset keeps the New Taipei → Taipei what-if", () => {
  const draft = selectPreset(DUAL_CITY.goal);
  assert.equal(hasWhatIf(draft), true);
  assert.equal(draft.actualScenario.city, "新北市");
  assert.equal(draft.whatIfScenario.city, "臺北市");
  assert.equal(draft.whatIfScenario.district, "文山區");
  assert.equal(draft.whatIfScenario.monthlyRent, 15500);
});

test("T2 — Taoyuan navigation preset defines no what-if and no Taipei scenario", () => {
  assert.equal(TAOYUAN.whatIfScenario, undefined);
  const draft = selectPreset(TAOYUAN.goal);
  assert.equal(hasWhatIf(draft), false);
  assert.equal(draft.actualScenario.city, "桃園市");
  assert.equal(draft.actualScenario.district, "桃園區");
  assert.equal(draft.actualScenario.monthlyRent, 12000);
  // The engine-side mirror is the actual Taoyuan address, never Taipei.
  assert.notEqual(draft.whatIfScenario.city, "臺北市");
  assert.equal(draft.whatIfScenario.city, "桃園市");
  assert.notEqual(draft.whatIfScenario.monthlyRent, 15500);
});

test("T3 — Switching dual-city → Taoyuan removes the previous Taipei what-if", () => {
  const before = selectPreset(DUAL_CITY.goal);
  assert.equal(before.whatIfScenario.city, "臺北市");
  const after = selectPreset(TAOYUAN.goal);
  assert.equal(hasWhatIf(after), false);
  assert.equal(after.whatIfScenario.city, "桃園市");
  assert.equal(after.whatIfScenario.district, "桃園區");
  assert.equal(after.whatIfScenario.monthlyRent, 12000);
  assert.ok(!JSON.stringify(after.whatIfScenario).includes("文山"));
});

test("T4 — Switching Taoyuan → dual-city restores the Taipei what-if only from that preset", () => {
  selectPreset(TAOYUAN.goal);
  const draft = selectPreset(DUAL_CITY.goal);
  assert.equal(hasWhatIf(draft), true);
  assert.deepEqual(draft.whatIfScenario, DUAL_CITY.whatIfScenario);
});

test("T5 — Taoyuan result contains no Taipei what-if artifacts (臺北文山 / R6 / 臺北方案 / 15500)", () => {
  const draft = selectPreset(TAOYUAN.goal);
  const run = runToCompletion(draft);

  const whatIfEval = completedTool<ScenarioResult>(run, "evaluate_what_if_scenario");
  if (whatIfEval) {
    assert.notEqual(whatIfEval.scenario.city, "臺北市");
    assert.ok(!whatIfEval.policyResults.some((policy) => policy.policyId === "TAIPEI_RENT_115"));
  }

  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport");
  assert.ok(passport, "Taoyuan run must produce a Decision Passport");
  // Engine output itself must not contain Taipei data.
  const engineText = JSON.stringify(passport);
  for (const forbidden of ["臺北文山", "文山", "15500", "TAIPEI_RENT_115"]) {
    assert.ok(!engineText.includes(forbidden), `passport must not contain ${forbidden}`);
  }

  // What the result view renders for a case without a what-if.
  const scenarios = displayedPassportScenarios(passport, hasWhatIf(draft));
  assert.deepEqual(scenarios.map((scenario) => scenario.kind), ["ACTUAL"]);
  const programs = displayedPassportPrograms(passport, hasWhatIf(draft));
  const risks = displayedPassportRisks(passport, hasWhatIf(draft));
  assert.ok(!risks.some((risk) => risk.includes("WHAT-IF")));
  const renderedText = JSON.stringify({ scenarios, programs, risks, steps: passport.nextSteps });
  for (const forbidden of ["臺北文山", "R6", "臺北方案", "15500", "搬遷"]) {
    assert.ok(!renderedText.includes(forbidden), `Taoyuan result must not contain ${forbidden}`);
  }
  // Taoyuan scope is still present (central check and/or Taoyuan navigation / coverage boundary).
  assert.ok(programs.length > 0);
  assert.ok(programs.every((program) => program.policyId !== "TAIPEI_RENT_115"));
});
