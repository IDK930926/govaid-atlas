// Gate B — final runtime hardening regression tests (B2–B7).
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { handleRequest, resetRateLimiter } from "../server";
import { assessQueryCoverage } from "../coverage";
import { estimateRentalSubsidyComparison } from "../navigation";
import { describeExecution, failGap } from "../App";
import { runAgenticGoldenCase } from "./orchestrator";
import {
  callPlanner,
  DEFAULT_PLANNER_BUDGET_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  getProviderChain,
  isOllamaConfigured,
} from "./client";
import { getOpenAITimeoutMs } from "./providers/openai";
import { getOllamaHealthTimeoutMs, getOllamaTimeoutMs } from "./providers/ollama";
import type { ProviderPlannerInput, ProviderPlannerResult } from "./providers/types";
import type { DecisionPassport } from "../passport";
import type { ScenarioResult } from "../scenario";
import type { AddressScenario, ApplicantProfile } from "../types";

const ENV_KEYS = [
  "AGENT_PROVIDER",
  "AGENT_PROVIDER_TIMEOUT_MS",
  "AGENT_PLANNER_BUDGET_MS",
  "OPENAI_API_KEY",
  "OPENAI_TIMEOUT_MS",
  "OLLAMA_MODEL",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRateLimiter();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function invokeServer(body: string): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = Readable.from([Buffer.from(body, "utf8")]);
    const req = Object.assign(stream, {
      method: "POST",
      url: "/api/agent/plan",
      headers: { "content-type": "application/json" },
      socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
    let statusCode = 200;
    let headersSent = false;
    const chunks: Buffer[] = [];
    const res = {
      get headersSent() {
        return headersSent;
      },
      writeHead(code: number) {
        statusCode = code;
        headersSent = true;
        return res;
      },
      end(chunk?: string | Buffer) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString("utf8");
        resolvePromise({ statusCode, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
        return res;
      },
      setHeader() {
        return res;
      },
      destroy() {},
    } as unknown as ServerResponse;
    handleRequest(req, res).catch(rejectPromise);
  });
}

const FAKE_KEY = "sk-test-fake-gate-b-key";
const input: ProviderPlannerInput = { goal: "我想申請租屋補助", availableTools: ["evaluate_central_rules"] };
const okDecision = { reasoningSummary: "Run central rules.", nextAction: "CALL_TOOL" as const, toolName: "evaluate_central_rules" as const };

/** A provider that never answers on its own; resolves only when the client aborts it. */
function hangingProvider(seen: { aborted: boolean }) {
  return (call: ProviderPlannerInput) =>
    new Promise<ProviderPlannerResult>((resolveCall) => {
      call.signal?.addEventListener("abort", () => {
        seen.aborted = true;
        resolveCall({ provider: "OPENAI", providerStatus: "UNAVAILABLE", model: "m", callAttempted: true, errorClass: "TIMEOUT" });
      });
    });
}

// ---------------------------------------------------------------- B2 provider config
test("B2 — AGENT_PROVIDER has one meaning: unset/blank/auto = OPENAI→OLLAMA, and Ollama config follows the chain", () => {
  delete process.env.AGENT_PROVIDER;
  assert.deepEqual(getProviderChain(), ["OPENAI", "OLLAMA"]);
  assert.equal(isOllamaConfigured(), true);

  process.env.AGENT_PROVIDER = "  ";
  assert.deepEqual(getProviderChain(), ["OPENAI", "OLLAMA"]);

  process.env.AGENT_PROVIDER = "AUTO";
  assert.equal(isOllamaConfigured(), true, "auto includes Ollama (previously reported false)");

  process.env.AGENT_PROVIDER = "openai";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  assert.equal(isOllamaConfigured(), false, "openai-only mode must not report Ollama as configured");

  process.env.AGENT_PROVIDER = "ollama";
  assert.equal(isOllamaConfigured(), true);

  process.env.AGENT_PROVIDER = "gemini";
  assert.deepEqual(getProviderChain(), []);
  assert.equal(isOllamaConfigured(), false);
});

// ---------------------------------------------------------------- B3 timeout hierarchy
test("B3 — default timeout hierarchy is internally consistent", () => {
  assert.equal(DEFAULT_PROVIDER_TIMEOUT_MS, 8_000);
  assert.equal(DEFAULT_PLANNER_BUDGET_MS, 10_000);
  assert.ok(DEFAULT_PROVIDER_TIMEOUT_MS <= DEFAULT_PLANNER_BUDGET_MS);
  delete process.env.OPENAI_TIMEOUT_MS;
  assert.ok(getOpenAITimeoutMs() <= DEFAULT_PROVIDER_TIMEOUT_MS, "OpenAI cap must not exceed the per-attempt cap");
  assert.ok(getOllamaTimeoutMs() <= DEFAULT_PROVIDER_TIMEOUT_MS, "Ollama cap must not exceed the per-attempt cap");
  assert.ok(getOllamaHealthTimeoutMs() < getOllamaTimeoutMs());
});

test("B3 — auto chain is bounded by ONE planner budget; a hung OpenAI call is aborted, classified TIMEOUT, and the budget is not exceeded", async () => {
  process.env.AGENT_PROVIDER = "auto";
  process.env.OPENAI_API_KEY = FAKE_KEY;
  process.env.AGENT_PROVIDER_TIMEOUT_MS = "120";
  process.env.AGENT_PLANNER_BUDGET_MS = "150";

  const seen = { aborted: false };
  let ollamaTimeoutMs: number | undefined;
  const started = performance.now();
  const result = await callPlanner(input, {
    callOpenAI: hangingProvider(seen),
    callOllama: async (call) => {
      ollamaTimeoutMs = call.timeoutMs;
      return { provider: "OLLAMA", providerStatus: "AVAILABLE", model: "qwen3.5:4b", callAttempted: true, decision: okDecision };
    },
  });
  const elapsed = performance.now() - started;

  assert.equal(seen.aborted, true, "the in-flight OpenAI request must be aborted, not left running");
  assert.equal(result.attempts?.[0]?.errorClass, "TIMEOUT");
  // Remaining budget (~30 ms) is below the minimum attempt budget, so Ollama is skipped, not started.
  assert.equal(ollamaTimeoutMs, undefined);
  assert.equal(result.attempts?.[1]?.callAttempted, false);
  assert.equal(result.providerStatus, "UNAVAILABLE");
  assert.ok(elapsed < 400, `chain must stop near its 150 ms budget, took ${elapsed.toFixed(0)} ms`);
});

test("B3 — fast OpenAI failure leaves Ollama the remaining budget, capped by the per-attempt timeout", async () => {
  process.env.AGENT_PROVIDER = "auto";
  process.env.OPENAI_API_KEY = FAKE_KEY;
  process.env.AGENT_PROVIDER_TIMEOUT_MS = "5000";
  process.env.AGENT_PLANNER_BUDGET_MS = "6000";

  let ollamaTimeoutMs = 0;
  const result = await callPlanner(input, {
    callOpenAI: async () => ({ provider: "OPENAI", providerStatus: "UNAVAILABLE", model: "m", callAttempted: true, errorClass: "AUTH_ERROR" }),
    callOllama: async (call) => {
      ollamaTimeoutMs = call.timeoutMs ?? 0;
      return { provider: "OLLAMA", providerStatus: "AVAILABLE", model: "qwen3.5:4b", callAttempted: true, decision: okDecision };
    },
  });

  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.fallbackCount, 1);
  assert.match(result.fallbackReason ?? "", /OpenAI cloud unavailable \(AUTH_ERROR\)/);
  assert.ok(ollamaTimeoutMs > 0 && ollamaTimeoutMs <= 5000);
});

