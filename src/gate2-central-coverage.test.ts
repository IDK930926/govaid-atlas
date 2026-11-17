import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseDraft, startCaseRun, submitHumanGateAnswer } from "./case-input";
import { assessQueryCoverage } from "./coverage";
import type { AgentRun } from "./agent/types";
import type { DecisionPassport } from "./passport";

// Gate 2F — a renter in a city without encoded local rules still gets the national
// 300億元中央擴大租金補貼 (R1) pre-check; the local layer is explicitly NOT_COVERED.

function answer(run: AgentRun): string | number | boolean {
  if (run.missingField === "age") return 28;
  if (run.missingField === "monthlyIncome") return 40000;
  return false;
}

function complete(goal: string): AgentRun {
  const draft = buildCaseDraft(goal);
  let run = startCaseRun(draft);
  for (let i = 0; i < 6 && run.status === "WAITING_FOR_HUMAN"; i += 1) {
    const next = submitHumanGateAnswer(run, answer(run), { whatIfMirrorsActual: draft.whatIfMirrorsActual });
    assert.equal(next.ok, true, `gate ${run.missingField} must accept a valid answer`);
    run = next.run;
  }
  return run;
}

function passportOf(run: AgentRun): DecisionPassport {
  const event = [...run.auditTrail]
    .reverse()
    .find((item) => item.action === "AGENT_TOOL_COMPLETED" && (item.input as { toolName?: string })?.toolName === "generate_decision_passport");
  return (event?.output as { result: DecisionPassport }).result;
}

test("2F — Kaohsiung renter: central evaluated (never PASS), local scheme NOT_COVERED", () => {
  const run = complete("我住高雄市三民區，月租 9000 元，有租屋補助嗎？");
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.coverage?.reason, "CENTRAL_ONLY_LOCAL_NOT_COVERED");

  const passport = passportOf(run);
  const byId = new Map(passport.actual.programs.map((program) => [program.policyId, program]));
  assert.equal(byId.get("CENTRAL_RENT_115")?.status, "PARTIAL_CHECK", "central is a partial pre-check, not PASS");
  assert.equal(byId.get("LOCAL_COVERAGE_BOUNDARY")?.status, "NOT_COVERED");
  assert.match(byId.get("LOCAL_COVERAGE_BOUNDARY")?.coverageNote ?? "", /高雄市地方租屋補助或加碼/);
  // No fabricated Kaohsiung programme and no local estimate or guide.
  assert.deepEqual([...byId.keys()].sort(), ["CENTRAL_RENT_115", "LOCAL_COVERAGE_BOUNDARY"]);
  assert.deepEqual(passport.applicationGuides.map((guide) => guide.policyId), ["CENTRAL_RENT_115"]);
});

test("2F — owning a home in an uncovered city still fails the national scheme", () => {
  const draft = buildCaseDraft("我住高雄市三民區，月租 9000 元，有租屋補助嗎？");
  let run = startCaseRun(draft);
  for (let i = 0; i < 6 && run.status === "WAITING_FOR_HUMAN"; i += 1) {
    const value = run.missingField === "ownsHome" ? true : answer(run);
    run = submitHumanGateAnswer(run, value, { whatIfMirrorsActual: draft.whatIfMirrorsActual }).run;
  }
  const central = passportOf(run).actual.programs.find((program) => program.policyId === "CENTRAL_RENT_115");
  assert.equal(central?.status, "FAIL");
});

test("2F — local-only, non-housing and covered-city queries keep their existing coverage", () => {
  assert.equal(assessQueryCoverage("我想申請高雄市地方租屋補助").status, "NOT_COVERED");
  assert.equal(assessQueryCoverage("花蓮縣老人假牙補助").status, "NOT_COVERED");
  assert.equal(assessQueryCoverage("我住新北市永和區，想申請租屋補助").reason, "RENTAL_SUBSIDY_IN_SCOPE");
});
