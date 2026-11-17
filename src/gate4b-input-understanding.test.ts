import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScopeComponentsNotice } from "./App";
import { describeAgentDecision } from "./agent-decision-view";
import { isFieldMissing } from "./agent/missing-fields";
import { runAgenticGoldenCase } from "./agent/orchestrator";
import type { AgentRun } from "./agent/types";
import { buildCaseDraft, startCaseRun, submitHumanGateAnswer } from "./case-input";
import { assessQueryCoverage, detectBenefitDomain } from "./coverage";
import { extractChildcareFactsTyped, extractHousingFactsTyped, parseAmountAt, splitClauses } from "./fact-extraction";
import { analyzeRequestIntent } from "./intent";

// Gate 4B — input understanding & routing recovery.
// Regression inputs for the 10 P1 cases are the exact frozen inputs (read-only test data);
// the generalized tests use different wording so the fix is not tied to those sentences.

const P1 = {
  H04: "我42歲，本國籍設籍台北，在中山區租屋每月14000，有租約。我在文山名下有一間完整產權、可正常住的住宅。沒有其他補助，單身月所得36000。想問中央租補。",
  H12: "臺北內湖月租18000，單身45歲無子女，本國籍有戶籍，有本人租約，沒房、沒任何其他住宅補助。依財稅所得平均每人每月85000。115年中央租補。",
  U01: "26歲本國籍有戶籍、在高雄三民租11000有租約，單身沒房沒其他住宅協助、人均所得32000。想區分115中央租金補貼和高雄市自辦地方租補。",
  U05: "我爸爸72歲在台北，出院後需要到宅照顧，想申請長照居家服務，租補和育兒都跟我無關。",
  U06: "在台南東區租屋12000，本國籍有戶籍，29歲單身，沒房沒其他住宅協助，有租約，所得月均32000，想查115年中央租補，另外想看職訓生活津貼。",
  C01: "寶寶8個月，第一胎，具我國國籍、已在新北板橋登記戶籍，自己在家帶，沒有請領托育補助也沒有政府公費安置，只問115年中央0到未滿2歲育兒津貼。",
  C02: "台北的寶寶10個月、我國籍且已設戶籍，第二胎，沒有公費安置、還沒領育兒津貼。白天送保母，我不知道簽約狀態，想問該申請育兒津貼還是托育補助。",
  C05: "桃園，中壢的寶寶16個月，本國籍且有戶籍，第二胎，送已簽約準公共托嬰中心每週40小時。未領育兒津貼、未公費安置。想查中央托育費用補助。",
  C06: "我在新北，第一胎18個月，具我國籍已設戶籍，未公費安置；就讀政府公設民營托嬰中心每週40小時，正在領公共托育補助。可以同時請領中央0到2歲育兒津貼嗎？",
  S05: "我住台北松山，每月租14500，38歲本國籍有戶籍、單身，月入32000，名下有一間正常可住的完整住宅，沒其他住宅補助。想查中央租補。",
} as const;

const housing = (goal: string) => extractHousingFactsTyped(goal.normalize("NFKC"));
const childcare = (goal: string) => extractChildcareFactsTyped(goal.normalize("NFKC"));

function firstGateIsUnknown(run: AgentRun): void {
  if (run.status !== "WAITING_FOR_HUMAN" || !run.missingField || !run.state) return;
  assert.ok(
    isFieldMissing(run.missingField, run.state.applicant, run.state.actualScenario),
    `Human Gate asked ${run.missingField}, which the normalized state already knows`
  );
}

// ---------------------------------------------------------------- EX1–EX12
test("EX1 — an explicit city (or unambiguous district) is never re-asked", () => {
  for (const goal of ["臺北內湖月租18000，沒房沒其他住宅補助", "我在板橋租房，月租11000，沒房沒其他住宅補助", "租台北松山月租16000，沒房沒其他住宅補助"]) {
    const draft = buildCaseDraft(goal);
    assert.ok(draft.actualScenario.city, goal);
    const run = startCaseRun(draft);
    assert.notEqual(run.missingField, "city", goal);
    firstGateIsUnknown(run);
  }
});

test("EX2 — 沒有自有住宅 / 沒房 / 家裡無自有房屋 are KNOWN_FALSE, not missing", () => {
  for (const goal of ["我沒有自有住宅，在臺北租屋", "全家沒房，新北租屋", "家裡無自有房屋，在桃園租屋", "家裡沒自有屋，租新北"]) {
    const fact = housing(goal).facts.ownsHome;
    assert.equal(fact?.state, "KNOWN_FALSE", goal);
    assert.equal(buildCaseDraft(goal).applicant.ownsHome, false, goal);
  }
});