// ---------------------------------------------------------------- B4 runtime truthfulness
test("B4 — execution label reflects what actually produced the decision", () => {
  assert.equal(describeExecution(null), null);
  assert.equal(describeExecution({ mode: "AGENT", provider: "OPENAI", fallbackActive: false, fallbackReason: null }), "AGENT · OPENAI");
  assert.equal(
    describeExecution({ mode: "AGENT", provider: "OLLAMA", fallbackActive: true, fallbackReason: "OpenAI cloud unavailable (TIMEOUT)" }),
    "AGENT · OLLAMA"
  );
  assert.equal(
    describeExecution({ mode: "DETERMINISTIC_FALLBACK", provider: "UNAVAILABLE", fallbackActive: true, fallbackReason: null }),
    "DETERMINISTIC_FALLBACK"
  );
});

test("B4 — /api/agent/plan reports DETERMINISTIC_FALLBACK (not AGENT) when every provider fails", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  globalThis.fetch = (async () => {
    throw new TypeError("ECONNREFUSED");
  }) as typeof fetch;

  const response = await invokeServer(JSON.stringify({ goal: "我想申請租屋補助" }));
  const metadata = response.json.metadata as Record<string, unknown>;
  assert.equal(response.statusCode, 200);
  assert.equal(metadata.llmCallSucceeded, false);
  assert.equal(metadata.executionMode, "DETERMINISTIC_FALLBACK");
  assert.equal(metadata.fallbackActive, true);
  assert.equal(response.json.providerStatus, "UNAVAILABLE");
});

