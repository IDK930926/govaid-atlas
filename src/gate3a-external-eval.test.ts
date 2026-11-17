import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextPanel, WorkflowProgress } from "./App";
import { describeCaseModelUse } from "./agent-decision-view";
import { runAgenticGoldenCase } from "./agent/orchestrator";
import { callTool } from "./agent/tools";
import type { ProviderPlannerResult } from "./agent/providers/types";
import type { AgentDecision } from "./agent/types";
import {
  DUAL_CITY_ACTUAL_SCENARIO,
  DEFAULT_GOAL,
  PRESET_HOUSING_APPLICANT,
  PRESET_TAOYUAN_APPLICANT,
  WENSHAN_WHAT_IF_SCENARIO,
} from "./case-input";
import { getEvidence } from "./evidence";
import {
  CENTRAL_RENT_MULTIPLIERS,
  CENTRAL_RENT_MULTIPLIER_REFORM_DATE,
  centralRentChildMultiplier,
  estimateRentalSubsidyComparison,
  getApplicationGuide,
  lookupCentralRentTierAmounts,
} from "./navigation";
import type { ScenarioResult } from "./scenario";
import type { AddressScenario, ApplicantProfile } from "./types";

// Gate 3A — corrections for issues observed by the independent Synthetic User Evaluation.
// Amounts/multipliers verified against 作業規定 附表四／附表五 (國署住字第1151002186號令,
// 行政院公報 第032卷第006期 2026-01-09, 自115/1/1生效).

const eligible: ApplicantProfile = { ...PRESET_HOUSING_APPLICANT, ownsHome: false, newTaipeiResidenceStudyWork: false };
const scenarioOf = (scenario: AddressScenario, applicant: ApplicantProfile = eligible) =>
  callTool("evaluate_actual_scenario", { profile: applicant, scenario }).result as ScenarioResult;

// ---------------------------------------------------------------- F01
test("F01-1 — Taipei tier table is 8000 / 5000 / 3000", () => {
  assert.deepEqual(lookupCentralRentTierAmounts("臺北市", "文山區"), { tier1: 8000, tier2: 5000, tier3: 3000 });
});

test("F01-2 — Yonghe / qualifying New Taipei district is 5000 / 4000 / 2400", () => {
  for (const district of ["永和區", "板橋區", "中和區", "新店區"]) {
    assert.deepEqual(lookupCentralRentTierAmounts("新北市", district), { tier1: 5000, tier2: 4000, tier3: 2400 }, district);
  }
  // Remote districts are a separate official row; never conflated with Yonghe.
  assert.deepEqual(lookupCentralRentTierAmounts("新北市", "烏來區"), { tier1: 3600, tier2: 3200, tier3: 2000 });
  assert.deepEqual(lookupCentralRentTierAmounts("桃園市", "桃園區"), { tier1: 5000, tier2: 4000, tier3: 2400 });
  assert.equal(lookupCentralRentTierAmounts("新北市", undefined), null, "unknown district: no guessed bracket");

  const yonghe = estimateRentalSubsidyComparison(scenarioOf(DUAL_CITY_ACTUAL_SCENARIO), "臺北市");
  assert.match(yonghe.maxSubsidy, /第三級基準（級距未判定） NT\$2,400 \/ 月/);
  assert.match(yonghe.maxSubsidy, /第一級 NT\$5,000／第二級 NT\$4,000／第三級 NT\$2,400/);
  assert.doesNotMatch(yonghe.maxSubsidy, /2,200/, "2,200 is the 臺南／高雄 第三級, not 新北");
});

test("F01-3 — an undetermined tier is never labelled 第一級 (or any determined tier)", () => {
  const taipei = estimateRentalSubsidyComparison(scenarioOf(WENSHAN_WHAT_IF_SCENARIO), "臺北市");
  const yonghe = estimateRentalSubsidyComparison(scenarioOf(DUAL_CITY_ACTUAL_SCENARIO), "臺北市");
  for (const estimate of [taipei, yonghe]) {
    assert.doesNotMatch(estimate.maxSubsidy, /第一級單身|R1 第一級|第二／三級/);
    assert.match(estimate.maxSubsidy, /級距未判定/);
    assert.match(estimate.maxSubsidy, /未判定補貼級距/);
    assert.match(estimate.note, /級距未判定/);
  }
  assert.match(taipei.maxSubsidy, /第三級基準（級距未判定） NT\$3,000 \/ 月/);
  assert.match(taipei.maxSubsidy, /第一級 NT\$8,000／第二級 NT\$5,000／第三級 NT\$3,000/);
  // Out-of-pocket uses the 第三級 base: 15,500 − 3,000.
  assert.match(taipei.outOfPocket, /NT\$12,500/);
});

// ---------------------------------------------------------------- F02
const taoyuanFormula = () => getApplicationGuide("TAOYUAN_CENTRAL_RENT_115")!.benefitAmountFormula ?? "";

test("F02-1 — pre-115 marriage / minor-child multipliers remain and are date-distinguished", () => {
  assert.equal(CENTRAL_RENT_MULTIPLIERS.newlywed.registeredOnOrBefore20251231, 1.3);
  assert.equal(centralRentChildMultiplier("PRE_115", 1), 1.4);
  assert.equal(centralRentChildMultiplier("PRE_115", 2), 1.6);
  assert.equal(centralRentChildMultiplier("PRE_115", 3), 1.8);
  const formula = taoyuanFormula();
  assert.match(formula, /114\/12\/31 前（含）登記結婚 1\.3 倍/);
  assert.match(formula, /子女非 115\/1\/1 後出生：1人 1\.4 倍/);
  // The old undated phrasing must be gone.
  assert.doesNotMatch(formula, /新婚（1\.3倍）|育有未成年子女（1\.4倍起）/);
});

