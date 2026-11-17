import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseDraft, startCaseRun, submitHumanGateAnswer, type CaseDraft } from "./case-input";
import { describeAgentDecision } from "./agent-decision-view";
import {
  getFieldState,
  inferFieldsFromQuestion,
  isFieldMissing,
  MISSING_FIELD_QUESTIONS,
  normalizeFieldName,
  resolveRequestedFields,
} from "./agent/missing-fields";
import type { AgentDecision, AgentRun, SupportedMissingField } from "./agent/types";
import type { ProviderPlannerResult } from "./agent/providers/types";

// Gate 4C — known-field / Human-Gate consistency.
//
// Every planner response here is a SIMULATED_PLANNER_RESPONSE shaped like the production cloud
// schema (src/agent/providers/openai.ts: reasoningSummary, nextAction, toolName, humanQuestion —
// no missingField). No real cloud planner is called by these tests.

function simulated(decision: Record<string, unknown>): ProviderPlannerResult {
  return {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model: "SIMULATED_PLANNER_RESPONSE",
    callAttempted: true,
    decision: { reasoningSummary: "simulated", ...decision } as unknown as AgentDecision,
  };
}

const ASK = (humanQuestion: string, extra: Record<string, unknown> = {}) =>
  simulated({ nextAction: "ASK_HUMAN", humanQuestion, ...extra });

/** A waiting gate must target a field the run's normalized state does not know. */
function assertNoKnownFieldGate(run: AgentRun, draft: CaseDraft, label: string) {
  if (run.status !== "WAITING_FOR_HUMAN") return;
  const field = run.missingField as SupportedMissingField;
  const applicant = run.state?.applicant ?? draft.applicant;
  const scenario = run.state?.actualScenario ?? draft.actualScenario;
  assert.ok(isFieldMissing(field, applicant, scenario), `${label}: gate re-asks known field ${field}`);
}

const HOUSING_ALL_KNOWN_OWNS_TRUE =
  "我35歲，在臺北市大安區租屋，月租16000，名下有一間住宅，沒有領其他住宅補貼，想查中央租金補貼。";
const HOUSING_OWNS_FALSE_AID_UNKNOWN = "我30歲，在高雄市三民區租屋，月租9000，名下沒有房子，想查中央租金補貼。";
const HOUSING_ALL_KNOWN_OWNS_FALSE =
  "我29歲，在臺中市西屯區租屋，月租12000，名下沒有房子，也沒有領其他住宅補貼，想查中央租金補貼。";
const CHILDCARE_REGISTERED =
  "寶寶10個月大，已完成出生登記，是第一胎，沒有送托公共或準公共托育，也沒有公費安置，想申請育兒津貼。";
const HOUSING_CONFLICT =
  "我30歲，在臺北市大安區租屋月租15000，名下有一間房子，可是我沒有自有住宅，沒有領其他住宅補貼，想查中央租金補貼。";

test("KG1 — known ownsHome=true cannot be re-asked", () => {
  const draft = buildCaseDraft(HOUSING_ALL_KNOWN_OWNS_TRUE);
  assert.equal(draft.applicant.ownsHome, true);
  const run = startCaseRun(draft, ASK("本人是否持有住宅？"));
  assert.equal(run.trace[0]?.proposalRejected, true);
  assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: ownsHome/);
  assert.notEqual(run.missingField, "ownsHome");
  assertNoKnownFieldGate(run, draft, "KG1");
  assert.equal(run.state?.applicant.ownsHome, true, "the known value is preserved, not overwritten");
});

test("KG2 — known ownsHome=false cannot be re-asked (false is a known value)", () => {
  const draft = buildCaseDraft(HOUSING_OWNS_FALSE_AID_UNKNOWN);
  assert.equal(draft.applicant.ownsHome, false);
  assert.equal(getFieldState("ownsHome", draft.applicant, draft.actualScenario), "KNOWN");
  for (const question of ["本人是否持有住宅？", "請問您名下有沒有房子？", "您是否擁有自有住宅"]) {
    const run = startCaseRun(draft, ASK(question));
    assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: ownsHome/, question);
    assert.equal(run.missingField, "receivesOtherHousingAid", "the next genuinely unknown field is asked");
    assertNoKnownFieldGate(run, draft, `KG2 ${question}`);
  }
});

