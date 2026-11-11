import assert from "node:assert/strict";
import test from "node:test";

import { callPlanner, getProviderHealth } from "./client";
import { resumeAgentRun, runAgenticGoldenCase } from "./orchestrator";
import { callTool } from "./tools";
import { estimateOpenAICostUsd } from "./providers/pricing";
import { createRuntimeMetrics, recordProviderRun } from "../metrics";

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
const actualScenario = { type: "ACTUAL" as const, address: "新北市永和區", city: "新北市", district: "永和區", monthlyRent: 13500 };
const whatIfScenario = { type: "WHAT_IF" as const, address: "臺北市文山區", city: "臺北市", district: "文山區", monthlyRent: 15500 };
const GOLDEN_GOAL =
  "我目前住在新北市永和區，每月租金 13,500 元。如果搬到臺北市文山區、租金 15,500 元，我有哪些租屋補助可以考慮？還缺什麼資料？";
const FAKE_KEY = "sk-test-DO-NOT-LEAK-0123456789";

const originalFetch = globalThis.fetch;
type Calls = { openai: number; ollamaChat: number; bodies: Record<string, unknown>[] };

function decision(overrides: Record<string, unknown> = {}) {
  return {
    reasoningSummary: "Route to deterministic central rules.",
    nextAction: "CALL_TOOL",
    toolName: "evaluate_central_rules",
    humanQuestion: null,
    ...overrides,
  };
}

function openaiOk(body: Record<string, unknown> = decision(), usage = { input_tokens: 321, output_tokens: 45, total_tokens: 366 }) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(body) }] },
    ],
    usage,
  }), { status: 200 });
}

function ollamaOk() {
  return new Response(JSON.stringify({
    message: { content: JSON.stringify({ reasoningSummary: "Local plan.", nextAction: "CALL_TOOL", toolName: "evaluate_central_rules" }) },
    prompt_eval_count: 40,
    eval_count: 20,
  }), { status: 200 });
}

/** Routes fetch by URL. `openai` returns a Response or throws; Ollama is up unless `ollamaDown`. */
function installFetch(options: {
  openai?: (init?: RequestInit) => Promise<Response>;
  ollamaDown?: boolean;
  openaiHealthDown?: boolean;
}): Calls {
  const calls: Calls = { openai: 0, ollamaChat: 0, bodies: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.openai.com/v1/responses")) {
      calls.openai += 1;
      calls.bodies.push(JSON.parse(String(init?.body)));
      if (!options.openai) throw new Error("unexpected OpenAI call");
      return options.openai(init);
    }
    if (url.startsWith("https://api.openai.com/v1/models/")) {
      if (options.openaiHealthDown) throw new TypeError("getaddrinfo ENOTFOUND api.openai.com");
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/api/tags")) {
      if (options.ollamaDown) throw new TypeError("fetch failed: ECONNREFUSED");
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    if (url.includes("/api/chat")) {
      calls.ollamaChat += 1;
      return ollamaOk();
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

function actions(result: { providerEvents?: Array<{ action: string }> }) {
  return (result.providerEvents ?? []).map((event) => event.action);
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ["AGENT_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_TIMEOUT_MS", "OLLAMA_MODEL", "OLLAMA_BASE_URL"]) {
    delete process.env[key];
  }
});

function auto(withKey = true) {
  process.env.AGENT_PROVIDER = "auto";
  if (withKey) process.env.OPENAI_API_KEY = FAKE_KEY;
}

test("P1 — auto + valid OpenAI selects OpenAI with strict Responses API structured output", async () => {
  auto();
  const calls = installFetch({ openai: async () => openaiOk() });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.provider, "OPENAI");
  assert.equal(result.providerStatus, "AVAILABLE");
  assert.equal(result.model, "gpt-5.4-mini");
  assert.equal(result.decision?.toolName, "evaluate_central_rules");
  assert.equal(result.decision?.humanQuestion, undefined, "null normalised to undefined");
  assert.equal(result.fallbackCount, 0);
  assert.equal(calls.ollamaChat, 0);
  assert.deepEqual(actions(result), ["AGENT_PROVIDER_SELECTED", "AGENT_PROVIDER_CALL_STARTED", "AGENT_PROVIDER_CALL_COMPLETED"]);

  const body = calls.bodies[0] as Record<string, any>;
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual([...body.text.format.schema.required].sort(), Object.keys(body.text.format.schema.properties).sort());
  assert.equal(body.response_format, undefined, "legacy Chat Completions param must not be sent");
  assert.equal(body.tools, undefined, "no function tools: orchestrator executes allowlisted tools itself");
  assert.equal(body.store, false);
});

