import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import { callPlanner } from "./client";
import {
  MISSING_FIELD_QUESTIONS,
  detectMissingFields,
  getQuestionForMissingField,
  validateMissingFieldInput,
} from "./missing-fields";
import {
  resumeAgentWithFieldResponse,
  runAgenticGoldenCase,
  runBoundedAgentLoop,
  validatePlannerProposal,
} from "./orchestrator";
import { exportAgentTrace, sanitizeForTrace, serializeAgentTrace } from "./trace";
import {
  MAX_GOAL_LENGTH,
  MAX_REQUEST_BODY_BYTES,
  handleRequest,
  resetRateLimiter,
  server,
  setRateLimitMaxRequests,
} from "../server";
import healthApiHandler from "../vercel-health";
import plannerApiHandler from "../vercel-agent-plan";
import vercelApiHandler from "../vercel-handler";
import type { AddressScenario, ApplicantProfile } from "../types";

const bundledVercelApiHandler = (
  createRequire(__filename)("../../api/[...path].js") as {
    default: typeof vercelApiHandler;
  }
).default;

const baseProfile: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",
  ownsHome: false,
  receivesOtherHousingAid: false,
  monthlyIncome: null,
  centralRentApproved: true,
  newTaipeiResidenceStudyWork: true,
};

const actualNewTaipei: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfTaipei: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

const taoyuanScenario: AddressScenario = {
  type: "ACTUAL",
  address: "桃園市桃園區合成測試地址",
  city: "桃園市",
  district: "桃園區",
  monthlyRent: 12000,
};

const originalFetch = globalThis.fetch;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiModel = process.env.OPENAI_MODEL;
const originalOllamaModel = process.env.OLLAMA_MODEL;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRateLimiter();
  delete process.env.AGENT_PROVIDER;
  delete process.env.AGENT_PROVIDER_TIMEOUT_MS;
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  if (originalOpenAiModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = originalOpenAiModel;
  }
  if (originalOllamaModel === undefined) {
    delete process.env.OLLAMA_MODEL;
  } else {
    process.env.OLLAMA_MODEL = originalOllamaModel;
  }
});

function invokeServer(options: {
  method: string;
  url: string;
  body?: string;
  parsedBody?: unknown;
  serverless?: boolean;
  bundled?: boolean;
  plannerEndpoint?: boolean;
  healthEndpoint?: boolean;
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
      ...(options.parsedBody !== undefined ? { body: options.parsedBody } : {}),
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
        } catch {
          parsed = { raw: text };
        }
        resolvePromise({ statusCode, headers: responseHeaders, json: parsed });
      },
      destroy(err?: Error) {
        if (err) rejectPromise(err);
      },
    } as unknown as ServerResponse;

    const handler = options.healthEndpoint
      ? healthApiHandler
      : options.plannerEndpoint
        ? plannerApiHandler
        : options.bundled
          ? bundledVercelApiHandler
          : options.serverless
            ? vercelApiHandler
            : handleRequest;
    handler(req, res).catch(rejectPromise);
  });
}

// ---------------------------------------------------------------------------
// STEP 11 — Required Trace Cases (TRACE-A .. TRACE-F) + Trace Export
// ---------------------------------------------------------------------------

test("TRACE-A — Valid planner proposal routes to allowed tool and executes without fallback", async () => {
  const run = runAgenticGoldenCase(
    "比較目前住址與搬遷地址的租屋補助",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model: "qwen3.5:4b",
      callAttempted: true,
      decision: {
        reasoningSummary: "Start by evaluating actual residence scenario first.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_actual_scenario",
      },
    }
  );
  run.runId = "trace-a-valid-proposal";

  assert.equal(run.status, "COMPLETED");
  const firstStep = run.trace[0];
  assert.ok(firstStep, "trace must contain step 1");
  assert.equal(firstStep.plannerProposal?.toolName, "evaluate_actual_scenario");
  assert.equal(firstStep.validationResult, "VALID");
  assert.equal(firstStep.proposalRejected, false);
  assert.equal(firstStep.fallbackUsed, false);
  assert.equal(firstStep.selectedTool, "evaluate_actual_scenario");
  assert.equal(firstStep.eligibilityStatus, "PARTIAL_CHECK");

  const tracePath = await exportAgentTrace(run);
  const saved = JSON.parse(await readFile(tracePath, "utf8")) as { runId: string; events: unknown[] };
  assert.equal(saved.runId, "trace-a-valid-proposal");
  assert.ok(saved.events.length >= 1);
});

