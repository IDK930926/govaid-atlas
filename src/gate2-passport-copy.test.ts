import assert from "node:assert/strict";
import test from "node:test";
import { buildVerdicts } from "./App";
import { buildCaseDraft, CASE_PRESETS, DEFAULT_GOAL, startCaseRun, submitHumanGateAnswer } from "./case-input";
import type { AgentRun } from "./agent/types";
import type { DecisionPassport } from "./passport";
import { passportHasWhatIf } from "./scenario-view";
import { getMissingUserFieldLabels, humanizeRuleReason } from "./ui-copy";

function passportOf(run: AgentRun): DecisionPassport {
  const event = [...run.auditTrail]
    .reverse()
    .find((item) => item.action === "AGENT_TOOL_COMPLETED" && /passport/.test(String((item.input as { toolName?: string })?.toolName)));
  return (event?.output as { result: DecisionPassport }).result;
}

function complete(goal: string, answer: boolean): DecisionPassport {
  const draft = buildCaseDraft(goal);
  let run = startCaseRun(draft);
  for (let i = 0; i < 5 && run.status === "WAITING_FOR_HUMAN"; i += 1) {
    const next = submitHumanGateAnswer(run, answer, { whatIfMirrorsActual: draft.whatIfMirrorsActual });
    if (!next.ok) break;
    run = next.run;
  }
  return passportOf(run);
}

// ---------------------------------------------------------------- 2D
test("2D — owned-home location question leads the New Taipei pending items", () => {
  const passport = complete(DEFAULT_GOAL, true);
  const newTaipei = buildVerdicts(passport, passportHasWhatIf(passport, true))
    .filter((verdict) => verdict.policyId === "NEW_TAIPEI_RENT_115");
  assert.equal(newTaipei.length, 1);
  assert.equal(newTaipei[0].status, "UNCERTAIN", "never FAIL without location evidence");
  assert.match(newTaipei[0].missingFields[0], /自有住宅.*新北.*臺北.*桃園.*基隆/);
  assert.match(newTaipei[0].gap ?? "", /自有住宅/);
  // The other gap is still listed, after it.
  assert.ok(newTaipei[0].missingFields.some((label) => label.includes("新北市設籍")));
});

test("2D — without an owned home the ownership question does not appear", () => {
  const passport = complete(DEFAULT_GOAL, false);
  const labels = passport.actual.programs.flatMap((program) => getMissingUserFieldLabels(program.ruleResults));
  assert.ok(!labels.some((label) => label.includes("自有住宅")));
});

// ---------------------------------------------------------------- 2E
const RAW_IDENTIFIER = /\b[a-z]+[A-Z][A-Za-z]*\b|不符合規則|通過規則|缺少必要資料/;

function publicTexts(passport: DecisionPassport): string[] {
  const texts = [...passport.nextSteps, ...passport.risks, ...passport.missingItems];
  for (const scenario of [passport.actual, passport.whatIf]) {
    for (const program of scenario.programs) {
      texts.push(
        ...program.passedConditions,
        ...program.failedConditions,
        ...program.missingConditions,
        ...(program.applicationGuide?.nextSteps ?? []),
        program.coverageNote ?? ""
      );
    }
  }
  // Official URLs may legitimately contain camelCase path segments.
  return texts.map((text) => text.replace(/https?:\/\/\S+/g, ""));
}

test("2E — public Decision Passport text exposes no internal field identifiers", () => {
  const goals = [
    ...CASE_PRESETS.map((preset) => preset.goal),
    "我 35 歲，住台北市大安區，月租 20000，月薪 45000，沒有房子，單身",
  ];
  let checked = 0;
  for (const goal of goals) {
    for (const answer of [false, true]) {
      const passport = complete(goal, answer);
      if (!passport) continue;
      for (const text of publicTexts(passport)) {
        assert.doesNotMatch(text, RAW_IDENTIFIER, `raw identifier in passport text: ${text}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 50, "the scan must cover real passport content");
});

test("2E — humanized wording keeps raw reasons available for the audit trail", () => {
  const fail = { ruleId: "CENTRAL-115-HOME-001", status: "FAIL" as const, reason: "ownsHome 不符合規則", sourceId: "R1" };
  assert.equal(humanizeRuleReason(fail), "名下持有住宅");
  assert.equal(fail.reason, "ownsHome 不符合規則", "the source evaluation is not mutated");
  assert.equal(
    humanizeRuleReason({ ruleId: "TAIPEI-115-REGISTERED-001", status: "UNCERTAIN", reason: "缺少必要資料：registeredCity", sourceId: "R6" }),
    "尚未提供：戶籍城市"
  );
});
