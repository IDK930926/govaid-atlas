import assert from "node:assert/strict";
import test from "node:test";
import { buildVerdicts } from "./App";
import { buildCaseDraft, CASE_PRESETS, startCaseRun, submitHumanGateAnswer } from "./case-input";
import { hasDistinctWhatIf, runAgenticGoldenCase } from "./agent/orchestrator";
import type { AgentRun } from "./agent/types";
import type { DecisionPassport } from "./passport";
import { CHILDCARE_SCOPE_LABEL, passportHasWhatIf } from "./scenario-view";

function completedTool<T>(run: AgentRun, toolName: string): T | undefined {
  const event = [...run.auditTrail]
    .reverse()
    .find((item) => item.action === "AGENT_TOOL_COMPLETED" && (item.input as { toolName?: string })?.toolName === toolName);
  return (event?.output as { result?: T } | undefined)?.result;
}

function toolRan(run: AgentRun, toolName: string): boolean {
  return run.auditTrail.some(
    (item) => item.action === "AGENT_TOOL_COMPLETED" && (item.input as { toolName?: string })?.toolName === toolName
  );
}

function answerUntilDone(run: AgentRun, whatIfMirrorsActual: boolean): AgentRun {
  let current = run;
  for (let i = 0; i < 5 && current.status === "WAITING_FOR_HUMAN"; i += 1) {
    const answered = submitHumanGateAnswer(current, false, { whatIfMirrorsActual });
    assert.equal(answered.ok, true, `gate ${current.missingField} must accept a valid answer`);
    current = answered.run;
  }
  return current;
}

// ---------------------------------------------------------------- 2A
test("2A — childcare result never uses housing two-address scope copy", () => {
  const preset = CASE_PRESETS.find((item) => item.domain === "CHILDCARE")!;
  const draft = buildCaseDraft(preset.goal);
  const run = answerUntilDone(startCaseRun(draft), draft.whatIfMirrorsActual);
  assert.equal(run.status, "COMPLETED");

  const passport = completedTool<DecisionPassport>(run, "generate_childcare_passport");
  assert.ok(passport, "childcare passport must be produced");
  // The result view is told a what-if exists; childcare must still be single-scenario.
  const hasWhatIf = passportHasWhatIf(passport, true);
  assert.equal(hasWhatIf, false);

  const verdicts = buildVerdicts(passport, hasWhatIf);
  assert.equal(verdicts.length, 1, "one childcare program, shown once");
  for (const verdict of verdicts) {
    assert.equal(verdict.scope, CHILDCARE_SCOPE_LABEL);
    assert.doesNotMatch(verdict.scope, /地址|搬遷|方案 A|方案 B/);
  }
});

test("2A — housing dual-city still reports both-address scope when statuses agree", () => {
  const preset = CASE_PRESETS.find((item) => item.id === "housing-dual-city")!;
  const draft = buildCaseDraft(preset.goal);
  const run = answerUntilDone(startCaseRun(draft), draft.whatIfMirrorsActual);
  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport")!;
  const central = buildVerdicts(passport, passportHasWhatIf(passport, true))
    .filter((verdict) => verdict.policyId === "CENTRAL_RENT_115");
  assert.equal(central.length, 1);
  assert.equal(central[0].scope, "兩個地址皆適用");
});

// ---------------------------------------------------------------- 2B
test("2B — custom Taipei case without a what-if never evaluates or labels a relocation", () => {
  const draft = buildCaseDraft("我 35 歲，住台北市大安區，月租 20000，月薪 45000，沒有房子，單身");
  assert.equal(draft.whatIfMirrorsActual, true);
  const run = answerUntilDone(startCaseRun(draft), draft.whatIfMirrorsActual);
  assert.equal(run.status, "COMPLETED");

  assert.equal(toolRan(run, "evaluate_what_if_scenario"), false, "no second local-policy evaluation");
  assert.ok(run.auditTrail.some((item) => item.action === "WHAT_IF_NOT_DISTINCT"), "the skip is auditable");

  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport")!;
  // The result view hides the mirror, so no 搬遷假設 label can be produced.
  const verdicts = buildVerdicts(passport, passportHasWhatIf(passport, false));
  for (const verdict of verdicts) {
    assert.doesNotMatch(verdict.scope, /搬遷假設|兩個地址皆適用/);
  }
});

test("2B — an explicit what-if identical to the actual address is not a comparison", () => {
  const actual = { type: "ACTUAL" as const, address: "臺北市大安區合成測試地址", city: "臺北市", district: "大安區", monthlyRent: 20000 };
  const sameAsActual = { ...actual, type: "WHAT_IF" as const };
  assert.equal(hasDistinctWhatIf(actual, sameAsActual), false);
  assert.equal(hasDistinctWhatIf(actual, { ...sameAsActual, monthlyRent: 15000 }), true, "a cheaper flat in the same district is a real what-if");
  assert.equal(hasDistinctWhatIf(actual, { ...sameAsActual, city: "新北市", district: "永和區" }), true);

  const run = runAgenticGoldenCase(
    "我住臺北市大安區，月租 20000",
    { age: 35, registeredCity: "臺北市", ownsHome: false, receivesOtherHousingAid: false, monthlyIncome: 45000 },
    actual,
    sameAsActual,
    undefined,
    { includePassport: true }
  );
  assert.equal(run.status, "COMPLETED");
  assert.equal(toolRan(run, "evaluate_what_if_scenario"), false);
});

test("2B — planner cannot force a what-if evaluation when none is distinct", () => {
  const draft = buildCaseDraft("我 35 歲，住台北市大安區，月租 20000，月薪 45000，沒有房子，單身，沒有領其他住宅補貼");
  const run = runAgenticGoldenCase(draft.goal, draft.applicant, draft.actualScenario, draft.whatIfScenario, undefined, {
    includePassport: true,
    whatIfMirrorsActual: true,
    plannerProposals: [
      { reasoningSummary: "Compare relocation.", nextAction: "CALL_TOOL", toolName: "evaluate_what_if_scenario" },
    ],
  });
  const rejection = run.auditTrail.find((item) => item.action === "AGENT_PROPOSAL_REJECTED");
  assert.ok(rejection);
  assert.match(JSON.stringify(rejection), /NO_DISTINCT_WHAT_IF_SCENARIO/);
  assert.equal(toolRan(run, "evaluate_what_if_scenario"), false);
});

test("2B — the explicit dual-city preset keeps its real comparison", () => {
  const preset = CASE_PRESETS.find((item) => item.id === "housing-dual-city")!;
  const draft = buildCaseDraft(preset.goal);
  assert.equal(draft.whatIfMirrorsActual, false);
  const run = answerUntilDone(startCaseRun(draft), draft.whatIfMirrorsActual);
  assert.equal(toolRan(run, "evaluate_what_if_scenario"), true);
  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport")!;
  assert.equal(passport.whatIf.city, "臺北市");
  assert.ok(passport.whatIf.programs.some((program) => program.policyId === "TAIPEI_RENT_115"));
});