test("EX3 — explicit ownership statements are KNOWN_TRUE (and the encoded disqualifier is used)", () => {
  for (const goal of ["我名下有一間完整產權、可正常住的住宅，在臺北租屋", "本人持有住宅一戶，在新北租房", "我有自有住宅，在臺北租屋"]) {
    assert.equal(housing(goal).facts.ownsHome?.state, "KNOWN_TRUE", goal);
  }
  const run = startCaseRun(buildCaseDraft("在臺北大安租屋月租15000，32歲，名下有一間可正常居住的住宅，沒有其他住宅補助"));
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.centralStatus, "FAIL");
});

test("EX4 — 沒領 / 沒有其他住宅補助 / 未領住宅協助 are KNOWN_FALSE", () => {
  for (const goal of ["沒領其他住宅補助", "沒有其他補助", "未領其他住宅協助", "沒任何其他住宅補助", "無房無補助"]) {
    assert.equal(housing(`臺北租屋，${goal}`).facts.receivesOtherHousingAid?.state, "KNOWN_FALSE", goal);
  }
  assert.equal(housing("臺北租屋，我現領另一項政府租金補貼").facts.receivesOtherHousingAid?.state, "KNOWN_TRUE");
});

test("EX5 — 月租14500，38歲 stays rent 14500 and age 38 (no numeric concatenation)", () => {
  const facts = housing("我住台北松山，每月租14500，38歲本國籍有戶籍").facts;
  assert.equal(facts.monthlyRent?.value, 14500);
  assert.equal(facts.age?.value, 38);
  const draft = buildCaseDraft(P1.S05);
  assert.equal(draft.actualScenario.monthlyRent, 14500);
  assert.equal(draft.applicant.age, 38);
  assert.equal(draft.applicant.monthlyIncome, 32000);
});

test("EX6 — a negative childcare-subsidy mention does not erase childcare-allowance intent", () => {
  const goal = "沒有請領托育補助，我要問育兒津貼";
  assert.equal(detectBenefitDomain(goal), "CHILDCARE");
  const coverage = assessQueryCoverage(goal);
  assert.equal(coverage.status, "COVERED");
  assert.equal(coverage.reason, "CHILDCARE_UNDER2_ALLOWANCE_IN_SCOPE");
  assert.ok(!coverage.components?.some((component) => component.key === "CHILDCARE_SUBSIDY"), "status fact is not a request");
});

test("EX7 — a negated domain mention never routes into that domain", () => {
  for (const goal of ["我不是要問育兒，是要問長照", "租補和育兒都跟我無關，想問長照居家服務", "育兒跟我無關，想問老農津貼"]) {
    assert.notEqual(detectBenefitDomain(goal), "CHILDCARE", goal);
    const coverage = assessQueryCoverage(goal);
    assert.equal(coverage.status, "NOT_COVERED", goal);
    assert.equal(coverage.domain, "OTHER", goal);
    const run = startCaseRun(buildCaseDraft(goal));
    assert.equal(run.status, "NOT_COVERED", goal);
    assert.notEqual(run.missingField, "childAgeMonths", goal);
  }
});

test("EX8 — mixed supported + unsupported intent decomposes (supported part kept)", () => {
  const coverage = assessQueryCoverage("我在臺北租屋，沒房，想查中央租補，另外也想問職訓生活津貼");
  assert.equal(coverage.status, "COVERED");
  assert.equal(coverage.components?.find((component) => component.key === "VOCATIONAL_TRAINING")?.status, "NOT_COVERED");
  assert.equal(coverage.components?.find((component) => component.key === "RENTAL_SUBSIDY")?.status, "COVERED");
  assert.match(coverage.components?.find((component) => component.key === "VOCATIONAL_TRAINING")?.referral?.url ?? "", /wda\.gov\.tw/);
});

test("EX9 — known household registration is not re-asked (childcare)", () => {
  for (const goal of ["寶寶16個月，本國籍且有戶籍，第二胎，在家自己帶，未公費安置，想問育兒津貼", "孩子9個月已設戶籍，第一胎，自己帶，沒有公費安置，育兒津貼", "寶寶11個月，台北戶籍，頭胎，居家照顧，非公費安置，問育兒津貼"]) {
    assert.equal(childcare(goal).facts.childHasBirthOrInitialHouseholdRegistration?.state, "KNOWN_TRUE", goal);
    const run = startCaseRun(buildCaseDraft(goal));
    assert.notEqual(run.missingField, "childHasBirthOrInitialHouseholdRegistration", goal);
    firstGateIsUnknown(run);
  }
});

