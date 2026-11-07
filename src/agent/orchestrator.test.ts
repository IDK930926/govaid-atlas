import assert from "node:assert/strict";
import test from "node:test";

import { callPlanner, getProviderHealth, isOpenAIConfigured } from "./client";
import { resumeAgentRun, runBoundedAgentLoop, validateAgentDecision, runAgenticGoldenCase } from "./orchestrator";
import { callTool } from "./tools";
import { createRuntimeMetrics, recordLlmCall } from "../metrics";

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

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_PROVIDER;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
  delete process.env.OPENAI_API_KEY;
});

test("A1 Agent cannot invent unknown tool", () => {
  const result = callTool("unknown_tool", {});
  assert.equal(result.ok, false);
  assert.match(result.summary, /AGENT_TOOL_DENIED/);
});

test("A2 ownsHome = null waits for human", () => {
  const run = runAgenticGoldenCase("Goal", applicant, actualScenario, whatIfScenario);
  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.humanInputRequired, "本人是否持有住宅？");
  assert.equal(run.lastToolCall, "evaluate_central_rules");
  assert.deepEqual(
    run.auditTrail.filter((event) => event.action === "AGENT_TOOL_REQUESTED" || event.action === "AGENT_TOOL_COMPLETED")
      .map((event) => event.action),
    ["AGENT_TOOL_REQUESTED", "AGENT_TOOL_COMPLETED"]
  );
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

test("O1 — Ollama unavailable", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  mockFetch(async (input) => {
    if (String(input).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 500 });
    }
    return new Response("{}", { status: 200 });
  });

  const health = await getProviderHealth();
  assert.equal(health.provider, "OLLAMA");
  assert.equal(health.providerStatus, "UNAVAILABLE");
});

test("O2 — Ollama model unavailable", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  mockFetch(async (input) => {
    if (String(input).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });

  const health = await getProviderHealth();
  assert.equal(health.providerStatus, "UNAVAILABLE");
  assert.equal(health.error, "OLLAMA_MODEL_NOT_AVAILABLE");
});

test("O3 — valid structured decision", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  mockFetch(async (input) => {
    if (String(input).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    if (String(input).includes("/api/chat")) {
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              reasoningSummary: "Use the deterministic central rules tool.",
              nextAction: "CALL_TOOL",
              toolName: "evaluate_central_rules",
              toolArguments: { profile: applicant },
            }),
          },
          prompt_eval_count: 12,
          eval_count: 9,
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  });

  const result = await callPlanner({ goal: "Check rental eligibility", availableTools: ["evaluate_central_rules"] });
  assert.equal(result.providerStatus, "AVAILABLE");
  assert.equal(result.decision?.nextAction, "CALL_TOOL");
  assert.equal(result.usage?.inputTokens, 12);
  assert.equal(result.usage?.outputTokens, 9);
});

test("O4 — invalid structured response", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  mockFetch(async (input) => {
    if (String(input).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    if (String(input).includes("/api/chat")) {
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({ reasoningSummary: "bad", nextAction: "UNKNOWN" }),
          },
          prompt_eval_count: 5,
          eval_count: 3,
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  });

  const result = await callPlanner({ goal: "Check missing fields", availableTools: ["evaluate_central_rules"] });
  assert.equal(result.providerStatus, "UNAVAILABLE");
  assert.equal(result.error, "AGENT_DECISION_SCHEMA_INVALID");
});

test("O5 — unknown tool", () => {
  const denied = callTool("unknown_tool", {});
  assert.equal(denied.status, "FAIL");
  assert.match(denied.summary, /AGENT_TOOL_DENIED/);
});

test("O6 — UNCERTAIN tool result is preserved", () => {
  const result = callTool("evaluate_central_rules", { profile: applicant });
  assert.equal(result.status, "UNCERTAIN");
  assert.notEqual(result.status, "PASS");
});

test("O7 — human pause and resume", () => {
  const waiting = runAgenticGoldenCase("Goal", applicant, actualScenario, whatIfScenario);
  assert.equal(waiting.status, "WAITING_FOR_HUMAN");

  const resumed = runAgenticGoldenCase("Goal", { ...applicant, ownsHome: false }, actualScenario, whatIfScenario);
  assert.equal(resumed.status, "COMPLETED");
});