test("TRACE-B — Dynamic missing field requests user, validates input, updates state, and resumes", async () => {
  for (const field of [
    "city",
    "ownsHome",
    "monthlyIncome",
    "age",
    "centralRentApproved",
    "newTaipeiResidenceStudyWork",
  ] as const) {
    assert.ok(getQuestionForMissingField(field).length > 5, `question must exist for ${field}`);
  }
  assert.notEqual(getQuestionForMissingField("city"), getQuestionForMissingField("ownsHome"));
  assert.notEqual(getQuestionForMissingField("monthlyIncome"), getQuestionForMissingField("ownsHome"));

  const profileMissingIncome: ApplicantProfile = {
    ...baseProfile,
    monthlyIncome: null,
  };
  const waitingRun = runAgenticGoldenCase(
    "我想查詢租屋補助，但尚未填寫月所得",
    profileMissingIncome,
    actualNewTaipei,
    whatIfTaipei,
    undefined,
    { requiredFields: ["ownsHome", "receivesOtherHousingAid", "monthlyIncome"] }
  );
  waitingRun.runId = "trace-b-missing-field-resume";

  assert.equal(waitingRun.status, "WAITING_FOR_HUMAN");
  assert.equal(waitingRun.missingField, "monthlyIncome");
  assert.equal(waitingRun.humanInputRequired, MISSING_FIELD_QUESTIONS.monthlyIncome);

  // Invalid input is rejected safely and stays at WAITING_FOR_HUMAN
  const invalidAttempt = resumeAgentWithFieldResponse(waitingRun, "monthlyIncome", "not-a-number");
  assert.equal(invalidAttempt.status, "WAITING_FOR_HUMAN");
  assert.equal(invalidAttempt.errorCode, "INVALID_MONTHLY_INCOME");

  // Valid input updates structured state and completes workflow
  const resumed = resumeAgentWithFieldResponse(waitingRun, "monthlyIncome", 28000);
  resumed.runId = "trace-b-missing-field-resume";
  assert.equal(resumed.status, "COMPLETED");
  assert.equal(resumed.state?.applicant.monthlyIncome, 28000);

  const resumeGateEvent = resumed.trace.find(
    (event) => event.humanGate?.validatedUpdate?.field === "monthlyIncome" && event.humanGate.validatedUpdate.valid
  );
  assert.ok(resumeGateEvent, "trace must record human gate state transition");
  assert.equal(resumeGateEvent.humanGate?.beforeState?.monthlyIncomeProvided, false);
  assert.equal(resumeGateEvent.humanGate?.question, MISSING_FIELD_QUESTIONS.monthlyIncome);
  assert.equal(resumeGateEvent.humanGate?.userResponse, 28000);
  assert.equal(resumeGateEvent.humanGate?.validatedUpdate?.value, 28000);
  assert.equal(resumeGateEvent.humanGate?.afterState?.monthlyIncomeProvided, true);
  assert.ok(resumeGateEvent.humanGate?.nextPlannerAction);

  await exportAgentTrace(resumed);
});

test("TRACE-C — Planner proposes invalid/unknown tool or premature COMPLETE -> rejected -> safe fallback", async () => {
  const run = runAgenticGoldenCase(
    "檢查補助資格",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    undefined,
    {
      plannerProposals: [
        {
          reasoningSummary: "Attempt to run an arbitrary shell tool.",
          nextAction: "CALL_TOOL",
          toolName: "execute_shell_command",
        },
        {
          reasoningSummary: "Attempt to complete before scenario evaluation.",
          nextAction: "COMPLETE",
        },
      ],
    }
  );
  run.runId = "trace-c-rejected-proposal";

  assert.equal(run.status, "COMPLETED");
  assert.equal(
    run.auditTrail.some(
      (event) =>
        event.action === "AGENT_TOOL_COMPLETED" &&
        (event.input as { toolName?: string } | undefined)?.toolName === "execute_shell_command"
    ),
    false,
    "unknown tool must never execute"
  );

  const step1 = run.trace[0];
  assert.equal(step1.proposalRejected, true);
  assert.match(String(step1.rejectionReason), /TOOL_NOT_IN_ALLOWLIST/);
  assert.equal(step1.fallbackUsed, true);
  assert.equal(step1.selectedTool, "evaluate_central_rules");

  await exportAgentTrace(run);
});