test("EX10 — the missing-field selector never asks a field the normalized state knows (property over many inputs)", () => {
  const places = ["臺北大安", "新北板橋", "桃園中壢", "高雄三民", "台南東區", "新竹市東區"];
  const ownership = ["沒房", "家裡無自有房屋", "名下有一間住宅", ""];
  const aid = ["沒其他住宅補助", "未領其他住宅協助", ""];
  const ages = ["28歲", "年齡41", ""];
  let checked = 0;
  for (const place of places) for (const own of ownership) for (const a of aid) for (const age of ages) {
    const goal = [`${place}租12000`, own, a, age, "想查中央租補"].filter(Boolean).join("，");
    const run = startCaseRun(buildCaseDraft(goal));
    firstGateIsUnknown(run);
    checked += 1;
  }
  assert.equal(checked, places.length * ownership.length * aid.length * ages.length);

  // Planner path: an ASK_HUMAN proposal for a known field is rejected by validation.
  const draft = buildCaseDraft("臺北內湖月租18000，沒房、沒其他住宅補助，45歲");
  const run = runAgenticGoldenCase(draft.goal, draft.applicant, draft.actualScenario, draft.whatIfScenario, {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model: "gpt-4o-mini",
    callAttempted: true,
    decision: { reasoningSummary: "ask city", nextAction: "ASK_HUMAN", missingField: "city", humanQuestion: "請問您的租屋所在地位於哪個縣市？" },
  }, { includePassport: true, whatIfMirrorsActual: true });
  assert.equal(run.trace[0]?.proposalRejected, true);
  assert.match(run.trace[0]?.rejectionReason ?? "", /^FIELD_ALREADY_KNOWN: city/);
  assert.notEqual(run.missingField, "city");
  assert.match(describeAgentDecision(run)?.validation ?? "", /不得重問/);
});

test("EX11 — contradictory facts produce a clarification gate that says why (no silent overwrite)", () => {
  const goal = "我沒有房，但我名下在桃園有一整間可正常住的住宅，台北租14000，27歲，沒其他住宅補助";
  const draft = buildCaseDraft(goal);
  assert.equal(draft.normalizedFacts?.ownsHome?.state, "CONFLICT");
  assert.equal(draft.applicant.ownsHome, null, "conflict is withheld, never silently resolved");
  const run = startCaseRun(draft);
  assert.equal(run.missingField, "ownsHome");
  assert.match(run.humanInputRequired ?? "", /你前面同時提到「沒有房」與「有一整間可正常住的住宅」/);
  // Answering resolves it; the explained gate does not reappear.
  const after = submitHumanGateAnswer(run, true, { whatIfMirrorsActual: draft.whatIfMirrorsActual }).run;
  assert.equal(after.state?.centralStatus, "FAIL");

  const aid = startCaseRun(buildCaseDraft("新北三重租14000，29歲，沒房。我沒有領任何住宅補貼，但我目前每月都領政府另一筆租金補貼"));
  assert.equal(aid.missingField, "receivesOtherHousingAid");
  assert.match(aid.humanInputRequired ?? "", /同時提到/);

  const twoCities = startCaseRun(buildCaseDraft("我在臺北市和新北市租房，月租12500，29歲，沒房、沒其他住宅補助"));
  assert.equal(twoCities.missingField, "city");
  assert.match(twoCities.humanInputRequired ?? "", /哪一個縣市的租約/);
});

test("EX12 — C01 routes to the supported childcare-allowance workflow (deterministic)", () => {
  for (let repeat = 0; repeat < 4; repeat += 1) {
    const draft = buildCaseDraft(P1.C01);
    assert.equal(draft.domain, "CHILDCARE");
    const run = startCaseRun(draft);
    assert.notEqual(run.status, "NOT_COVERED");
    assert.equal(run.coverage?.reason, "CHILDCARE_UNDER2_ALLOWANCE_IN_SCOPE");
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.state?.childcareStatus, "PASS");
    assert.ok(run.auditTrail.every((event) => !/central|rental|scenario/i.test(String((event.input as { toolName?: string })?.toolName ?? ""))), "no rental tool");
  }
});

