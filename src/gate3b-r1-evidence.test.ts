import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowProgress } from "./App";
import { buildCaseDraft, CASE_PRESETS, DEFAULT_GOAL, startCaseRun, submitHumanGateAnswer } from "./case-input";
import { getEvidence } from "./evidence";
import { getApplicationGuide } from "./navigation";
import type { AgentRun } from "./agent/types";
import type { DecisionPassport } from "./passport";

// Gate 3B — R1 evidence repair. Configured metadata only; no live network access.
const DEAD_R1 = "thd.taichung.gov.tw/media/";
const OFFICIAL_HOST = /^https:\/\/([a-z0-9-]+\.)*gov\.tw\//;

test("R1-1 — primary R1 URL is the central agency's official regulation page", () => {
  const r1 = getEvidence("R1")!;
  assert.match(r1.url, OFFICIAL_HOST);
  assert.equal(r1.url, "https://www.nlma.gov.tw/ch/legislation/law%26regu/6670");
  for (const ref of r1.supportingReferences ?? []) {
    assert.match(ref.url, OFFICIAL_HOST, ref.label);
  }
});

test("R1-2 — the dead Taichung-hosted URL is no longer referenced anywhere in src", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|json)$/.test(name) && !name.startsWith("gate3b-")) files.push(path);
    }
  };
  walk("src");
  for (const file of files) {
    assert.ok(!readFileSync(file, "utf8").includes(DEAD_R1), `${file} still references the dead R1 URL`);
  }
  assert.ok(!JSON.stringify(getEvidence("R1")).includes("thd.taichung"));
});

test("R1-3 — R1 identifies the 300億元 central rental subsidy programme and agency", () => {
  const r1 = getEvidence("R1")!;
  assert.equal(r1.agency, "內政部國土管理署");
  assert.match(r1.policyName, /三百億元中央擴大租金補貼專案計畫作業規定/);
  assert.match(r1.policyName, /115年度/);
});

test("R1-4 — version / provenance metadata is present", () => {
  const r1 = getEvidence("R1")!;
  assert.match(r1.policyVersion ?? "", /國署住字第1151002186號/);
  assert.match(r1.policyVersion ?? "", /115\.1\.9/);
  assert.equal(r1.lastVerifiedAt, "2026-11-17");
  assert.match(r1.supersedes ?? "", /404/);
  const refs = r1.supportingReferences ?? [];
  assert.ok(refs.some((ref) => ref.url.startsWith("https://gazette.nat.gov.tw/") && /第032卷第006期/.test(ref.label)), "Gazette record");
  assert.ok(refs.some((ref) => ref.url === "https://pip.moi.gov.tw/Publicize/Info/B1020"), "MOI programme page");
});

function answer(run: AgentRun): string | number | boolean {
  if (run.missingField === "age") return 28;
  if (run.missingField === "monthlyIncome") return 40000;
  return false;
}

function completePassport(goal: string): DecisionPassport {
  const draft = buildCaseDraft(goal);
  let run = startCaseRun(draft);
  for (let i = 0; i < 6 && run.status === "WAITING_FOR_HUMAN"; i += 1) {
    run = submitHumanGateAnswer(run, answer(run), { whatIfMirrorsActual: draft.whatIfMirrorsActual }).run;
  }
  const event = [...run.auditTrail].reverse().find((item) =>
    item.action === "AGENT_TOOL_COMPLETED" && (item.input as { toolName?: string })?.toolName === "generate_decision_passport");
  return (event?.output as { result: DecisionPassport }).result;
}

test("R1-5 — Decision Passport cites the repaired R1 evidence", () => {
  const passport = completePassport(DEFAULT_GOAL);
  const json = JSON.stringify(passport);
  assert.ok(!json.includes(DEAD_R1), "no dead R1 URL anywhere in the passport");
  assert.ok(json.includes("https://www.nlma.gov.tw/ch/legislation/law%26regu/6670"), "repaired R1 URL is cited");
});

test("R1-6 — Taoyuan (and central) application guidance no longer depends on the dead URL", () => {
  for (const id of ["TAOYUAN_CENTRAL_RENT_115", "CENTRAL_RENT_115"]) {
    const guide = getApplicationGuide(id)!;
    assert.ok(!JSON.stringify(guide).includes(DEAD_R1), id);
    assert.equal(guide.formUrl, "https://pip.moi.gov.tw/Upload/HouSubsidy/File2/115Y_01_租金補貼申請書.pdf", id);
  }
  const taoyuan = getApplicationGuide("TAOYUAN_CENTRAL_RENT_115")!;
  assert.ok(taoyuan.officialSources.some((source) => source.sourceId === "R1" && source.url.startsWith("https://www.nlma.gov.tw/")));
});

test("P3 — single-city Taoyuan header shows no relocation-comparison stage; dual-city keeps it", () => {
  const taoyuan = CASE_PRESETS.find((preset) => preset.id === "housing-taoyuan")!;
  assert.equal(buildCaseDraft(taoyuan.goal).whatIfMirrorsActual, true);
  assert.equal(buildCaseDraft(DEFAULT_GOAL).whatIfMirrorsActual, false);

  const single = renderToStaticMarkup(React.createElement(WorkflowProgress, { status: "COMPLETED", running: false, domain: "HOUSING", hasComparison: false }));
  assert.doesNotMatch(single, /情境比較/);
  assert.match(single, /資格評估/);
  const dual = renderToStaticMarkup(React.createElement(WorkflowProgress, { status: "COMPLETED", running: false, domain: "HOUSING", hasComparison: true }));
  assert.match(dual, /情境比較/);
});