test("TRACE-D — NOT_COVERED (Childcare & Taoyuan) never produces PASS", async () => {
  const childcareRun = runAgenticGoldenCase(
    "請問 1 歲幼兒的育兒津貼與托育補助怎麼申請？",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model: "qwen3.5:4b",
      callAttempted: true,
      decision: {
        reasoningSummary: "Try calling central rental rules on childcare query.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_central_rules",
      },
    }
  );
  childcareRun.runId = "trace-d-not-covered";

  // Gate 4B: allowance + 托育補助 decomposes — the 托育補助 part is NOT_COVERED, the allowance
  // part stays in its own workflow, and the rental tool proposal is rejected. Never PASS.
  assert.equal(childcareRun.domain, "CHILDCARE");
  assert.notEqual(childcareRun.state?.overallEligibilityStatus, "PASS");
  assert.equal(childcareRun.trace[0]?.proposalRejected, true);
  assert.match(childcareRun.trace[0]?.rejectionReason ?? "", /DOMAIN_MISMATCH/);
  const subsidyComponent = childcareRun.coverage?.components?.find((component) => component.key === "CHILDCARE_SUBSIDY");
  assert.equal(subsidyComponent?.status, "NOT_COVERED");
  assert.match(subsidyComponent?.referral?.url ?? "", /^https:\/\/www\.sfaa\.gov\.tw\//, "subsidy referral stays visible");
  assert.equal(
    childcareRun.coverage?.components?.find((component) => component.key === "CHILDCARE_ALLOWANCE_UNDER_2")?.status,
    "COVERED",
    "supported allowance part remains independently evaluable"
  );
  assert.ok(
    !childcareRun.auditTrail.some(
      (event) => event.action === "AGENT_TOOL_REQUESTED" && (event.input as { toolName?: string })?.toolName === "evaluate_central_rules"
    ),
    "no rental tool may run on a childcare request"
  );

  const taoyuanRun = runAgenticGoldenCase(
    "我住在桃園市桃園區，想確認地方租屋補助",
    baseProfile,
    taoyuanScenario,
    whatIfTaipei
  );
  assert.equal(taoyuanRun.state?.actualStatus, "NOT_COVERED");
  assert.equal(taoyuanRun.state?.overallEligibilityStatus, "NOT_COVERED");
  assert.notEqual(taoyuanRun.state?.overallEligibilityStatus, "PASS");

  const supportedTaoyuanRun = runAgenticGoldenCase(
    "我住在桃園市桃園區，想確認租屋補助",
    baseProfile,
    taoyuanScenario,
    whatIfTaipei
  );
  assert.equal(supportedTaoyuanRun.state?.actualStatus, "PARTIAL_CHECK");
  assert.notEqual(supportedTaoyuanRun.state?.overallEligibilityStatus, "PASS");

  await exportAgentTrace(childcareRun);
});

test("TRACE-E — Explicit deterministic FAIL cannot be overridden by planner", async () => {
  const failApplicant: ApplicantProfile = {
    ...baseProfile,
    ownsHome: true,
  };

  const run = runAgenticGoldenCase(
    "我有自有住宅，請幫我檢查租屋補助資格",
    failApplicant,
    actualNewTaipei,
    whatIfTaipei,
    undefined,
    {
      includePassport: true,
      plannerProposals: [
        {
          reasoningSummary: "Try to override ownsHome to false and force PASS.",
          nextAction: "CALL_TOOL",
          toolName: "evaluate_central_rules",
          toolArguments: {
            profile: { ownsHome: false },
            overrideStatus: "PASS",
          },
        },
      ],
    }
  );
  run.runId = "trace-e-deterministic-fail";

  assert.equal(run.trace[0]?.proposalRejected, true);
  assert.match(String(run.trace[0]?.rejectionReason), /UNSAFE_OVERRIDE/);
  assert.equal(run.toolResult?.status, "FAIL");
  assert.equal(run.state?.centralStatus, "FAIL");
  assert.equal(run.state?.actualStatus, "FAIL");
  assert.equal(run.state?.overallEligibilityStatus, "FAIL");

  await exportAgentTrace(run);
});

