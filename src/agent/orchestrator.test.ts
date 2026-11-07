import assert from "node:assert/strict";
import test from "node:test";

import { isOpenAIConfigured } from "./client";
import { runBoundedAgentLoop, validateAgentDecision, runAgenticGoldenCase } from "./orchestrator";
import { callTool } from "./tools";

const applicant = {
  age: 20,
  maritalStatus: "single" as const,
  childrenCount: 0,
  registeredCity: "臺北市",
  ownsHome: null,
  receivesOtherHousingAid: false,
  monthlyIncome: null,
  centralRentApproved: null,
  newTaipeiResidenceStudyWork: null,
};

const actualScenario = {
  type: "ACTUAL" as const,
  address: "新北市永和區",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfScenario = {
  type: "WHAT_IF" as const,
  address: "臺北市文山區",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

test("A1 Agent cannot invent unknown tool", () => {
  const result = callTool("unknown_tool", {});
  assert.equal(result.ok, false);
  assert.match(result.summary, /AGENT_TOOL_DENIED/);
});

test("A2 ownsHome = null waits for human", () => {
  const run = runAgenticGoldenCase("Goal", applicant, actualScenario, whatIfScenario);
  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.match(run.humanInputRequired ?? "", /住宅/);
});

test("A3 human confirms ownsHome = false resumes", () => {
  const run = runAgenticGoldenCase("Goal", { ...applicant, ownsHome: null }, actualScenario, whatIfScenario);
  const resumed = runAgenticGoldenCase("Goal", { ...applicant, ownsHome: false }, actualScenario, whatIfScenario);
  assert.equal(resumed.status, "COMPLETED");
});

test("A4 deterministic rule result remains UNCERTAIN", () => {
  const result = callTool("evaluate_central_rules", { profile: applicant });
  assert.equal(result.status, "UNCERTAIN");
  assert.notEqual(result.status, "PASS");
});

test("A5 policy conflict requires human review", () => {
  const result = callTool("detect_policy_conflict", {});
  assert.equal(result.status, "HUMAN_REVIEW_REQUIRED");
});

test("A6 missing OPENAI_API_KEY fails safely", () => {
  delete process.env.OPENAI_API_KEY;
  assert.equal(isOpenAIConfigured(), false);
});

test("A7 invalid LLM schema is rejected", () => {
  const invalidDecision = { reasoningSummary: "bad", nextAction: "UNKNOWN" };
  assert.equal(validateAgentDecision(invalidDecision), false);
});

test("A8 max agent steps exceeded fails closed", () => {
  const run = runBoundedAgentLoop("Goal", { ...applicant, ownsHome: false }, actualScenario, whatIfScenario, { forceLoop: true });
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorCode, "MAX_AGENT_STEPS_EXCEEDED");
});