test("F02-2 — post-115/1/1 newly married = 1.5×", () => {
  assert.equal(CENTRAL_RENT_MULTIPLIER_REFORM_DATE, "2026-01-01");
  assert.equal(CENTRAL_RENT_MULTIPLIERS.newlywed.registeredOnOrAfter20260101, 1.5);
  assert.match(taoyuanFormula(), /115\/1\/1 後（含）登記結婚 1\.5 倍/);
});

test("F02-3 — post-115/1/1 newborn: 1 → 2×, 2 → 2.5×, 3 → 3×, +0.5 each further", () => {
  assert.equal(centralRentChildMultiplier("POST_115_NEWBORN", 1), 2);
  assert.equal(centralRentChildMultiplier("POST_115_NEWBORN", 2), 2.5);
  assert.equal(centralRentChildMultiplier("POST_115_NEWBORN", 3), 3);
  assert.equal(centralRentChildMultiplier("POST_115_NEWBORN", 4), 3.5);
  assert.match(taoyuanFormula(), /115\/1\/1 後（含）有新生兒出生：1人 2 倍、2人 2\.5 倍、3人 3 倍/);
});

test("F02-4 — unknown marriage / birth date: no multiplier is selected as fact", () => {
  // The applicant model collects marital status / child count but no marriage or birth date.
  for (const key of Object.keys(PRESET_TAOYUAN_APPLICANT)) {
    assert.doesNotMatch(key, /marriageDate|birthDate|newborn/i);
  }
  const formula = taoyuanFormula();
  assert.match(formula, /本系統未取得上述日期，不判定適用倍數/);
  assert.equal(getApplicationGuide("TAOYUAN_CENTRAL_RENT_115")!.estimatedMonthlyBenefitNtd, null);
  assert.match(getApplicationGuide("CENTRAL_RENT_115")!.benefitAmountFormula ?? "", /115\/1\/1 以後而不同/);
});

// ---------------------------------------------------------------- F03
function llmPlanner(): ProviderPlannerResult {
  return {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model: "gpt-4o-mini",
    callAttempted: true,
    decision: { nextAction: "ASK_HUMAN", humanQuestion: "x" } as unknown as AgentDecision,
  };
}

function renderContext(run: ReturnType<typeof runAgenticGoldenCase>, lastInferenceSeconds: number | null) {
  return renderToStaticMarkup(React.createElement(ContextPanel, {
    run,
    running: false,
    applicant: PRESET_HOUSING_APPLICANT,
    providerInfo: { provider: "OPENAI", providerStatus: "AVAILABLE", available: true, mode: "cloud", model: "gpt-4o-mini" } as never,
    providerKind: "CLOUD AGENT",
    providerReady: true,
    providerError: null,
    lastInferenceSeconds,
  }));
}

test("F03 — manual rules case never implies the current case called the model", () => {
  const manual = runAgenticGoldenCase(DEFAULT_GOAL, { ...PRESET_HOUSING_APPLICANT }, DUAL_CITY_ACTUAL_SCENARIO, WENSHAN_WHAT_IF_SCENARIO);
  assert.deepEqual(describeCaseModelUse(manual), { label: "本案決策：未呼叫模型（系統規則）", modelPlanned: false });

  // Even if a latency from an earlier model case were still in state, it must not render for this case.
  const html = renderContext(manual, 2.4);
  assert.match(html, /本案決策/);
  assert.match(html, /未呼叫模型/);
  assert.match(html, /目前可用模型/);
  assert.doesNotMatch(html, /規劃耗時/);
  assert.doesNotMatch(html, /<dt>模型<\/dt>/, "unscoped 模型 label is gone");

  // A case that really used the model keeps its own latency (useful runtime info preserved).
  const modelCase = runAgenticGoldenCase(DEFAULT_GOAL, { ...PRESET_HOUSING_APPLICANT }, DUAL_CITY_ACTUAL_SCENARIO, WENSHAN_WHAT_IF_SCENARIO, llmPlanner());
  assert.equal(describeCaseModelUse(modelCase)?.modelPlanned, true);
  assert.match(renderContext(modelCase, 2.4), /本案模型規劃耗時.*2\.4 秒/);
});

// ---------------------------------------------------------------- F04
test("F04 — Taoyuan R9 points to the program-specific official notice, not a homepage", () => {
  const r9 = getEvidence("R9")!;
  assert.match(r9.url, /^https:\/\/ohd\.tycg\.gov\.tw\/News_Content\.aspx\?n=8601&s=1601436$/);
  assert.notEqual(r9.url, "https://ohd.tycg.gov.tw/");
  assert.match(r9.policyName, /115年度/);
  assert.ok(getApplicationGuide("TAOYUAN_CENTRAL_RENT_115")!.officialSources.some((source) => source.url === r9.url));
});

// ---------------------------------------------------------------- F05
test("F05 — childcare header has no relocation-comparison stage", () => {
  const childcare = renderToStaticMarkup(React.createElement(WorkflowProgress, { status: "COMPLETED", running: false, domain: "CHILDCARE" }));
  assert.doesNotMatch(childcare, /情境比較/);
  assert.match(childcare, /資格與金額/);
  const housing = renderToStaticMarkup(React.createElement(WorkflowProgress, { status: "COMPLETED", running: false, domain: "HOUSING" }));
  assert.match(housing, /情境比較/, "housing header unchanged");
});