test("KG3 — known city cannot be re-asked (question text or alias)", () => {
  const draft = buildCaseDraft(HOUSING_ALL_KNOWN_OWNS_TRUE);
  assert.equal(draft.actualScenario.city, "臺北市");
  for (const planner of [
    ASK("請問您的租屋所在地位於哪個縣市？"),
    ASK("請確認地點", { toolArguments: { field: "rentalCity" } }),
    ASK("請確認", { missingField: "city" }),
  ]) {
    const run = startCaseRun(draft, planner);
    assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: city/);
    assert.notEqual(run.missingField, "city");
    assert.equal(run.state?.actualScenario.city, "臺北市");
  }
});

test("KG4 — known receivesOtherHousingAid=false cannot be re-asked", () => {
  const draft = buildCaseDraft(HOUSING_ALL_KNOWN_OWNS_FALSE);
  assert.equal(draft.applicant.receivesOtherHousingAid, false);
  const run = startCaseRun(draft, ASK("請問您目前是否領有其他政府住宅補貼？"));
  assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: receivesOtherHousingAid/);
  assert.notEqual(run.status, "WAITING_FOR_HUMAN", "nothing is unknown → no gate at all");
  assert.equal(run.state?.applicant.receivesOtherHousingAid, false);
});

test("KG5 — known childcare registration / provider / placement facts cannot be re-asked", () => {
  const draft = buildCaseDraft(CHILDCARE_REGISTERED);
  assert.equal(draft.domain, "CHILDCARE");
  assert.equal(draft.applicant.childHasBirthOrInitialHouseholdRegistration, true);
  const cases: Array<[string, SupportedMissingField]> = [
    ["請問兒童是否已完成出生登記或初設戶籍登記？", "childHasBirthOrInitialHouseholdRegistration"],
    ["請問兒童目前是否正在送托公共化或準公共托育服務？", "receivesPublicOrQuasiPublicChildcare"],
    ["請問兒童目前是否經政府公費安置收容？", "isGovernmentPlaced"],
  ];
  for (const [question, field] of cases) {
    const run = startCaseRun(draft, ASK(question));
    assert.match(run.trace[0]?.rejectionReason ?? "", new RegExp(`^FIELD_ALREADY_KNOWN: ${field}`), question);
    assertNoKnownFieldGate(run, draft, `KG5 ${field}`);
    assert.equal(run.state?.overallEligibilityStatus, "PASS", "deterministic rules continue to the real result");
  }
});

test("KG6 — a CONFLICT field may be asked, with explicit contradiction wording", () => {
  const draft = buildCaseDraft(HOUSING_CONFLICT);
  assert.equal(draft.normalizedFacts?.ownsHome?.state, "CONFLICT");
  assert.equal(draft.applicant.ownsHome, null, "conflicting values are never silently overwritten");
  assert.equal(getFieldState("ownsHome", draft.applicant, draft.actualScenario, draft.fieldQuestions), "CONFLICT");
  const run = startCaseRun(draft, ASK("本人是否持有住宅？"));
  assert.equal(run.trace[0]?.proposalRejected, false, "asking a CONFLICT field is legitimate");
  assert.equal(run.missingField, "ownsHome");
  assert.match(run.humanInputRequired ?? "", /同時提到/, "the gate says why it asks");
});

test("KG7 — planner asks a known field → rejected, deterministic selector continues, no dead end", () => {
  // (a) another required field is unknown → the selector asks that one.
  const partial = buildCaseDraft(HOUSING_OWNS_FALSE_AID_UNKNOWN);
  const asked = startCaseRun(partial, ASK("本人是否持有住宅？"));
  assert.equal(asked.status, "WAITING_FOR_HUMAN");
  assert.equal(asked.missingField, "receivesOtherHousingAid");
  const view = describeAgentDecision(asked)!;
  assert.equal(view.kind, "MODEL_REJECTED");
  assert.equal(view.proposal, "詢問本人是否持有住宅");
  assert.equal(view.validation, "駁回：該資料已由使用者提供，不得重問");
  assert.equal(view.next, "請你確認：請問您目前是否領有其他政府住宅補貼？");
  // Answering the real gate completes the run.
  const resumed = submitHumanGateAnswer(asked, false, { whatIfMirrorsActual: partial.whatIfMirrorsActual });
  assert.equal(resumed.ok, true);
  assert.notEqual(resumed.run.status, "WAITING_FOR_HUMAN");

  // (b) nothing is unknown → the run reaches a deterministic result instead of waiting.
  const full = buildCaseDraft(HOUSING_ALL_KNOWN_OWNS_FALSE);
  const done = startCaseRun(full, ASK("本人是否持有住宅？"));
  assert.notEqual(done.status, "WAITING_FOR_HUMAN");
  assert.ok(done.state?.completedTools.includes("evaluate_central_rules"), "central rules still ran");
  assert.ok(!describeAgentDecision(done)!.next.startsWith("請你確認"));
});