test("TRACE-F — Provider unavailable triggers safe deterministic fallback and never claims PASS", async () => {
  const run = runAgenticGoldenCase(
    "模型離線時檢查租屋補助",
    baseProfile,
    actualNewTaipei,
    whatIfTaipei,
    {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model: "qwen3.5:4b",
      callAttempted: true,
      error: "OLLAMA_PROVIDER_UNAVAILABLE",
    }
  );
  run.runId = "trace-f-provider-unavailable";

  assert.equal(run.status, "COMPLETED");
  // No proposal existed, so nothing was rejected: the outage is a fallback, not a rejection.
  assert.equal(run.trace[0]?.proposalRejected, false);
  assert.equal(run.trace[0]?.validationResult, "NOT_APPLICABLE", "no proposal existed, so none was validated");
  assert.equal(run.trace[0]?.rejectionReason, "OLLAMA_PROVIDER_UNAVAILABLE");
  assert.equal(run.trace[0]?.fallbackUsed, true);
  const actions = run.auditTrail.map((event) => event.action);
  assert.ok(actions.includes("AGENT_PLANNER_UNAVAILABLE_FALLBACK"));
  assert.ok(!actions.includes("AGENT_PROPOSAL_REJECTED"), "an outage must not be logged as a rejected proposal");
  assert.notEqual(run.state?.overallEligibilityStatus, "PASS");
  assert.equal(run.state?.overallEligibilityStatus, "PARTIAL_CHECK");

  await exportAgentTrace(run);
});

// ---------------------------------------------------------------------------
// STEP 13 — Security Invariants & API Hardening
// ---------------------------------------------------------------------------

test("Security Invariant — duplicate tool call without state change is rejected and maxSteps stops loop", () => {
  const state = {
    applicant: baseProfile,
    actualScenario: actualNewTaipei,
    whatIfScenario: whatIfTaipei,
    requiredFields: ["ownsHome", "receivesOtherHousingAid"] as ("ownsHome" | "receivesOtherHousingAid")[],
    completedTools: ["evaluate_central_rules"] as ("evaluate_central_rules")[],
    executedAtSignature: new Set<string>([
      `${JSON.stringify({
        applicant: baseProfile,
        actualCity: actualNewTaipei.city,
        actualRent: actualNewTaipei.monthlyRent,
        whatIfCity: whatIfTaipei.city,
        whatIfRent: whatIfTaipei.monthlyRent,
      })}:evaluate_central_rules`,
    ]),
  };

  const duplicateValidation = validatePlannerProposal(
    {
      reasoningSummary: "Repeat evaluate_central_rules with identical state",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
    },
    state
  );
  assert.equal(duplicateValidation.valid, false);
  assert.equal(duplicateValidation.proposalRejected, true);
  assert.match(String(duplicateValidation.rejectionReason), /DUPLICATE_TOOL_CALL_WITHOUT_STATE_CHANGE/);

  const bounded = runBoundedAgentLoop("Loop test", baseProfile, actualNewTaipei, whatIfTaipei, {
    maxSteps: 6,
    forceLoop: true,
  });
  assert.equal(bounded.status, "FAILED");
  assert.equal(bounded.errorCode, "MAX_AGENT_STEPS_EXCEEDED");
  assert.equal(bounded.stepsTaken, 6);
});

test("Security Invariant — trace sanitizer strips secrets, tokens, prompts, and PII", () => {
  const dirty = {
    apiKey: "sk-1234567890abcdef123456",
    authorization: "Bearer secret-jwt-token",
    chainOfThought: "private reasoning",
    systemPrompt: "hidden instructions",
    nationalId: "A123456789",
    phone: "0912345678",
    note: "Header Bearer abc.def.ghi and key sk-abcdef1234567890",
  };
  const clean = sanitizeForTrace(dirty) as Record<string, unknown>;
  assert.equal("apiKey" in clean, false);
  assert.equal("authorization" in clean, false);
  assert.equal("chainOfThought" in clean, false);
  assert.equal("systemPrompt" in clean, false);
  assert.equal("nationalId" in clean, false);
  assert.equal("phone" in clean, false);
  assert.equal(String(clean.note).includes("sk-abcdef"), false);
  assert.equal(String(clean.note).includes("Bearer abc"), false);
});

test("API Hardening — rate limit returns HTTP 429 with structured error", async () => {
  resetRateLimiter();
  setRateLimitMaxRequests(2);

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ models: [] }), { status: 500 })) as typeof fetch;

  const r1 = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "Check rent subsidy" }),
    remoteAddress: "10.0.0.99",
  });
  assert.equal(r1.statusCode, 200);

  const r2 = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "Check rent subsidy" }),
    remoteAddress: "10.0.0.99",
  });
  assert.equal(r2.statusCode, 200);

  const r3 = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "Check rent subsidy" }),
    remoteAddress: "10.0.0.99",
  });
  assert.equal(r3.statusCode, 429);
  assert.equal(r3.json.ok, false);
  assert.equal(r3.json.errorCode, "RATE_LIMIT_EXCEEDED");
  assert.ok(r3.headers["Retry-After"]);
});