test("B4 — planner timeout is logged as a timeout fallback, never as a rejected unsafe proposal", () => {
  const run = runAgenticGoldenCase(
    "模型逾時時檢查租屋補助",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    { provider: "UNAVAILABLE", providerStatus: "UNAVAILABLE", model: "N/A", callAttempted: true, error: "AGENT_PROVIDER_TIMEOUT", errorClass: "TIMEOUT" }
  );
  const actions = run.auditTrail.map((event) => event.action);
  assert.ok(actions.includes("AGENT_PLANNER_TIMEOUT_FALLBACK"));
  assert.ok(!actions.includes("AGENT_PROPOSAL_REJECTED"));
  assert.equal(run.trace[0]?.proposalRejected, false);
  assert.equal(run.trace[0]?.validationResult, "NOT_APPLICABLE", "a timeout must not read as a VALID proposal");
  assert.equal(run.trace[0]?.fallbackUsed, true);
});

// ---------------------------------------------------------------- B5 FAIL passport
const baseProfile: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",
  ownsHome: false,
  receivesOtherHousingAid: false,
  monthlyIncome: 30000,
  centralRentApproved: true,
  newTaipeiResidenceStudyWork: true,
};
const actualNewTaipei: AddressScenario = { type: "ACTUAL", address: "新北市永和區合成測試地址", city: "新北市", district: "永和區", monthlyRent: 13500 };
const whatIfTaipei: AddressScenario = { type: "WHAT_IF", address: "臺北市文山區合成測試地址", city: "臺北市", district: "文山區", monthlyRent: 15500 };

function completedTool<T>(run: ReturnType<typeof runAgenticGoldenCase>, toolName: string): T {
  const event = [...run.auditTrail].reverse().find(
    (entry) => entry.action === "AGENT_TOOL_COMPLETED" && (entry.output as { toolName?: string } | undefined)?.toolName === toolName
  );
  assert.ok(event, `${toolName} must have completed`);
  return (event.output as { result: T }).result;
}

