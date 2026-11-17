import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { handleRequest, resetRateLimiter } from "../server";
import { assessQueryCoverage } from "../coverage";
import {
  createAgentRun,
  resumeAgentWithFieldResponse,
  runAgenticGoldenCase,
} from "./orchestrator";
import { buildJourney } from "../App";
import { exportAgentTrace } from "./trace";
import type { AddressScenario, ApplicantProfile } from "../types";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRateLimiter();
  delete process.env.AGENT_PROVIDER;
  delete process.env.AGENT_PROVIDER_TIMEOUT_MS;
});

function invokeServer(options: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): Promise<{ statusCode: number; headers: Record<string, string>; json: Record<string, unknown> }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = Readable.from(options.body !== undefined ? [Buffer.from(options.body, "utf8")] : []);
    const req = Object.assign(stream, {
      method: options.method,
      url: options.url,
      headers: options.headers ?? { "content-type": "application/json" },
      socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    }) as unknown as IncomingMessage;

    let statusCode = 200;
    let responseHeaders: Record<string, string> = {};
    const chunks: Buffer[] = [];

    const resState = { headersSent: false };
    const res = {
      get headersSent() {
        return resState.headersSent;
      },
      writeHead(code: number, headers?: Record<string, string>) {
        statusCode = code;
        resState.headersSent = true;
        if (headers) {
          responseHeaders = { ...headers };
        }
        return res;
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
        }
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: Record<string, unknown> = {};
        try {
          parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise({ statusCode, headers: responseHeaders, json: parsed });
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
      },
    } as unknown as ServerResponse;

    handleRequest(req, res).catch(rejectPromise);
  });
}

function mockProviderUnavailable(): void {
  globalThis.fetch = (async () => {
    throw new TypeError("Provider is offline (ECONNREFUSED)");
  }) as typeof fetch;
}

const dummyScenario: AddressScenario = {
  type: "ACTUAL",
  address: "新北市板橋區縣民大道二段7號",
  city: "新北市",
  district: "板橋區",
  monthlyRent: 15000,
};

const dummyWhatIf: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市大安區信義路三段",
  city: "臺北市",
  district: "大安區",
  monthlyRent: 18000,
};

// ===========================================================================
// STEP 5 — Validate Domain-Specific Fallback
// ===========================================================================

test("FALLBACK-HOUSING-01 — Housing goal proposes evaluate_central_rules when provider unavailable", async () => {
  mockProviderUnavailable();

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "我想申請租屋補助" }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.providerStatus, "UNAVAILABLE");
  const decision = response.json.decision as { toolName?: string; nextAction?: string };
  assert.equal(decision.nextAction, "CALL_TOOL");
  assert.equal(decision.toolName, "evaluate_central_rules");
});

test("FALLBACK-CHILD-01 — Childcare goal proposes evaluate_childcare_rules without intermediate housing tool proposal", async () => {
  mockProviderUnavailable();

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "我的小孩一歲，想申請育兒津貼" }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.providerStatus, "UNAVAILABLE");
  const decision = response.json.decision as { toolName?: string; nextAction?: string };
  assert.equal(decision.nextAction, "CALL_TOOL");
  assert.equal(decision.toolName, "evaluate_childcare_rules");
  assert.notEqual(decision.toolName, "evaluate_central_rules", "Must not propose housing tool for childcare");
});

test("FALLBACK-UNKNOWN-01 — Unsupported domain query stops safely with NOT_COVERED and no arbitrary tool", async () => {
  mockProviderUnavailable();

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "我想申請老人年金" }),
  });

  assert.equal(response.statusCode, 200);
  const decision = response.json.decision as { toolName?: string; nextAction?: string };
  assert.equal(decision.nextAction, "COMPLETE");
  assert.equal(decision.toolName, undefined, "Must not propose arbitrary tool for unsupported domain");
});

// ===========================================================================
// STEP 6 — NOT_COVERED Referral Tests
// ===========================================================================