// ---------------------------------------------------------------- Phase 3 polarity
test("PH3 — polarity: negated, status-fact and intent mentions are distinguished", () => {
  const polarity = (goal: string, term: string) => analyzeRequestIntent(goal).mentions.find((m) => m.term === term)?.polarity;
  assert.equal(polarity("我不是要問育兒，是要問長照", "育兒"), "NEGATED");
  assert.equal(polarity("租補跟我無關", "租補"), "NEGATED");
  assert.equal(polarity("沒有請領托育補助", "托育補助"), "STATUS_FACT");
  assert.equal(polarity("無公費安置或托育補助，想問中央育兒津貼", "托育補助"), "STATUS_FACT");
  assert.equal(polarity("正在領公共托育補助。可以同時請領育兒津貼嗎？", "公共托育補助"), "STATUS_FACT");
  assert.equal(polarity("正在領公共托育補助。可以同時請領育兒津貼嗎？", "育兒津貼"), "INTENT");
  assert.equal(housing("沒有政府公費安置").facts.receivesOtherHousingAid, undefined, "安置 is not a housing aid");
  assert.equal(childcare("沒有政府公費安置").facts.isGovernmentPlaced?.state, "KNOWN_FALSE");
  assert.equal(childcare("現在由政府全額公費安置").facts.isGovernmentPlaced?.state, "KNOWN_TRUE");
  // Hedged statements stay UNKNOWN.
  assert.equal(housing("我不確定房屋持有跟家庭所得").facts.ownsHome?.state, "UNKNOWN");
  assert.equal(housing("還沒有確認家裡是否有房").facts.ownsHome?.state, "UNKNOWN");
  assert.equal(childcare("白天送保母，我不知道簽約狀態").facts.receivesPublicOrQuasiPublicChildcare?.state, "UNKNOWN");
});

// ---------------------------------------------------------------- Phase 4 city / district
test("PH4 — districts infer their city when unambiguous; ambiguous names ask", () => {
  const cityOf = (goal: string) => buildCaseDraft(goal).actualScenario.city;
  assert.equal(cityOf("我在內湖租屋，月租15000"), "臺北市");
  assert.equal(cityOf("松山租屋月租14000"), "臺北市");
  assert.equal(cityOf("我在板橋租房月租11000"), "新北市");
  assert.equal(cityOf("永和租屋月租13000"), "新北市");
  assert.equal(cityOf("高雄三民租11000"), "高雄市");
  assert.equal(cityOf("中壢租屋月租9500"), "桃園市");
  assert.equal(cityOf("設籍台北，在中山區租屋每月14000"), "臺北市", "中山區 resolved by the Taipei context");
  assert.equal(buildCaseDraft("永和租屋月租13000").actualScenario.district, "永和區");

  // 中山區 exists in 臺北市 and 基隆市: without city context it must be asked, never guessed.
  const ambiguous = buildCaseDraft("我在中山區租屋，月租14000，沒房，沒其他住宅補助");
  assert.equal(ambiguous.actualScenario.city, undefined);
  const run = startCaseRun(ambiguous);
  assert.equal(run.missingField, "city");
  assert.match(run.humanInputRequired ?? "", /「中山區」可能位於不同縣市/);
  // Street names are not districts.
  assert.equal(cityOf("我住在中山路，想查租補"), undefined);
});

// ---------------------------------------------------------------- Phase 5 numeric parser
test("PH5 — numeric parser is field-local and range-checked", () => {
  const rentAge = (goal: string) => {
    const facts = housing(goal).facts;
    return [facts.monthlyRent?.value, facts.age?.value];
  };
  assert.deepEqual(rentAge("月租14500，38歲"), [14500, 38]);
  assert.deepEqual(rentAge("月租 14,500、38 歲"), [14500, 38]);
  assert.deepEqual(rentAge("租金1萬4500元，年齡38"), [14500, 38]);
  assert.deepEqual(rentAge("月租１４５００，３８歲"), [14500, 38], "full-width digits / comma");
  assert.equal(housing("台中西屯租一萬五").facts.monthlyRent?.value, 15000);
  assert.equal(housing("月入32000").facts.monthlyIncome?.value, 32000);
  assert.equal(housing("人均月收入34,000").facts.monthlyIncome?.value, 34000);
  assert.equal(housing("依財稅所得平均每人每月85000").facts.monthlyIncome?.value, 85000);
  assert.equal(housing("全戶每月所得90000").facts.monthlyIncome?.state, "UNKNOWN", "household total is not per-person income");
  assert.equal(childcare("孩子18個月").facts.childAgeMonths?.value, 18);
  assert.equal(childcare("第二胎").facts.birthOrder?.value, 2);
  assert.equal(childcare("孩子今天剛滿2歲").facts.childAgeMonths?.value, 24);
  // Two rents for one lease are a conflict, never merged or silently picked.
  assert.equal(housing("這份租約月租8000，也是一個月18000").facts.monthlyRent?.state, "CONFLICT");
  // Implausible values become UNKNOWN instead of a corrupted value.
  assert.equal(housing("月租5").facts.monthlyRent, undefined);
  // Clause splitting never treats a thousands separator as a clause break, and vice versa.
  assert.deepEqual(splitClauses("月租14,500,38歲").map((clause) => clause.text), ["月租14,500", "38歲"]);
  assert.equal(parseAmountAt("14500,38", 0)?.value, 14500);
});