test("API server — importing the backend does not start the local listener", () => {
  assert.equal(server.listening, false);
});

test("Vercel API — OpenAI health uses server environment configuration", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-for-commit";
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

  const response = await invokeServer({
    method: "GET",
    url: "/api/health",
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OPENAI");
  assert.equal(response.json.providerStatus, "AVAILABLE");
  assert.equal(response.json.available, true);
  assert.equal(response.json.mode, "cloud");
  assert.equal(response.json.providerMode, "openai");
  assert.equal(JSON.stringify(response.json).includes("test-key-not-for-commit"), false);
});

test("Vercel API — Ollama health returns local runtime information", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 })) as typeof fetch;

  const response = await invokeServer({
    method: "GET",
    url: "/api/health",
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OLLAMA");
  assert.equal(response.json.model, "qwen3.5:4b");
  assert.equal(response.json.providerStatus, "AVAILABLE");
  assert.equal(response.json.available, true);
  assert.equal(response.json.mode, "local");
  assert.equal(response.json.providerMode, "ollama");
});

test("Vercel API — auto mode identifies local failover as fallback", async () => {
  process.env.AGENT_PROVIDER = "auto";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 })) as typeof fetch;

  const response = await invokeServer({
    method: "GET",
    url: "/api/health",
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OLLAMA");
  assert.equal(response.json.available, true);
  assert.equal(response.json.mode, "fallback");
  assert.equal(response.json.providerMode, "auto");
  assert.equal(response.json.fallbackActive, true);
});

test("Vercel API — unavailable Ollama health retains provider and model metadata", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  globalThis.fetch = (async () => new Response("offline", { status: 503 })) as typeof fetch;

  const response = await invokeServer({
    method: "GET",
    url: "/api/health",
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OLLAMA");
  assert.equal(response.json.model, "qwen3.5:4b");
  assert.equal(response.json.available, false);
  assert.equal(response.json.mode, "fallback");
});

test("Vercel API — planning response reports OpenAI cloud runtime information", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-for-commit";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            reasoningSummary: "Use the deterministic housing rules.",
            nextAction: "CALL_TOOL",
            toolName: "evaluate_central_rules",
            humanQuestion: null,
          }),
        }],
      }],
      usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 },
    }), { status: 200 })) as typeof fetch;

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    parsedBody: { goal: "Check rent subsidy" },
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OPENAI");
  assert.equal(response.json.available, true);
  assert.equal(response.json.mode, "cloud");
  assert.equal(typeof response.json.model, "string");
});

test("Vercel API — health route accepts a stripped path and reports configured OpenAI as cloud", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-for-commit";
  delete process.env.OPENAI_MODEL;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Health must not make an OpenAI network request");
  }) as typeof fetch;

  const response = await invokeServer({
    method: "GET",
    url: "/health",
    healthEndpoint: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.available, true);
  assert.equal(response.json.provider, "OPENAI");
  assert.equal(response.json.model, "gpt-4o-mini");
  assert.equal(response.json.mode, "cloud");
  assert.equal(response.json.lastError, null);
  assert.equal(fetchCalls, 0);
});

test("Vercel API — dedicated planner route normalizes stripped function paths", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-for-commit";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            reasoningSummary: "Use the deterministic housing rules.",
            nextAction: "CALL_TOOL",
            toolName: "evaluate_central_rules",
            humanQuestion: null,
          }),
        }],
      }],
    }), { status: 200 });
  }) as typeof fetch;

  const response = await invokeServer({
    method: "POST",
    url: "/agent/plan",
    parsedBody: { goal: "Check rent subsidy" },
    plannerEndpoint: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OPENAI");
  assert.equal(response.json.model, "gpt-4o-mini");
  assert.equal(response.json.available, true, JSON.stringify(response.json));
  assert.equal(fetchCalls, 1);
});