test("B5 — ownsHome=true: central FAIL stops the path; no submission step, no estimate, dependent R6 not claimable", () => {
  const run = runAgenticGoldenCase(
    "我有自有住宅，查詢中央與地方租金補貼",
    { ...baseProfile, ownsHome: true },
    actualNewTaipei,
    whatIfTaipei,
    { provider: "UNAVAILABLE", providerStatus: "UNAVAILABLE", model: "N/A", error: "AGENT_PROVIDER_TIMEOUT", errorClass: "TIMEOUT" },
    { includePassport: true }
  );
  assert.equal(run.status, "COMPLETED");
  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport");
  const whatIfResult = completedTool<ScenarioResult>(run, "evaluate_what_if_scenario");
  const actualResult = completedTool<ScenarioResult>(run, "evaluate_actual_scenario");
  const programs = [...passport.actual.programs, ...passport.whatIf.programs];

  // Central FAIL in both scenarios, with no estimate and a stop-only guide.
  const central = programs.filter((program) => program.policyId === "CENTRAL_RENT_115");
  assert.equal(central.length, 2);
  for (const program of central) {
    assert.equal(program.status, "FAIL");
    assert.equal(program.estimatedMonthlyBenefitNtd, null);
    assert.ok(program.applicationGuide);
    assert.equal(program.applicationGuide.nextSteps.length, 1);
    assert.match(program.applicationGuide.nextSteps[0], /流程已停止/);
  }

  // Taipei R6 requires central approval → not claimable; rule-level status (benchmark input) unchanged.
  const taipei = passport.whatIf.programs.find((program) => program.policyId === "TAIPEI_RENT_115");
  assert.equal(taipei?.status, "FAIL");
  assert.ok(taipei?.failedConditions.some((condition) => condition.includes("須先取得中央租金補貼核定")));
  const taipeiPolicy = whatIfResult.policyResults.find((policy) => policy.policyId === "TAIPEI_RENT_115");
  assert.equal(taipeiPolicy?.eligibilityStatus, "FAIL");
  assert.equal(taipeiPolicy?.blockedByPolicyId, "CENTRAL_RENT_115");
  assert.notEqual(taipeiPolicy?.overallStatus, "FAIL", "rule-level status must not be rewritten");

  // Next steps: explain the stop first; never instruct submitting a failed scheme.
  assert.match(passport.nextSteps[0], /「.*」流程已停止/);
  const joined = passport.nextSteps.join("\n");
  assert.ok(!joined.includes("has.nlma.gov.tw"), "no central online submission step");
  assert.ok(!joined.includes("rent-allowance.udd.gov.taipei"), "no R6 submission step");
  assert.ok(!joined.includes("確認已取得中央 300 億元擴大租金補貼核定資格"), "no step to complete a dependent scheme");
  assert.ok(passport.risks.some((risk) => risk.includes("須先取得中央租金補貼核定")));

  // Rent-after-subsidy estimate: no failed scheme may feed it.
  const taipeiEstimate = estimateRentalSubsidyComparison(whatIfResult, "臺北市");
  assert.match(taipeiEstimate.outOfPocket, /不適用/);
  const newTaipeiEstimate = estimateRentalSubsidyComparison(actualResult, "臺北市");
  assert.ok(!newTaipeiEstimate.maxSubsidy.includes("中央 R1"), "failed central R1 must not be used");
  // R7 also excludes applicants whose household owns a home in 新北/臺北/桃園/基隆 (official 115
  // application form, 申請條件 3). Home location is unknown, so R7 is pending and not estimated.
  assert.ok(!newTaipeiEstimate.maxSubsidy.includes("新北青年 R7"), "pending R7 must not be estimated");
  assert.match(newTaipeiEstimate.outOfPocket, /不適用/);
});

test("B5 — a dependency FAIL shows the upstream reason, not a still-pending question (Gate C)", () => {
  const upstream = "此方案須先取得中央租金補貼核定；本情境中央租金補貼資格未通過，因此無法申請此方案。";
  const pending = [{ ruleId: "TAIPEI-115-CENTRAL-001", status: "UNCERTAIN" as const, reason: "缺少必要資料：centralRentApproved", sourceId: "R6" }];
  assert.equal(failGap("FAIL", pending, [upstream]), upstream);
  assert.equal(failGap("UNCERTAIN", pending, [upstream]), null, "non-FAIL keeps the normal gap");
  const ownFail = [{ ruleId: "CENTRAL-115-OWNS-001", status: "FAIL" as const, reason: "ownsHome 不符合規則", sourceId: "R1" }];
  assert.equal(failGap("FAIL", ownFail, ["ownsHome 不符合規則"]), null, "a program's own failed rule keeps the normal summary");
});