test("REFERRAL-01 — Unsupported childcare query returns NOT_COVERED with official referrals", () => {
  const goal = "請問 1 歲幼兒的托育補助怎麼申請？";
  const coverage = assessQueryCoverage(goal);

  assert.equal(coverage.status, "NOT_COVERED");
  assert.equal(coverage.domain, "CHILDCARE");
  assert.ok(Array.isArray(coverage.officialReferrals) && coverage.officialReferrals.length > 0);
  for (const ref of coverage.officialReferrals) {
    assert.ok(ref.label && ref.label.length > 0, "Referral must have label");
    assert.ok(ref.url && ref.url.startsWith("https://"), "Referral URL must be secure official link");
    assert.ok(ref.agency && ref.agency.length > 0, "Referral must have agency name");
  }

  const run = runAgenticGoldenCase(goal, { age: 30 }, dummyScenario, dummyWhatIf);
  assert.equal(run.status, "NOT_COVERED");
  assert.ok(Array.isArray(run.coverage?.officialReferrals) && run.coverage!.officialReferrals.length > 0);
});

test("REFERRAL-02 — Uncovered-city housing query: national central scheme in scope, local scheme NOT_COVERED, NLMA referral kept", () => {
  // Gate 2F: R1 (300億元中央擴大租金補貼) is national, so only the city's local layer is out of scope.
  const goal = "我想申請臺中市租屋補助";
  const coverage = assessQueryCoverage(goal);

  assert.equal(coverage.status, "COVERED");
  assert.equal(coverage.reason, "CENTRAL_ONLY_LOCAL_NOT_COVERED");
  assert.equal(coverage.domain, "RENTAL_SUBSIDY");
  assert.match(coverage.message, /臺中市地方租屋補助或加碼尚未涵蓋/);
  const nlmaReferral = coverage.officialReferrals.find((r) => r.agency?.includes("國土管理署"));
  assert.ok(nlmaReferral, "Must refer to NLMA central rental subsidy online system");
  assert.ok(nlmaReferral.url?.includes("has.nlma.gov.tw"), "Must link to official NLMA portal");

  // Asking only about the city's own scheme is still entirely outside coverage.
  const localOnly = runAgenticGoldenCase("我想申請臺中市地方租屋補助", { age: 28 }, dummyScenario, dummyWhatIf);
  assert.equal(localOnly.status, "NOT_COVERED");
  assert.ok(localOnly.coverage?.officialReferrals.some((r) => r.agency?.includes("國土管理署")));
});

test("REFERRAL-03 — Supported childcare Under-2 Allowance routes normally and does NOT show NOT_COVERED", () => {
  const goal = "我的小孩一歲，想申請育兒津貼";
  const coverage = assessQueryCoverage(goal);

  assert.equal(coverage.status, "COVERED");
  assert.equal(coverage.domain, "CHILDCARE");

  const applicant: ApplicantProfile = {
    childAgeMonths: 12,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const run = runAgenticGoldenCase(goal, applicant, dummyScenario, dummyWhatIf, undefined, {
    includePassport: true,
  });

  assert.equal(run.status, "COMPLETED");
  assert.notEqual(run.status, "NOT_COVERED");
  assert.equal(run.state?.overallEligibilityStatus, "PASS");
});

// ===========================================================================
// STEP 7 — Journey Tests
// ===========================================================================

test("JOURNEY-HOUSING-01 — Completed housing run preserves existing 6-step journey with completed states", () => {
  const applicant: ApplicantProfile = {
    age: 26,
    maritalStatus: "single",
    ownsHome: false,
    receivesOtherHousingAid: false,
    monthlyIncome: 30000,
  };

  const run = runAgenticGoldenCase("我想申請租屋補助", applicant, dummyScenario, dummyWhatIf, undefined, {
    includePassport: true,
  });

  assert.equal(run.status, "COMPLETED");
  const steps = buildJourney(run, false);

  assert.equal(steps.length, 6, "Housing journey must have 6 steps");
  assert.deepEqual(steps.map((s) => s.key), ["understand", "plan", "central", "human", "compare", "passport"]);
  for (const step of steps) {
    assert.equal(step.state, "DONE", `Housing step ${step.key} must be DONE on completed run`);
  }
});

test("JOURNEY-CHILD-01 — Childcare completed run shows all 7 childcare steps completed correctly", () => {
  const applicant: ApplicantProfile = {
    childAgeMonths: 10,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const run = runAgenticGoldenCase("我想申請育兒津貼", applicant, dummyScenario, dummyWhatIf, undefined, {
    includePassport: true,
  });

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.state?.overallEligibilityStatus, "PASS");

  const steps = buildJourney(run, false);
  assert.equal(steps.length, 7, "Childcare journey must have 7 steps");
  assert.deepEqual(
    steps.map((s) => s.key),
    ["understand", "collect", "rules", "human", "amount", "passport", "navigation"]
  );

  for (const step of steps) {
    assert.equal(step.state, "DONE", `Childcare step ${step.key} must be DONE on completed run`);
  }
});

test("JOURNEY-CHILD-02 — Childcare waiting for Human Gate shows gate step in ACTIVE state", () => {
  const incompleteApplicant: ApplicantProfile = {
    childAgeMonths: 8,
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: null, // missing field
    birthOrder: 1,
  };

  const run = runAgenticGoldenCase("我想申請育兒津貼", incompleteApplicant, dummyScenario, dummyWhatIf);

  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.missingField, "receivesPublicOrQuasiPublicChildcare");

  const steps = buildJourney(run, false);
  assert.equal(steps.length, 7);

  const humanStep = steps.find((s) => s.key === "human");
  assert.ok(humanStep);
  assert.equal(humanStep.state, "ACTIVE", "Human Gate step must be ACTIVE while waiting for human input");

  const futureSteps = steps.filter((s) => ["amount", "passport", "navigation"].includes(s.key));
  for (const future of futureSteps) {
    assert.equal(future.state, "PENDING", `Future step ${future.key} must remain PENDING while gated`);
  }

  // After resuming with user input, the journey should complete to DONE
  const resumed = resumeAgentWithFieldResponse(run, "receivesPublicOrQuasiPublicChildcare", false, dummyScenario, dummyWhatIf);
  assert.equal(resumed.status, "COMPLETED");
  const resumedSteps = buildJourney(resumed, false);
  for (const step of resumedSteps) {
    assert.equal(step.state, "DONE", `Resumed step ${step.key} must be DONE`);
  }
});