test("O8 — local successful LLM call", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = "qwen3.5:4b";
  mockFetch(async (input) => {
    if (String(input).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    if (String(input).includes("/api/chat")) {
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              reasoningSummary: "Continue with the deterministic engine.",
              nextAction: "COMPLETE",
            }),
          },
          prompt_eval_count: 24,
          eval_count: 17,
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  });

  const result = await callPlanner({ goal: "Goal", availableTools: ["evaluate_central_rules"] });
  assert.equal(result.provider, "OLLAMA");
  assert.equal(result.providerStatus, "AVAILABLE");
  assert.ok((result.usage?.inputTokens ?? 0) > 0);
  assert.ok((result.usage?.outputTokens ?? 0) > 0);
});

test("A9 Ollama decision is audited before deterministic evaluation", () => {
  const run = runAgenticGoldenCase("Custom goal", applicant, actualScenario, whatIfScenario, {
    provider: "OLLAMA",
    providerStatus: "AVAILABLE",
    model: "qwen3.5:4b",
    callAttempted: true,
    decision: {
      reasoningSummary: "Use deterministic rules.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
    },
    usage: { inputTokens: 10, outputTokens: 7, localApiCost: "$0" },
  });

  assert.equal(run.status, "WAITING_FOR_HUMAN");
  assert.equal(run.providerStatus, "AVAILABLE");
  assert.equal(run.lastToolCall, "evaluate_central_rules");
  assert.ok(run.auditTrail.findIndex((event) => event.action === "AGENT_LLM_CALL_COMPLETED")
    < run.auditTrail.findIndex((event) => event.action === "AGENT_TOOL_REQUESTED"));
  assert.equal(run.lastDecision?.nextAction, "ASK_HUMAN");
});

test("A10 human resume re-evaluates rules and completes actual/what-if/evidence/passport tools", () => {
  const waiting = runAgenticGoldenCase("Goal", applicant, actualScenario, whatIfScenario);
  const resumed = resumeAgentRun(
    waiting,
    {...applicant, ownsHome: false},
    actualScenario,
    whatIfScenario
  );
  const actions = resumed.auditTrail.map((event) => event.action);
  const resumeIndex = actions.lastIndexOf("AGENT_RESUMED");

  assert.equal(resumed.status, "COMPLETED");
  assert.equal(resumed.toolResult?.status, "PASS");
  assert.equal(resumed.lastToolCall, "generate_decision_passport");
  assert.deepEqual(actions.slice(resumeIndex, resumeIndex + 3), [
    "AGENT_RESUMED",
    "AGENT_TOOL_REQUESTED",
    "AGENT_TOOL_COMPLETED",
  ]);
  for (const toolName of [
    "evaluate_actual_scenario",
    "evaluate_what_if_scenario",
    "get_policy_evidence",
    "generate_decision_passport",
  ]) {
    assert.ok(resumed.auditTrail.some((event) =>
      event.action === "AGENT_TOOL_COMPLETED" &&
      (event.input as {toolName?: string}).toolName === toolName
    ), `expected completed tool ${toolName}`);
  }
});

test("Runtime LLM metrics use only provider-reported usage", () => {
  const metrics = recordLlmCall(createRuntimeMetrics(), {inputTokens: 11}, true);
  assert.equal(metrics.llmCalls, 1);
  assert.equal(metrics.inputTokens, 11);
  assert.equal(metrics.outputTokens, null);
  assert.equal(metrics.estimatedCostUsd, 0);
});

test("Ollama receives native JSON schema format and bounded non-thinking generation", async () => {
  process.env.AGENT_PROVIDER = "ollama";
  let chatPayload: Record<string, unknown> | undefined;
  mockFetch(async (input, init) => {
    if (input.includes("/api/tags")) {
      return new Response(JSON.stringify({models: [{name: "qwen3.5:4b"}]}), {status: 200});
    }
    chatPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      message: {content: JSON.stringify({
        reasoningSummary: "Use deterministic rules.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_central_rules",
      })},
      prompt_eval_count: 7,
      eval_count: 5,
    }), {status: 200});
  });

  const result = await callPlanner({goal: "Goal", availableTools: ["evaluate_central_rules"]});
  assert.equal(result.providerStatus, "AVAILABLE");
  assert.equal(result.callAttempted, true);
  assert.equal((chatPayload?.format as {type?: string}).type, "object");
  assert.equal(chatPayload?.think, false);
  assert.equal((chatPayload?.options as {num_predict?: number}).num_predict, 512);
});