// ---------------------------------------------------------------- P1 regression cases (frozen inputs)
test("P1-H04 — Taipei / Zhongshan + owned home: city not asked, encoded ownership rule FAILs", () => {
  const draft = buildCaseDraft(P1.H04);
  assert.equal(draft.actualScenario.city, "臺北市");
  assert.equal(draft.actualScenario.district, "中山區");
  assert.equal(draft.applicant.ownsHome, true);
  const run = startCaseRun(draft);
  assert.notEqual(run.missingField, "city");
  assert.equal(run.state?.centralStatus, "FAIL");
  assert.notEqual(run.state?.overallEligibilityStatus, "PASS");
});

test("P1-H12 — Taipei Neihu + income 85000: extraction fixed; income rule gap is NOT pretended", () => {
  const draft = buildCaseDraft(P1.H12);
  assert.equal(draft.actualScenario.city, "臺北市");
  assert.equal(draft.applicant.monthlyIncome, 85000);
  const run = startCaseRun(draft);
  assert.notEqual(run.missingField, "city");
  // The central income threshold is NOT encoded (POLICY_RULE_NOT_IMPLEMENTED): never PASS.
  assert.notEqual(run.state?.centralStatus, "PASS");
  assert.equal(run.state?.centralStatus, "PARTIAL_CHECK");
});

test("P1-U01 — Kaohsiung: central layer evaluable, local layer NOT_COVERED, next-state consistent", () => {
  const run = startCaseRun(buildCaseDraft(P1.U01));
  assert.equal(run.state?.centralStatus, "PARTIAL_CHECK");
  assert.equal(run.coverage?.components?.find((component) => component.key === "LOCAL_RENT_PROGRAM")?.status, "NOT_COVERED");
  assert.equal(run.coverage?.components?.find((component) => component.key === "CENTRAL_RENT_115")?.status, "COVERED");
  const next = describeAgentDecision(run)?.next ?? "";
  assert.doesNotMatch(next, /停止判定/, "a local-only boundary must not read as a whole-run stop");
});

test("P1-U05 — long-term care with negated 租補/育兒 is NOT_COVERED with a long-term-care referral", () => {
  const run = startCaseRun(buildCaseDraft(P1.U05));
  assert.equal(run.status, "NOT_COVERED");
  assert.notEqual(run.missingField, "childAgeMonths");
  assert.ok(run.coverage?.officialReferrals.some((ref) => ref.url === "https://1966.gov.tw/"));
});

test("P1-U06 — Tainan central rent kept; vocational allowance separated and referred", () => {
  const run = startCaseRun(buildCaseDraft(P1.U06));
  assert.notEqual(run.status, "NOT_COVERED");
  assert.equal(run.state?.centralStatus, "PARTIAL_CHECK");
  const vocational = run.coverage?.components?.find((component) => component.key === "VOCATIONAL_TRAINING");
  assert.equal(vocational?.status, "NOT_COVERED");
  assert.doesNotMatch(describeAgentDecision(run)?.next ?? "", /停止判定/);
  const html = renderToStaticMarkup(React.createElement(ScopeComponentsNotice, { run }));
  assert.match(html, /未涵蓋（不作判定）：職業訓練生活津貼/);
  assert.match(html, /本系統處理：300億元中央擴大租金補貼/);
});

test("P1-C01 — see EX12 (supported childcare allowance, never NOT_COVERED)", () => {
  assert.equal(assessQueryCoverage(P1.C01).status, "COVERED");
});