test("JOURNEY-CHILD-03 — Childcare deterministic FAIL ends cleanly and does NOT show future steps as falsely completed", () => {
  const overAgeApplicant: ApplicantProfile = {
    childAgeMonths: 26, // over 24 months boundary -> deterministic FAIL
    childHasBirthOrInitialHouseholdRegistration: true,
    isGovernmentPlaced: false,
    receivesPublicOrQuasiPublicChildcare: false,
    birthOrder: 1,
  };

  const run = runAgenticGoldenCase("我想申請育兒津貼", overAgeApplicant, dummyScenario, dummyWhatIf, undefined, {
    includePassport: true,
  });

  assert.equal(run.state?.overallEligibilityStatus, "FAIL");

  const steps = buildJourney(run, false);
  assert.equal(steps.length, 7);

  // Understand and rules evaluation were executed
  assert.equal(steps.find((s) => s.key === "understand")?.state, "DONE");
  assert.equal(steps.find((s) => s.key === "rules")?.state, "DONE");

  // Future steps (amount calculation, navigation, etc.) must NEVER be falsely marked DONE
  const amountStep = steps.find((s) => s.key === "amount");
  const navigationStep = steps.find((s) => s.key === "navigation");
  assert.notEqual(amountStep?.state, "DONE", "Benefit amount must NOT be completed for ineligible applicant");
  assert.notEqual(navigationStep?.state, "DONE", "Navigation must NOT be completed for ineligible applicant");

  // The journey ends with a BLOCKED marker and subsequent steps remain PENDING
  const blockedStep = steps.find((s) => s.state === "BLOCKED");
  assert.ok(blockedStep, "At least one step must be marked BLOCKED on deterministic failure");
});

// ===========================================================================
// STEP 3 (Gate C) — Wave 4 Trace Evidence Generation & Sanitization
// ===========================================================================