test("B5 — eligible applicant keeps submission steps and central estimate (no over-correction)", () => {
  const run = runAgenticGoldenCase(
    "比較目前住址與搬遷地址的租屋補助",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    undefined,
    { includePassport: true }
  );
  const passport = completedTool<DecisionPassport>(run, "generate_decision_passport");
  assert.ok(!passport.nextSteps.some((step) => step.includes("流程已停止")));
  assert.ok(passport.nextSteps.some((step) => step.includes("has.nlma.gov.tw")));
  const whatIfResult = completedTool<ScenarioResult>(run, "evaluate_what_if_scenario");
  assert.ok(estimateRentalSubsidyComparison(whatIfResult, "臺北市").maxSubsidy.includes("中央 R1"));
});

// ---------------------------------------------------------------- B6 unsupported domain
const OUTSIDE = /Requested policy\/domain is outside current verified coverage/;

for (const goal of ["花蓮縣老人假牙補助", "我想申請農民津貼", "桃園市敬老補助怎麼申請"]) {
  test(`B6 — "${goal}" is NOT_COVERED as another domain, never redirected to rental resources`, () => {
    const coverage = assessQueryCoverage(goal);
    assert.equal(coverage.status, "NOT_COVERED");
    assert.equal(coverage.domain, "OTHER");
    assert.match(coverage.message, OUTSIDE);
    assert.ok(!coverage.message.includes("租屋補助"), "must not be phrased as a rental-subsidy gap");
    assert.ok(!coverage.officialReferrals.some((ref) => ref.url?.includes("has.nlma.gov.tw")), "no central rental link");

    const run = runAgenticGoldenCase(goal, { age: 70 }, actualNewTaipei, whatIfTaipei);
    assert.equal(run.status, "NOT_COVERED");
    assert.ok(!run.auditTrail.some((event) => event.action === "AGENT_TOOL_REQUESTED"), "no rental tool may run");
  });
}

test("B6 — unsupported childcare and unsupported Taoyuan housing stay NOT_COVERED in their own domain", () => {
  const childcare = assessQueryCoverage("我想了解準公共托育補助如何申請");
  assert.equal(childcare.status, "NOT_COVERED");
  assert.equal(childcare.domain, "CHILDCARE");

  const taoyuanLocal = assessQueryCoverage("桃園市地方加碼租屋補助");
  assert.equal(taoyuanLocal.status, "NOT_COVERED");
  assert.equal(taoyuanLocal.domain, "RENTAL_SUBSIDY");
});

test("B6 — supported and generic requests are unchanged (no over-correction)", () => {
  assert.equal(assessQueryCoverage("我想申請租屋補助").status, "COVERED");
  assert.equal(assessQueryCoverage("檢查補助資格").status, "COVERED");
  assert.equal(assessQueryCoverage("我想申請育兒津貼").status, "COVERED");
  // Gate 2F: national central scheme stays in scope; the city's local scheme does not.
  const taichungRental = assessQueryCoverage("我想申請臺中市租屋補助");
  assert.equal(taichungRental.status, "COVERED");
  assert.equal(taichungRental.reason, "CENTRAL_ONLY_LOCAL_NOT_COVERED");
  assert.equal(taichungRental.domain, "RENTAL_SUBSIDY");
  assert.equal(assessQueryCoverage("我想申請臺中市地方租屋補助").status, "NOT_COVERED");
});

// ---------------------------------------------------------------- B7 API validation
test("B7 — POST /api/agent/plan without a goal is a client error, not an implicit demo goal", async () => {
  const missing = await invokeServer("{}");
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json.errorCode, "MISSING_GOAL");

  const wrongType = await invokeServer(JSON.stringify({ goal: 42 }));
  assert.equal(wrongType.statusCode, 400);
  assert.equal(wrongType.json.errorCode, "INVALID_GOAL_TYPE");
});