test("Vercel API — planning response exposes a safe OpenAI model failure reason", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-for-commit";
  process.env.OPENAI_MODEL = "missing-model";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: { message: `Invalid model request with key ${process.env.OPENAI_API_KEY}` },
    }), { status: 400 });
  }) as typeof fetch;

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    parsedBody: { goal: "Check rent subsidy" },
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 2, "configured model and gpt-4o-mini fallback were each attempted once");
  assert.equal(response.json.providerStatus, "UNAVAILABLE");
  const metadata = response.json.metadata as Record<string, unknown>;
  assert.equal(metadata.lastLlmFailureReason, "OPENAI · BAD_REQUEST");
  assert.equal(JSON.stringify(response.json).includes(process.env.OPENAI_API_KEY), false);
  assert.equal(JSON.stringify(response.json).includes("Invalid model request"), false);
});

test("Vercel API — planning response reports Ollama local runtime information", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            reasoningSummary: "Use the deterministic housing rules.",
            nextAction: "CALL_TOOL",
            toolName: "evaluate_central_rules",
          }),
        },
        prompt_eval_count: 11,
        eval_count: 5,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
  }) as typeof fetch;

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    parsedBody: { goal: "Check rent subsidy" },
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OLLAMA");
  assert.equal(response.json.model, "qwen3.5:4b");
  assert.equal(response.json.available, true);
  assert.equal(response.json.mode, "local");
});

test("Vercel API — backend initialization failures return a JSON 500", () => {
  const script = `
    process.loadEnvFile = () => { throw new Error("simulated initialization failure"); };
    const handler = require("./api/[...path].js").default;
    const response = {
      headersSent: false,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
        this.headersSent = true;
      },
      end(body) {
        console.log(JSON.stringify({ statusCode: this.statusCode, body: JSON.parse(body) }));
      },
      destroy() {}
    };
    handler({ method: "GET", url: "/api/health", headers: {} }, response)
      .catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim()) as {
    statusCode: number;
    body: { ok: boolean; errorCode: string };
  };
  assert.equal(output.statusCode, 500);
  assert.equal(output.body.ok, false);
  assert.equal(output.body.errorCode, "BACKEND_INITIALIZATION_FAILED");
});

test("Vercel API — pre-parsed JSON request bodies reach the shared backend", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ models: [] }), { status: 500 })) as typeof fetch;

  const response = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    parsedBody: { goal: "Check rent subsidy" },
    bundled: true,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "OLLAMA");
  assert.equal(response.json.model, "qwen3.5:4b");
  assert.equal(response.json.available, false);
  assert.equal(response.json.mode, "fallback");
  assert.equal((response.json.metadata as Record<string, unknown>).mode, "ollama");
});

test("API Hardening — oversized payload (> 16 KB), oversized goal (> 800 chars), and malformed JSON are rejected", async () => {
  const hugePayload = JSON.stringify({
    goal: " Check ",
    padding: "x".repeat(MAX_REQUEST_BODY_BYTES + 512),
  });
  const payloadRes = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: hugePayload,
  });
  assert.equal(payloadRes.statusCode, 413);
  assert.equal(payloadRes.json.errorCode, "PAYLOAD_TOO_LARGE");

  const longGoal = "租".repeat(MAX_GOAL_LENGTH + 10);
  const goalRes = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: longGoal }),
  });
  assert.equal(goalRes.statusCode, 400);
  assert.equal(goalRes.json.errorCode, "GOAL_TOO_LONG");

  const badJsonRes = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: "{ invalid json",
  });
  assert.equal(badJsonRes.statusCode, 400);
  assert.equal(badJsonRes.json.errorCode, "INVALID_JSON_BODY");
});

test("API Hardening — provider timeout returns controlled AGENT_PROVIDER_TIMEOUT fallback", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  globalThis.fetch = (async () =>
    new Promise<Response>(() => {
      // Simulate hung provider that never resolves
    })) as typeof fetch;

  const result = await callPlanner({
    goal: "Check rental subsidy",
    availableTools: ["evaluate_central_rules"],
    timeoutMs: 40,
  });
  assert.equal(result.providerStatus, "UNAVAILABLE");
  assert.equal(result.error, "AGENT_PROVIDER_TIMEOUT");
  assert.equal(result.decision, undefined);

  process.env.AGENT_PROVIDER_TIMEOUT_MS = "40";
  const apiRes = await invokeServer({
    method: "POST",
    url: "/api/agent/plan",
    body: JSON.stringify({ goal: "Check rental subsidy" }),
  });
  assert.equal(apiRes.statusCode, 200);
  assert.equal(apiRes.json.providerStatus, "UNAVAILABLE");
  assert.equal((apiRes.json.metadata as { error?: string }).error, "AGENT_PROVIDER_TIMEOUT");
});
