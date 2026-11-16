import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseDraft, CASE_PRESETS, DEFAULT_GOAL, startCaseRun, submitHumanGateAnswer } from "./case-input";
import { caseIdForRun, runAgenticGoldenCase } from "./agent/orchestrator";
import type { AgentRun } from "./agent/types";
import type { DecisionPassport } from "./passport";

function passportOf(run: AgentRun): DecisionPassport | undefined {
  const event = [...run.auditTrail]
    .reverse()
    .find((item) =>
      item.action === "AGENT_TOOL_COMPLETED" &&
      ["generate_decision_passport", "generate_childcare_passport"].includes(String((item.input as { toolName?: string })?.toolName))
    );
  return (event?.output as { result?: DecisionPassport } | undefined)?.result;
}

function startedCaseId(run: AgentRun): unknown {
  return (run.auditTrail.find((item) => item.action === "AGENT_RUN_STARTED")?.input as { caseId?: unknown })?.caseId;
}

function completeDemo(runId?: string): AgentRun {
  const draft = buildCaseDraft(DEFAULT_GOAL);
  const run = runAgenticGoldenCase(DEFAULT_GOAL, draft.applicant, draft.actualScenario, draft.whatIfScenario, undefined, {
    includePassport: true,
    ...(runId ? { runId } : {}),
  });
  const answered = submitHumanGateAnswer(run, false);
  assert.equal(answered.ok, true);
  return answered.run;
}

test("2C — case id is a deterministic function of the injected run id", () => {
  assert.equal(caseIdForRun("agent-1794834318480-3479a3"), "GA-1794834318480-3479A3");
  const a = completeDemo("agent-1000-aaaaaa");
  const b = completeDemo("agent-1000-aaaaaa");
  assert.equal(a.caseId, "GA-1000-AAAAAA");
  assert.equal(a.caseId, b.caseId, "same injected run id reproduces the same case id");
});

test("2C — passport, run and audit trail agree on the case id, across the Human Gate resume", () => {
  const run = completeDemo("agent-2000-bbbbbb");
  assert.equal(run.status, "COMPLETED");
  const passport = passportOf(run);
  assert.ok(passport);
  assert.equal(passport.caseId, run.caseId);
  assert.equal(startedCaseId(run), run.caseId);
  assert.notEqual(passport.caseId, "CASE-P0-001");
});

test("2C — every new analysis gets a new case id (housing and childcare)", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 5; i += 1) ids.add(completeDemo().caseId!);
  const childcare = CASE_PRESETS.find((preset) => preset.domain === "CHILDCARE")!;
  for (let i = 0; i < 3; i += 1) {
    let run = startCaseRun(buildCaseDraft(childcare.goal));
    while (run.status === "WAITING_FOR_HUMAN") run = submitHumanGateAnswer(run, false).run;
    const passport = passportOf(run);
    assert.equal(passport?.caseId, run.caseId);
    assert.notEqual(passport?.caseId, "CASE-CHILDCARE-001");
    ids.add(run.caseId!);
  }
  assert.equal(ids.size, 8, "8 analyses -> 8 distinct case ids");
});

test("2C — case id carries no personal data", () => {
  const draft = buildCaseDraft("我 35 歲，住台北市大安區，月租 20000，月薪 45000，沒有房子，單身");
  const run = startCaseRun(draft);
  // Only a timestamp + random suffix: derived from the run id alone, never from the profile.
  assert.match(run.caseId!, /^GA-[0-9]+-[0-9A-F]+$/);
  assert.equal(run.caseId, caseIdForRun(run.runId));
  assert.doesNotMatch(run.caseId!, /臺北|大安|台北/);
});