test("TRACE-EVIDENCE — Generate and sanitize Wave 4 / Gate A/B traces (TRACE-G through TRACE-L)", async () => {
  // TRACE-G: Childcare supported case
  const runG = runAgenticGoldenCase(
    "我的小孩一歲，想申請育兒津貼",
    {
      childAgeMonths: 10,
      childHasBirthOrInitialHouseholdRegistration: true,
      isGovernmentPlaced: false,
      receivesPublicOrQuasiPublicChildcare: false,
      birthOrder: 1,
    },
    dummyScenario,
    dummyWhatIf,
    undefined,
    { includePassport: true }
  );
  runG.runId = "trace-g-childcare-supported";
  const pathG = await exportAgentTrace(runG);
  assert.ok(pathG.endsWith("trace-g-childcare-supported.json"));

  // TRACE-H: Taoyuan PARTIAL_CHECK / navigation case
  const runH = runAgenticGoldenCase(
    "我目前租屋在桃園市桃園區，想查詢可申請的租屋補助與申辦方式",
    {
      age: 26,
      maritalStatus: "single",
      childrenCount: 0,
      registeredCity: "桃園市",
      ownsHome: false,
      receivesOtherHousingAid: false,
      monthlyIncome: 38000,
    },
    {
      type: "ACTUAL",
      address: "桃園市桃園區縣府路1號",
      city: "桃園市",
      district: "桃園區",
      monthlyRent: 12000,
    },
    dummyWhatIf,
    undefined,
    { includePassport: true }
  );
  runH.runId = "trace-h-taoyuan-navigation";
  const pathH = await exportAgentTrace(runH);
  assert.ok(pathH.endsWith("trace-h-taoyuan-navigation.json"));

  // TRACE-I: Arbitrary custom housing case
  const runI = runAgenticGoldenCase(
    "我想申請臺北市租屋補助",
    {
      age: 28,
      maritalStatus: "single",
      ownsHome: false,
      receivesOtherHousingAid: false,
      monthlyIncome: 45000,
      registeredCity: "臺北市",
    },
    {
      type: "ACTUAL",
      address: "臺北市信義區信義路五段",
      city: "臺北市",
      district: "信義區",
      monthlyRent: 20000,
    },
    dummyWhatIf,
    undefined,
    { includePassport: true }
  );
  runI.runId = "trace-i-custom-housing";
  const pathI = await exportAgentTrace(runI);
  assert.ok(pathI.endsWith("trace-i-custom-housing.json"));

  // TRACE-J: Arbitrary childcare case
  const runJ = runAgenticGoldenCase(
    "申請二胎育兒津貼",
    {
      childAgeMonths: 18,
      childHasBirthOrInitialHouseholdRegistration: true,
      isGovernmentPlaced: false,
      receivesPublicOrQuasiPublicChildcare: false,
      birthOrder: 2,
      childRegisteredCity: "新北市",
    },
    dummyScenario,
    dummyWhatIf,
    undefined,
    { includePassport: true }
  );
  runJ.runId = "trace-j-custom-childcare";
  const pathJ = await exportAgentTrace(runJ);
  assert.ok(pathJ.endsWith("trace-j-custom-childcare.json"));

  // TRACE-K: NOT_COVERED with official referral
  const runK = runAgenticGoldenCase(
    "請問 1 歲幼兒的托育補助怎麼申請？",
    { age: 30 },
    dummyScenario,
    dummyWhatIf
  );
  runK.runId = "trace-k-not-covered-referral";
  const pathK = await exportAgentTrace(runK);
  assert.ok(pathK.endsWith("trace-k-not-covered-referral.json"));

  // TRACE-L: Provider-unavailable childcare fallback
  const runL = runAgenticGoldenCase(
    "我的小孩一歲，想申請育兒津貼",
    {
      childAgeMonths: 12,
      childHasBirthOrInitialHouseholdRegistration: true,
      isGovernmentPlaced: false,
      receivesPublicOrQuasiPublicChildcare: false,
      birthOrder: 1,
    },
    dummyScenario,
    dummyWhatIf,
    {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: "offline-fallback",
      error: "AGENT_PROVIDER_UNAVAILABLE",
      decision: {
        reasoningSummary: "Live provider unavailable; fallback to deterministic childcare plan.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_childcare_rules",
      },
    },
    { includePassport: true }
  );
  runL.runId = "trace-l-provider-offline-childcare";
  const pathL = await exportAgentTrace(runL);
  assert.ok(pathL.endsWith("trace-l-provider-offline-childcare.json"));

  // Verify all new traces are completely sanitized
  const tracePaths = [pathG, pathH, pathI, pathJ, pathK, pathL];
  for (const tPath of tracePaths) {
    const raw = await readFile(tPath, "utf8");
    assert.ok(!raw.includes("sk-"), `${tPath} must not contain API key pattern`);
    assert.ok(!raw.includes("Bearer "), `${tPath} must not contain Bearer tokens`);
    assert.ok(!raw.includes("systemPrompt"), `${tPath} must not contain systemPrompt`);
    assert.ok(!raw.includes("chainOfThought"), `${tPath} must not contain raw CoT`);
  }
});