test("KG8 — field aliases and tool-call shapes cannot bypass the known-field check", () => {
  assert.equal(normalizeFieldName("applicantOwnsHome"), "ownsHome");
  assert.equal(normalizeFieldName("hasOwnedHome"), "ownsHome");
  assert.equal(normalizeFieldName("owns_home"), "ownsHome");
  assert.equal(normalizeFieldName("OtherHousingAid"), "receivesOtherHousingAid");
  assert.equal(normalizeFieldName("rental-city"), "city");
  assert.equal(normalizeFieldName("somethingElse"), undefined);
  assert.deepEqual(resolveRequestedFields({ humanQuestion: "本人是否持有住宅？" }).fields, ["ownsHome"]);
  assert.deepEqual(inferFieldsFromQuestion("請問您目前是否領有其他政府住宅補貼？"), ["receivesOtherHousingAid"]);
  // Every system-owned canonical question resolves to exactly its own field.
  for (const [field, question] of Object.entries(MISSING_FIELD_QUESTIONS)) {
    assert.deepEqual(inferFieldsFromQuestion(question), [field], question);
  }

  const draft = buildCaseDraft(HOUSING_ALL_KNOWN_OWNS_TRUE);
  const shapes: ProviderPlannerResult[] = [
    ASK("請確認資料", { toolArguments: { field: "applicantOwnsHome" } }),
    ASK("請確認資料", { toolArguments: { field: "hasOwnedHome" } }),
    ASK("請確認資料", { missingField: "owns_home" }),
    simulated({ nextAction: "CALL_TOOL", toolName: "request_missing_field", toolArguments: { field: "ownsHome" } }),
    simulated({ nextAction: "CALL_TOOL", toolName: "request_human_confirmation", humanQuestion: "請確認您名下是否有自有住宅" }),
  ];
  for (const planner of shapes) {
    const run = startCaseRun(draft, planner);
    assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: ownsHome/, JSON.stringify(planner.decision));
    assertNoKnownFieldGate(run, draft, "KG8");
  }
});

test("KG9 — normalized facts and currentStateSummary.knownFields agree", () => {
  const GATE_FIELDS = new Set<string>([
    "city", "ownsHome", "receivesOtherHousingAid", "age", "monthlyIncome", "registeredCity",
    "childAgeMonths", "birthOrder", "childHasBirthOrInitialHouseholdRegistration",
    "receivesPublicOrQuasiPublicChildcare", "isGovernmentPlaced",
  ]);
  for (const goal of [HOUSING_ALL_KNOWN_OWNS_TRUE, HOUSING_OWNS_FALSE_AID_UNKNOWN, HOUSING_ALL_KNOWN_OWNS_FALSE, CHILDCARE_REGISTERED, HOUSING_CONFLICT]) {
    const draft = buildCaseDraft(goal);
    const run = startCaseRun(draft, ASK("本人是否持有住宅？"));
    const summary = run.trace[0]?.currentStateSummary;
    assert.ok(summary, goal);
    for (const [field, fact] of Object.entries(draft.normalizedFacts ?? {})) {
      if (!GATE_FIELDS.has(field) || !summary!.knownFields.concat(summary!.missingFields).includes(field)) continue;
      if (/^KNOWN_/.test(fact.state)) {
        assert.ok(summary!.knownFields.includes(field), `${goal}: ${field} is ${fact.state} but not in knownFields`);
      } else {
        assert.ok(summary!.missingFields.includes(field), `${goal}: ${field} is ${fact.state} but listed as known`);
      }
    }
  }
});