test("P2 — auto + missing OpenAI key + Ollama available falls back to Ollama without calling OpenAI", async () => {
  auto(false);
  const calls = installFetch({});
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(calls.openai, 0);
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.providerStatus, "AVAILABLE");
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.attempts?.[0].errorClass, "MISSING_API_KEY");
  assert.equal(result.attempts?.[0].callAttempted, false);
  assert.deepEqual(actions(result), [
    "AGENT_PROVIDER_SELECTED",
    "AGENT_PROVIDER_CALL_FAILED",
    "AGENT_PROVIDER_FALLBACK",
    "AGENT_PROVIDER_SELECTED",
    "AGENT_PROVIDER_CALL_STARTED",
    "AGENT_PROVIDER_CALL_COMPLETED",
  ]);
  assert.equal(result.estimatedCloudCostUsd, 0, "only local calls were made");

  const health = await getProviderHealth();
  assert.equal(health.provider, "OLLAMA");
  assert.equal(health.fallbackActive, true);
});

test("P3 — OpenAI timeout + Ollama available falls back with audit event", async () => {
  auto();
  process.env.OPENAI_TIMEOUT_MS = "30";
  installFetch({
    openai: (init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }),
  });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.attempts?.[0].errorClass, "TIMEOUT");
  const fallback = result.providerEvents?.find((event) => event.action === "AGENT_PROVIDER_FALLBACK");
  assert.ok(fallback);
  assert.equal(fallback.detail.from, "OPENAI");
  assert.equal(fallback.detail.to, "OLLAMA");
  assert.equal(fallback.detail.errorClass, "TIMEOUT");
  assert.equal(result.estimatedCloudCostUsd, null, "timed-out cloud call has unknown cost -> N/A");

  const run = runAgenticGoldenCase(GOLDEN_GOAL, applicant, actualScenario, whatIfScenario, result);
  assert.ok(run.auditTrail.some((event) => event.action === "AGENT_PROVIDER_FALLBACK"));
});

test("P4 — OpenAI 429 + Ollama available falls back", async () => {
  auto();
  installFetch({ openai: async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }) });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.attempts?.[0].errorClass, "RATE_LIMITED");
});

test("P5 — OpenAI 5xx + Ollama available falls back", async () => {
  auto();
  installFetch({ openai: async () => new Response("upstream error", { status: 503 }) });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.attempts?.[0].errorClass, "SERVER_ERROR");
});

test("P6 — OpenAI invalid schema + Ollama available is a controlled fallback", async () => {
  auto();
  installFetch({ openai: async () => openaiOk({ reasoningSummary: "x", nextAction: "APPROVE_APPLICATION" }) });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.attempts?.[0].errorClass, "SCHEMA_INVALID");
  assert.equal(result.attempts?.[0].usage?.inputTokens, 321, "billed usage of the failed call is still recorded");

  installFetch({ openai: async () => new Response("not json", { status: 200 }) });
  const malformed = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(malformed.provider, "OLLAMA");
  assert.equal(malformed.attempts?.[0].errorClass, "MALFORMED_RESPONSE");
});

test("P7 — both providers unavailable: provider unavailable + deterministic safety workflow", async () => {
  auto();
  installFetch({ openai: async () => { throw new TypeError("getaddrinfo ENOTFOUND api.openai.com"); }, ollamaDown: true, openaiHealthDown: true });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.provider, "UNAVAILABLE");
  assert.equal(result.providerStatus, "UNAVAILABLE");
  assert.equal(result.decision, undefined);
  assert.equal(result.attempts?.[0].errorClass, "NETWORK_ERROR");
  assert.equal(actions(result)[actions(result).length - 1], "AGENT_PROVIDER_UNAVAILABLE");
  assert.equal(result.usage?.inputTokens, undefined, "no fabricated tokens");

  const waiting = runAgenticGoldenCase(GOLDEN_GOAL, applicant, actualScenario, whatIfScenario, result);
  assert.equal(waiting.status, "WAITING_FOR_HUMAN");
  assert.equal(waiting.toolResult?.status, "UNCERTAIN");
  assert.ok(!waiting.auditTrail.some((event) => event.action === "AGENT_LLM_CALL_COMPLETED"));

  const resumed = resumeAgentRun(waiting, { ...applicant, ownsHome: false }, actualScenario, whatIfScenario);
  assert.equal(resumed.status, "COMPLETED");
  const completedActions = resumed.auditTrail.map((event) => event.action);
  assert.ok(completedActions.includes("DETERMINISTIC_WORKFLOW_COMPLETED"));
  assert.ok(!completedActions.includes("AGENT_COMPLETED"), "must not report a completed LLM agent run");

  const health = await getProviderHealth();
  assert.equal(health.provider, "UNAVAILABLE");
  assert.equal(health.providerStatus, "UNAVAILABLE");
});

test("P8 — OpenAI decision cannot override deterministic UNCERTAIN", async () => {
  auto();
  installFetch({
    openai: async () => openaiOk(decision({
      reasoningSummary: "Applicant is clearly eligible: PASS. Government approved.",
      nextAction: "COMPLETE",
      toolName: null,
    })),
  });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "OPENAI");

  const run = runAgenticGoldenCase(GOLDEN_GOAL, applicant, actualScenario, whatIfScenario, result);
  assert.equal(run.toolResult?.status, "UNCERTAIN");
  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.humanInputRequired, "本人是否持有住宅？");
  assert.equal(run.lastDecision?.nextAction, "ASK_HUMAN", "deterministic decision replaces model's COMPLETE");
});