test("P1-C02 — allowance vs subsidy: asks the material provider/contract condition; subsidy part referred", () => {
  const run = startCaseRun(buildCaseDraft(P1.C02));
  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.missingField, "receivesPublicOrQuasiPublicChildcare");
  assert.equal(run.coverage?.components?.find((component) => component.key === "CHILDCARE_SUBSIDY")?.status, "NOT_COVERED");
  // Frozen follow-up: the babysitter is a government-contracted quasi-public provider.
  const after = submitHumanGateAnswer(run, true).run;
  assert.equal(after.state?.childcareStatus, "FAIL", "quasi-public care cannot be combined with the allowance");
});

test("P1-C05 — quasi-public childcare-cost subsidy only: not covered, explicit, referred (no allowance gate)", () => {
  const run = startCaseRun(buildCaseDraft(P1.C05));
  assert.equal(run.status, "NOT_COVERED");
  assert.equal(run.coverage?.domain, "CHILDCARE");
  assert.notEqual(run.missingField, "childHasBirthOrInitialHouseholdRegistration");
  assert.ok(run.coverage?.officialReferrals.some((ref) => /sfaa\.gov\.tw/.test(ref.url ?? "")));
  assert.equal(buildCaseDraft(P1.C05).applicant.childHasBirthOrInitialHouseholdRegistration, true, "有戶籍 is extracted");
});

test("P1-C06 — public childcare + allowance: existing non-duplication rule is reached (FAIL, not NOT_COVERED)", () => {
  const run = startCaseRun(buildCaseDraft(P1.C06));
  assert.equal(run.coverage?.reason, "CHILDCARE_UNDER2_ALLOWANCE_IN_SCOPE");
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.childcareStatus, "FAIL");
});

test("P1-S05 — 每月租14500，38歲 never becomes 1,450,038; owned home FAILs central", () => {
  const draft = buildCaseDraft(P1.S05);
  assert.equal(draft.actualScenario.monthlyRent, 14500);
  assert.equal(draft.applicant.age, 38);
  assert.equal(draft.applicant.ownsHome, true);
  assert.equal(startCaseRun(draft).state?.centralStatus, "FAIL");
});

// ---------------------------------------------------------------- Generalization (different wording)
test("GEN — reworded variants of the P1 failure modes behave the same", () => {
  // Numeric adjacency with other fields.
  const a = buildCaseDraft("住新北永和，每月租12800，27歲，月入31000，沒房沒其他住宅補助");
  assert.deepEqual([a.actualScenario.monthlyRent, a.applicant.age, a.applicant.monthlyIncome], [12800, 27, 31000]);
  // Negated domain with another unsupported topic.
  assert.equal(startCaseRun(buildCaseDraft("想問老年農民福利津貼，育兒的事不需要")).status, "NOT_COVERED");
  // Status-fact childcare words + allowance intent.
  const c = startCaseRun(buildCaseDraft("小孩5個月，第三胎，已報戶口，在家照顧，未經公費安置，沒有托育補助，想申請育兒津貼"));
  assert.equal(c.status, "COMPLETED");
  assert.equal(c.state?.childcareStatus, "PASS");
  // Unsupported local layer for another uncovered city keeps the central part.
  const t = startCaseRun(buildCaseDraft("在台中北屯租房13000，30歲，沒房沒其他住宅補助，想看中央租補和台中市地方加碼"));
  assert.equal(t.state?.centralStatus, "PARTIAL_CHECK");
  assert.equal(t.coverage?.reason, "CENTRAL_ONLY_LOCAL_NOT_COVERED");
});

test("GEN — supported presets and prior inputs are unchanged by the new extractor", () => {
  const legacy = buildCaseDraft("我是 29 歲，月薪 35000 元，在新北市永和區租屋，戶籍在臺北市，未來想搬到臺北市大安區，名下沒有房子，已核准中央租金補貼，在新北工作");
  assert.equal(legacy.actualScenario.city, "新北市");
  assert.equal(legacy.whatIfScenario.city, "臺北市");
  assert.equal(legacy.applicant.registeredCity, "臺北市");
  assert.equal(legacy.applicant.ownsHome, false);
  assert.equal(legacy.applicant.monthlyIncome, 35000);
  const dual = buildCaseDraft("想比較雙北租屋補助，月租 18,000 元");
  assert.equal(dual.actualScenario.monthlyRent, 18000);
  assert.equal(dual.whatIfScenario.city, "新北市");
});
