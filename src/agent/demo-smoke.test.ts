import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCaseDraft,
  submitHumanGateAnswer,
} from "../case-input";
import {
  runAgenticGoldenCase,
  validatePlannerProposal,
} from "./orchestrator";
import { assessQueryCoverage } from "../coverage";
import type { ProviderPlannerResult } from "./providers/types";

test("DEMO-01 — Custom Taipei/New Taipei housing", () => {
  const goal = "我是 29 歲，月薪 35000 元，在新北市永和區租屋，戶籍在臺北市，未來想搬到臺北市大安區，名下沒有房子，已核准中央租金補貼，在新北工作";
  const edits = {
    HOUSING: { ownsHome: "false", receivesOtherHousingAid: "false", registeredCity: "臺北市" },
    CHILDCARE: {},
  };
  const draft = buildCaseDraft(goal, edits);

  assert.equal(draft.domain, "HOUSING");
  assert.equal(draft.applicant.age, 29);
  assert.equal(draft.applicant.monthlyIncome, 35000);
  assert.equal(draft.applicant.ownsHome, false);

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    {
      includePassport: true,
      requiredFields: ["ownsHome", "receivesOtherHousingAid"],
    }
  );

  assert.equal(run.status, "COMPLETED");
  assert.ok(run.auditTrail.length > 0);

  // Decision Passport generated with ApplicationGuide
  const passportEv = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_decision_passport"
  );
  assert.ok(passportEv, "Passport must be generated");
  const passport = (passportEv?.output as { result?: { applicationGuides?: Array<{ onlineApplicationUrl?: string }> } })?.result;
  assert.ok(passport?.applicationGuides && passport.applicationGuides.length > 0);
  assert.ok(passport.applicationGuides.some((g) => g.onlineApplicationUrl?.includes("has.nlma.gov.tw")));
});

test("DEMO-02 — Custom Taoyuan housing", () => {
  const goal = "我目前租屋在桃園市中壢區，年齡 26 歲，月薪 42000 元，沒有自有住宅，未曾申請中央租金補貼";
  const edits = {
    HOUSING: { ownsHome: "false", receivesOtherHousingAid: "false" },
    CHILDCARE: {},
  };
  const draft = buildCaseDraft(goal, edits);

  assert.equal(draft.domain, "HOUSING");
  assert.equal(draft.actualScenario.city, "桃園市");

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    {
      includePassport: true,
      requiredFields: ["ownsHome", "receivesOtherHousingAid"],
    }
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.overallEligibilityStatus, "PARTIAL_CHECK");

  const passportEv = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_decision_passport"
  );
  const passport = (passportEv?.output as { result?: { actual?: { programs?: Array<{ policyId: string; status: string }> } } })?.result;
  const tao = passport?.actual?.programs?.find((p) => p.policyId === "TAOYUAN_CENTRAL_RENT_115");
  assert.ok(tao, "Taoyuan central intake program must be present");
  assert.equal(tao?.status, "PARTIAL_CHECK");
});

test("DEMO-03 — Childcare second-child case", () => {
  const goal = "我的小孩 18 個月，是第二胎，目前自己帶沒有送準公共托育，也沒有公費安置，已報戶口";
  const draft = buildCaseDraft(goal);

  assert.equal(draft.domain, "CHILDCARE");
  assert.equal(draft.applicant.childAgeMonths, 18);
  assert.equal(draft.applicant.birthOrder, 2);

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    { includePassport: true }
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.overallEligibilityStatus, "PASS");

  const passportEv = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_childcare_passport"
  );
  const passport = (passportEv?.output as { result?: { childcare?: { estimatedMonthlyBenefitNtd?: number } } })?.result;
  assert.equal(passport?.childcare?.estimatedMonthlyBenefitNtd, 6000);
});

test("DEMO-04 — Missing field Human Gate", () => {
  const goal = "我是 24 歲，住在新北市永和區，想申請租金補貼，月薪 30000 元";
  const edits = {
    HOUSING: { receivesOtherHousingAid: "false" },
    CHILDCARE: {},
  };
  const draft = buildCaseDraft(goal, edits);
  // Deliberately set ownsHome to null to trigger human gate
  draft.applicant.ownsHome = null;

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    undefined,
    { requiredFields: ["ownsHome", "receivesOtherHousingAid"] }
  );

  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.missingField, "ownsHome");

  // User answers Human Gate: does not own home (false)
  const answered = submitHumanGateAnswer(run, false);
  assert.equal(answered.ok, true);
  assert.equal(answered.run.status, "COMPLETED");
  assert.equal(answered.run.state?.applicant.ownsHome, false);
});

test("DEMO-05 — NOT_COVERED with official referral", () => {
  const coverage = assessQueryCoverage("我想了解準公共托育補助如何申請");
  assert.equal(coverage.status, "NOT_COVERED");
  assert.equal(coverage.domain, "CHILDCARE");
  assert.ok(coverage.officialReferrals.length > 0);
  assert.ok(coverage.officialReferrals.some((ref) => ref.url?.includes("sfaa.gov.tw")));
});

test("DEMO-06 — Provider unavailable fallback", () => {
  const goal = "我的小孩 12 個月，是第一胎，沒有送準公共托育，沒有公費安置，已報戶口，想申請育兒津貼";
  const draft = buildCaseDraft(goal);

  const unavailablePlanner: ProviderPlannerResult = {
    provider: "OLLAMA",
    model: "qwen3.5:4b",
    providerStatus: "UNAVAILABLE",
    error: "Connection refused to Ollama server",
    decision: undefined,
  };

  const run = runAgenticGoldenCase(
    goal,
    draft.applicant,
    draft.actualScenario,
    draft.whatIfScenario,
    unavailablePlanner,
    { domain: "CHILDCARE", includePassport: true }
  );

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.overallEligibilityStatus, "PASS");

  const passportEv = [...run.auditTrail].reverse().find(
    (ev) => ev.action === "AGENT_TOOL_COMPLETED" && (ev.output as { toolName?: string })?.toolName === "generate_childcare_passport"
  );
  const passport = (passportEv?.output as { result?: { childcare?: { estimatedMonthlyBenefitNtd?: number } } })?.result;
  assert.equal(passport?.childcare?.estimatedMonthlyBenefitNtd, 5000);
  assert.ok(run.auditTrail.some((ev) => ev.action === "AGENT_LLM_CALL_FAILED"));
});

test("DEMO-07 — Invalid tool rejection", () => {
  const validation = validatePlannerProposal(
    {
      reasoningSummary: "Attempt malicious command execution",
      nextAction: "CALL_TOOL",
      toolName: "execute_system_command",
      toolArguments: { cmd: "whoami" },
    },
    {
      domain: "HOUSING",
      applicant: { age: 25, ownsHome: false },
      actualScenario: { type: "ACTUAL", city: "新北市", address: "新北市永和區合成地址", monthlyRent: 13500 },
      whatIfScenario: { type: "WHAT_IF", city: "臺北市", address: "臺北市文山區合成地址", monthlyRent: 15500 },
      requiredFields: [],
      completedTools: [],
      executedAtSignature: new Set(),
    }
  );

  assert.equal(validation.valid, false);
  assert.equal(validation.proposalRejected, true);
  assert.equal(validation.rejectionReason, "TOOL_NOT_IN_ALLOWLIST: execute_system_command");
});