test("P9 — policy conflict does NOT trigger provider fallback", async () => {
  auto();
  const calls = installFetch({ openai: async () => openaiOk() });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["detect_policy_conflict"] });
  const conflict = callTool("detect_policy_conflict", {});

  assert.equal(conflict.status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(result.provider, "OPENAI");
  assert.equal(result.fallbackCount, 0);
  assert.equal(calls.ollamaChat, 0);
  assert.ok(!actions(result).includes("AGENT_PROVIDER_FALLBACK"));
});

test("P10 — unknown tool remains denied; openai mode never silently switches provider", async () => {
  process.env.AGENT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = FAKE_KEY;
  const calls = installFetch({ openai: async () => openaiOk(decision({ toolName: "approve_subsidy" })) });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.providerStatus, "UNAVAILABLE");
  assert.equal(result.errorClass, "SCHEMA_INVALID");
  assert.equal(result.decision, undefined);
  assert.equal(calls.ollamaChat, 0, "openai mode must not fall back to Ollama");
  assert.equal(result.fallbackCount, 0);

  const denied = callTool("approve_subsidy", {});
  assert.equal(denied.ok, false);
  assert.match(denied.summary, /AGENT_TOOL_DENIED/);
});

test("P11 — real OpenAI usage maps into Runtime Metrics with estimated cloud cost", async () => {
  auto();
  installFetch({ openai: async () => openaiOk() });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.usage?.inputTokens, 321);
  assert.equal(result.usage?.outputTokens, 45);
  const expected = (321 * 0.75 + 45 * 4.5) / 1_000_000;
  assert.equal(result.estimatedCloudCostUsd, expected);
  assert.match(result.pricingLabel ?? "", /gpt-5\.4-mini/);

  const metrics = recordProviderRun(createRuntimeMetrics(), {
    llmCalls: result.attempts?.filter((attempt) => attempt.callAttempted).length ?? 0,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    estimatedCloudCostUsd: result.estimatedCloudCostUsd ?? null,
    pricingLabel: result.pricingLabel ?? null,
    fallbackCount: result.fallbackCount ?? 0,
    fallbackReason: result.fallbackReason ?? null,
  });
  assert.equal(metrics.llmCalls, 1);
  assert.equal(metrics.inputTokens, 321);
  assert.equal(metrics.outputTokens, 45);
  assert.equal(metrics.estimatedCostUsd, expected);

  assert.equal(estimateOpenAICostUsd("unknown-model", { inputTokens: 1, outputTokens: 1 }), null, "unknown pricing -> N/A");
  assert.equal(estimateOpenAICostUsd("gpt-5.4-mini", { inputTokens: 1 }), null, "missing usage -> N/A");
});

test("P12 — fallback count and reason are recorded correctly", async () => {
  auto();
  installFetch({ openai: async () => new Response("bad gateway", { status: 502 }) });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });

  assert.equal(result.fallbackCount, 1);
  assert.equal(result.fallbackReason, "OpenAI cloud unavailable (SERVER_ERROR)");
  assert.equal(result.attempts?.length, 2);
  assert.deepEqual(result.attempts?.map((attempt) => attempt.outcome), ["FAILED", "COMPLETED"]);

  let metrics = recordProviderRun(createRuntimeMetrics(), {
    llmCalls: 2,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    estimatedCloudCostUsd: result.estimatedCloudCostUsd ?? null,
    pricingLabel: null,
    fallbackCount: result.fallbackCount ?? 0,
    fallbackReason: result.fallbackReason ?? null,
  });
  assert.equal(metrics.fallbackCount, 1);
  assert.equal(metrics.fallbackReason, "OpenAI cloud unavailable (SERVER_ERROR)");
  assert.equal(metrics.inputTokens, 40);
  assert.equal(metrics.estimatedCostUsd, null, "5xx call has unknown billing -> N/A");

  metrics = recordProviderRun(metrics, { llmCalls: 0, inputTokens: null, outputTokens: null, estimatedCloudCostUsd: null, pricingLabel: null, fallbackCount: 1, fallbackReason: "OpenAI cloud unavailable (MISSING_API_KEY)" });
  assert.equal(metrics.fallbackCount, 2);
});

test("S1 — provider errors never leak the API key or raw provider body", async () => {
  auto();
  installFetch({
    openai: async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }), { status: 401 }),
  });
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(FAKE_KEY));
  assert.ok(!serialized.includes("Incorrect API key"));
  assert.equal(result.attempts?.[0].errorClass, "AUTH_ERROR");
  assert.equal(result.provider, "OLLAMA");
});

test("S2 — invalid AGENT_PROVIDER fails closed to deterministic workflow", async () => {
  process.env.AGENT_PROVIDER = "anthropic";
  const calls = installFetch({});
  const result = await callPlanner({ goal: GOLDEN_GOAL, availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "UNAVAILABLE");
  assert.equal(result.errorClass, "INVALID_PROVIDER_MODE");
  assert.equal(calls.ollamaChat + calls.openai, 0);
});