// Exact frozen H04 input (test data only; the frozen manifest and its expectation are untouched).
const H04 =
  "我42歲，本國籍設籍台北，在中山區租屋每月14000，有租約。我在文山名下有一間完整產權、可正常住的住宅。沒有其他補助，單身月所得36000。想問中央租補。";

test("KG10 — exact frozen H04 produces no known-field re-ask on any planner shape", () => {
  const draft = buildCaseDraft(H04);
  assert.equal(draft.actualScenario.city, "臺北市");
  assert.equal(draft.actualScenario.district, "中山區");
  assert.equal(draft.applicant.ownsHome, true);
  assert.equal(draft.applicant.receivesOtherHousingAid, false);

  const shapes: Array<[string, ProviderPlannerResult | undefined]> = [
    ["deterministic", undefined],
    ["ASK free text ownsHome", ASK("本人是否持有住宅？")],
    ["ASK free text city", ASK("請問您的租屋所在地位於哪個縣市？")],
    ["ASK free text other aid", ASK("請問您目前是否領有其他政府住宅補貼？")],
    ["ASK unrelated free text", ASK("請提供您的家庭組成、收入與存款金額")],
    ["HUMAN_REVIEW_REQUIRED", simulated({ nextAction: "HUMAN_REVIEW_REQUIRED" })],
    ["COMPLETE", simulated({ nextAction: "COMPLETE" })],
    ["CALL_TOOL central", simulated({ nextAction: "CALL_TOOL", toolName: "evaluate_central_rules" })],
  ];
  for (const [label, planner] of shapes) {
    const run = startCaseRun(draft, planner);
    assert.notEqual(run.status, "WAITING_FOR_HUMAN", `${label}: no gate — every required field is known`);
    assert.ok(run.state?.completedTools.includes("evaluate_central_rules"), `${label}: policy engine ran`);
    assert.equal(run.state?.applicant.ownsHome, true, `${label}: engine used ownsHome=true`);
    assert.equal(run.state?.centralStatus, "FAIL", `${label}: owns a home → central FAIL`);
    assert.notEqual(run.state?.overallEligibilityStatus, "PASS", `${label}: never an unsupported PASS`);
    if (planner?.decision?.nextAction === "ASK_HUMAN") {
      assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN|^NO_ASKABLE_FIELD/, label);
    }
  }
});

test("KG-GEN — across varied inputs × simulated planner shapes, no gate ever targets a known field", () => {
  const goals = [
    HOUSING_ALL_KNOWN_OWNS_TRUE,
    HOUSING_OWNS_FALSE_AID_UNKNOWN,
    HOUSING_ALL_KNOWN_OWNS_FALSE,
    CHILDCARE_REGISTERED,
    HOUSING_CONFLICT,
    "我在新北市板橋區租屋，月租13000，想查中央租金補貼。",
    "想查租金補貼。",
    "寶寶8個月，想問育兒津貼。",
    "我26歲住桃園中壢租屋月租8500，名下無房，沒有其他補助，想問中央租補和桃園有沒有加碼。",
  ];
  const shapes = [
    undefined,
    ASK("本人是否持有住宅？"),
    ASK("請問您目前是否領有其他政府住宅補貼？"),
    ASK("請問您的租屋所在地位於哪個縣市？"),
    ASK("請確認資料", { toolArguments: { field: "applicantOwnsHome" } }),
    ASK("請問兒童是否已完成出生登記或初設戶籍登記？"),
    simulated({ nextAction: "CALL_TOOL", toolName: "request_missing_field", toolArguments: { field: "ownsHome" } }),
  ];
  for (const goal of goals) {
    const draft = buildCaseDraft(goal);
    for (const planner of shapes) {
      let run = startCaseRun(draft, planner);
      for (let step = 0; step < 6 && run.status === "WAITING_FOR_HUMAN"; step += 1) {
        assertNoKnownFieldGate(run, draft, `${goal} / ${JSON.stringify(planner?.decision ?? "deterministic")} / step ${step}`);
        const field = run.missingField;
        const answer = field === "age" ? 30 : field === "monthlyIncome" ? 20000 : field === "childAgeMonths" ? 8 : field === "birthOrder" ? 1 : field === "city" ? "臺北市" : false;
        const submitted = submitHumanGateAnswer(run, answer, { whatIfMirrorsActual: draft.whatIfMirrorsActual });
        if (!submitted.ok) break;
        run = submitted.run;
      }
    }
  }
});
