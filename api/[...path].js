"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/agent/providers/types.ts
function getRuntimeDisplayMode(provider, available, fallbackActive = false) {
  if (!available || fallbackActive || provider === "UNAVAILABLE") {
    return "fallback";
  }
  return provider === "OPENAI" ? "cloud" : "local";
}
function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return "AUTH_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  if (status === 404) return "MODEL_NOT_AVAILABLE";
  return "BAD_REQUEST";
}
function classifyThrownError(error) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "TIMEOUT";
  }
  return "NETWORK_ERROR";
}
function validateStructuredAgentDecision(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const decision = value;
  const nextAction = decision.nextAction;
  if (typeof decision.reasoningSummary !== "string") {
    return false;
  }
  if (typeof nextAction !== "string") {
    return false;
  }
  if (!["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"].includes(nextAction)) {
    return false;
  }
  if (decision.toolName !== void 0 && typeof decision.toolName !== "string") {
    return false;
  }
  if (decision.toolName !== void 0 && !ALLOWED_AGENT_TOOL_NAMES.includes(decision.toolName)) {
    return false;
  }
  if (decision.toolArguments !== void 0 && typeof decision.toolArguments !== "object") {
    return false;
  }
  if (decision.humanQuestion !== void 0 && typeof decision.humanQuestion !== "string") {
    return false;
  }
  if (nextAction === "CALL_TOOL") {
    if (typeof decision.toolName !== "string") {
      return false;
    }
  }
  if (nextAction === "ASK_HUMAN") {
    if (typeof decision.humanQuestion !== "string" || !decision.humanQuestion.trim()) {
      return false;
    }
  }
  return true;
}
var PLANNER_SYSTEM_PROMPT, AGENT_DECISION_SCHEMA, ALLOWED_AGENT_TOOL_NAMES;
var init_types = __esm({
  "src/agent/providers/types.ts"() {
    "use strict";
    PLANNER_SYSTEM_PROMPT = "You are the planning and tool-routing layer for GovAid Atlas. You do not determine eligibility. You may only choose from allowed tools. All policy eligibility status comes exclusively from deterministic tool results. Never convert UNCERTAIN into PASS or FAIL. Never invent policy evidence. For a housing request mentioning \u96D9\u5317 without two distinct current and target cities, the input layer resolves the comparison to \u81FA\u5317\u5E02 and \u65B0\u5317\u5E02 using the shared monthly rent; trust the supplied scenario values and do not ask the user to repeat them. If other required applicant data is missing, ask for human confirmation and include a non-empty humanQuestion. If policies conflict, request human review. Return only the required structured decision.";
    AGENT_DECISION_SCHEMA = {
      type: "object",
      properties: {
        reasoningSummary: { type: "string" },
        nextAction: {
          type: "string",
          enum: ["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"]
        },
        toolName: { type: "string" },
        toolArguments: { type: "object" },
        humanQuestion: { type: "string" }
      },
      required: ["reasoningSummary", "nextAction"],
      additionalProperties: false
    };
    ALLOWED_AGENT_TOOL_NAMES = [
      "evaluate_central_rules",
      "evaluate_actual_scenario",
      "evaluate_what_if_scenario",
      "evaluate_childcare_rules",
      "detect_policy_conflict",
      "generate_decision_passport",
      "generate_childcare_passport",
      "get_policy_evidence",
      "request_missing_field",
      "request_human_confirmation",
      "complete"
    ];
  }
});

// src/agent/providers/ollama.ts
function getEnv() {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }
  return process.env;
}
function getOllamaBaseUrl() {
  return getEnv().OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
}
function getOllamaModel() {
  return getEnv().OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}
async function healthCheckOllama() {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET" });
    if (!response.ok) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: `OLLAMA_PROVIDER_UNAVAILABLE: ${response.status}`,
        errorClass: "PROVIDER_UNAVAILABLE"
      };
    }
    const json = await response.json();
    const modelNames = (json.models ?? []).map((entry) => entry.name ?? "").filter(Boolean);
    const hasModel = modelNames.some((name) => name === model || name.startsWith(`${model}:`) || name === `${model}.gguf`);
    if (!hasModel) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        error: "OLLAMA_MODEL_NOT_AVAILABLE",
        errorClass: "MODEL_NOT_AVAILABLE"
      };
    }
    return {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model
    };
  } catch (error) {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      error: error instanceof Error ? `OLLAMA_PROVIDER_UNAVAILABLE: ${error.message}` : "OLLAMA_PROVIDER_UNAVAILABLE",
      errorClass: "PROVIDER_UNAVAILABLE"
    };
  }
}
async function callOllamaPlanner(input) {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();
  const health = await healthCheckOllama();
  if (health.providerStatus !== "AVAILABLE") {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      error: health.error ?? "AGENT_PROVIDER_UNAVAILABLE",
      errorClass: health.errorClass ?? "PROVIDER_UNAVAILABLE"
    };
  }
  const schema = input.structuredSchema ?? AGENT_DECISION_SCHEMA;
  const payload = {
    model,
    stream: false,
    format: schema,
    options: {
      temperature: 0,
      num_predict: 512
    },
    think: false,
    messages: [
      {
        role: "system",
        content: PLANNER_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Goal: ${input.goal}. Available tools: ${input.availableTools.join(", ")}. Return only a valid decision that follows the required schema.`
      }
    ]
  };
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: `OLLAMA_REQUEST_FAILED: ${response.status} ${text}`,
        errorClass: classifyHttpStatus(response.status)
      };
    }
    const json = await response.json();
    const contentValue = json.message?.content;
    const contentText = typeof contentValue === "string" ? contentValue : contentValue && typeof contentValue === "object" ? contentValue.text ?? "{}" : "{}";
    let parsed;
    try {
      parsed = JSON.parse(contentText);
    } catch {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "OLLAMA_DECISION_PARSE_FAILED",
        errorClass: "MALFORMED_RESPONSE"
      };
    }
    if (!validateStructuredAgentDecision(parsed)) {
      return {
        provider: "OLLAMA",
        providerStatus: "UNAVAILABLE",
        model,
        callAttempted: true,
        error: "AGENT_DECISION_SCHEMA_INVALID",
        errorClass: "SCHEMA_INVALID"
      };
    }
    return {
      provider: "OLLAMA",
      providerStatus: "AVAILABLE",
      model,
      callAttempted: true,
      decision: parsed,
      usage: {
        inputTokens: typeof json.prompt_eval_count === "number" ? json.prompt_eval_count : void 0,
        outputTokens: typeof json.eval_count === "number" ? json.eval_count : void 0,
        totalTokens: typeof json.prompt_eval_count === "number" && typeof json.eval_count === "number" ? json.prompt_eval_count + json.eval_count : void 0,
        localApiCost: "$0"
      }
    };
  } catch (error) {
    return {
      provider: "OLLAMA",
      providerStatus: "UNAVAILABLE",
      model,
      callAttempted: true,
      error: error instanceof Error ? `OLLAMA_REQUEST_ERROR: ${error.message}` : "AGENT_PROVIDER_UNAVAILABLE",
      errorClass: classifyThrownError(error)
    };
  }
}
var DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL;
var init_ollama = __esm({
  "src/agent/providers/ollama.ts"() {
    "use strict";
    init_types();
    DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";
  }
});

// src/agent/providers/openai.ts
function getEnv2() {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }
  return process.env;
}
function positiveInt(raw, fallback) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function getOpenAIModel() {
  return getEnv2().OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}
function supportsReasoningEffort(model) {
  return /^gpt-5(?:[.-]|$)/i.test(model);
}
function getOpenAITimeoutMs() {
  return positiveInt(getEnv2().OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS);
}
function isOpenAIConfigured() {
  return Boolean(getEnv2().OPENAI_API_KEY?.trim());
}
function failure(model, errorClass, callAttempted, extra) {
  return {
    provider: "OPENAI",
    providerStatus: "UNAVAILABLE",
    model,
    callAttempted,
    error: `OPENAI_${errorClass}`,
    errorClass,
    ...extra
  };
}
function healthFailure(model, errorClass) {
  return { provider: "OPENAI", providerStatus: "UNAVAILABLE", model, error: `OPENAI_${errorClass}`, errorClass };
}
async function healthCheckOpenAI() {
  const model = getOpenAIModel();
  const apiKey = getEnv2().OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return healthFailure(model, "MISSING_API_KEY");
  }
  return { provider: "OPENAI", providerStatus: "AVAILABLE", model };
}
async function callOpenAIPlanner(input, modelOverride = getOpenAIModel()) {
  const apiKey = getEnv2().OPENAI_API_KEY?.trim();
  const model = modelOverride;
  if (!apiKey) {
    return failure(model, "MISSING_API_KEY", false);
  }
  const toolList = input.availableTools.filter(
    (tool) => ALLOWED_AGENT_TOOL_NAMES.includes(tool)
  );
  const payload = {
    model,
    instructions: PLANNER_SYSTEM_PROMPT,
    input: `Goal: ${input.goal}
Available tools: ${toolList.join(", ")}
Return only a valid decision that follows the required schema. Use null for toolName or humanQuestion when not applicable.`,
    text: {
      format: {
        type: "json_schema",
        name: "agent_decision",
        strict: true,
        schema: OPENAI_AGENT_DECISION_SCHEMA
      }
    },
    ...supportsReasoningEffort(model) ? { reasoning: { effort: getEnv2().OPENAI_REASONING_EFFORT?.trim() || "low" } } : {},
    max_output_tokens: 2048,
    store: false
  };
  let response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(getOpenAITimeoutMs())
    });
  } catch (error) {
    return failure(model, classifyThrownError(error), true);
  }
  if (!response.ok) {
    await response.text().catch(() => void 0);
    return failure(model, classifyHttpStatus(response.status), true);
  }
  let json;
  try {
    json = await response.json();
  } catch (error) {
    return failure(model, classifyThrownError(error) === "TIMEOUT" ? "TIMEOUT" : "MALFORMED_RESPONSE", true);
  }
  const usage = {
    inputTokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : void 0,
    outputTokens: typeof json.usage?.output_tokens === "number" ? json.usage.output_tokens : void 0,
    totalTokens: typeof json.usage?.total_tokens === "number" ? json.usage.total_tokens : void 0
  };
  const parts = (json.output ?? []).flatMap(
    (item) => item.type === void 0 || item.type === "message" ? item.content ?? [] : []
  );
  if (parts.some((part) => part.type === "refusal")) {
    return failure(model, "REFUSAL", true, { usage });
  }
  const textPayload = parts.find((part) => part.type === "output_text")?.text;
  if (json.status && json.status !== "completed" || typeof textPayload !== "string") {
    return failure(model, "MALFORMED_RESPONSE", true, { usage });
  }
  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    return failure(model, "MALFORMED_RESPONSE", true, { usage });
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed;
    for (const key of ["toolName", "humanQuestion"]) {
      if (record[key] === null) delete record[key];
    }
  }
  if (!validateStructuredAgentDecision(parsed)) {
    return failure(model, "SCHEMA_INVALID", true, { usage });
  }
  return {
    provider: "OPENAI",
    providerStatus: "AVAILABLE",
    model,
    callAttempted: true,
    decision: parsed,
    usage
  };
}
var DEFAULT_OPENAI_MODEL, OPENAI_FALLBACK_MODEL, DEFAULT_OPENAI_TIMEOUT_MS, OPENAI_BASE_URL, OPENAI_AGENT_DECISION_SCHEMA;
var init_openai = __esm({
  "src/agent/providers/openai.ts"() {
    "use strict";
    init_types();
    DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
    OPENAI_FALLBACK_MODEL = DEFAULT_OPENAI_MODEL;
    DEFAULT_OPENAI_TIMEOUT_MS = 2e4;
    OPENAI_BASE_URL = "https://api.openai.com/v1";
    OPENAI_AGENT_DECISION_SCHEMA = {
      type: "object",
      properties: {
        reasoningSummary: { type: "string" },
        nextAction: {
          type: "string",
          enum: ["CALL_TOOL", "ASK_HUMAN", "COMPLETE", "HUMAN_REVIEW_REQUIRED"]
        },
        toolName: { type: ["string", "null"], enum: [...ALLOWED_AGENT_TOOL_NAMES, null] },
        humanQuestion: { type: ["string", "null"] }
      },
      required: ["reasoningSummary", "nextAction", "toolName", "humanQuestion"],
      additionalProperties: false
    };
  }
});

// src/agent/providers/pricing.ts
function getOpenAIPricing(model) {
  return OPENAI_PRICING[model] ?? null;
}
function estimateOpenAICostUsd(model, usage) {
  const pricing = getOpenAIPricing(model);
  if (!pricing || typeof usage?.inputTokens !== "number" || typeof usage?.outputTokens !== "number") {
    return null;
  }
  return (usage.inputTokens * pricing.inputUsdPerMTok + usage.outputTokens * pricing.outputUsdPerMTok) / 1e6;
}
var OPENAI_PRICING;
var init_pricing = __esm({
  "src/agent/providers/pricing.ts"() {
    "use strict";
    OPENAI_PRICING = {
      "gpt-5.4-mini": {
        inputUsdPerMTok: 0.75,
        outputUsdPerMTok: 4.5,
        snapshot: "gpt-5.4-mini list price snapshot 2026-11-10 (USD 0.75 in / 4.50 out per 1M tokens)"
      }
    };
  }
});

// src/agent/client.ts
function getProviderMode() {
  const raw = (process.env?.AGENT_PROVIDER ?? "auto").trim().toLowerCase() || "auto";
  return raw === "auto" || raw === "openai" || raw === "ollama" ? raw : null;
}
function getProviderChain(mode = getProviderMode()) {
  if (mode === "auto") return ["OPENAI", "OLLAMA"];
  if (mode === "openai") return ["OPENAI"];
  if (mode === "ollama") return ["OLLAMA"];
  return [];
}
function modelFor(provider) {
  return provider === "OPENAI" ? getOpenAIModel() : getOllamaModel();
}
function safeReason(provider, errorClass) {
  return `${PROVIDER_LABEL[provider]} unavailable (${errorClass ?? "PROVIDER_UNAVAILABLE"})`;
}
function shouldRetryOpenAIModel(errorClass) {
  return errorClass === "MODEL_NOT_AVAILABLE" || errorClass === "BAD_REQUEST";
}
async function getProviderHealth() {
  const mode = getProviderMode();
  const chain = getProviderChain(mode);
  if (!mode || chain.length === 0) {
    return {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: "N/A",
      error: "AGENT_PROVIDER_INVALID_MODE",
      errorClass: "INVALID_PROVIDER_MODE",
      mode: void 0
    };
  }
  let firstFailure;
  for (const provider of chain) {
    const health = provider === "OPENAI" ? await healthCheckOpenAI() : await healthCheckOllama();
    if (health.providerStatus === "AVAILABLE") {
      return {
        ...health,
        mode,
        fallbackActive: Boolean(firstFailure),
        fallbackReason: firstFailure ? safeReason(firstFailure.provider, firstFailure.errorClass) : null
      };
    }
    firstFailure ??= { provider, errorClass: health.errorClass };
    if (chain.length === 1) {
      return { ...health, mode, fallbackActive: false, fallbackReason: null };
    }
  }
  return {
    provider: "UNAVAILABLE",
    providerStatus: "UNAVAILABLE",
    model: "N/A",
    error: "AGENT_PROVIDER_UNAVAILABLE",
    errorClass: "PROVIDER_UNAVAILABLE",
    mode,
    fallbackActive: false,
    fallbackReason: null
  };
}
function sumKnown(values) {
  const known = values.filter((value) => typeof value === "number");
  return known.length ? known.reduce((total, value) => total + value, 0) : void 0;
}
function estimateCloudCost(attempts) {
  const openaiAttempts = attempts.filter((attempt) => attempt.provider === "OPENAI" && attempt.callAttempted);
  if (openaiAttempts.length === 0) {
    return { usd: attempts.some((attempt) => attempt.callAttempted) ? 0 : null, label: null };
  }
  let total = 0;
  for (const attempt of openaiAttempts) {
    const cost = estimateOpenAICostUsd(attempt.model, attempt.usage);
    if (cost === null) {
      return { usd: null, label: getOpenAIPricing(attempt.model)?.snapshot ?? null };
    }
    total += cost;
  }
  return { usd: total, label: getOpenAIPricing(openaiAttempts[0].model)?.snapshot ?? null };
}
function getTimeoutMs(explicitTimeoutMs) {
  if (typeof explicitTimeoutMs === "number" && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  const envTimeout = Number(process.env?.AGENT_PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }
  return DEFAULT_PROVIDER_TIMEOUT_MS;
}
async function callProviderWithTimeout(provider, model, caller, input, timeoutMs) {
  let timer;
  try {
    const timeoutPromise = new Promise((resolveTimeout) => {
      timer = setTimeout(() => {
        resolveTimeout({
          provider,
          providerStatus: "UNAVAILABLE",
          model,
          callAttempted: true,
          error: "AGENT_PROVIDER_TIMEOUT",
          errorClass: "TIMEOUT"
        });
      }, timeoutMs);
    });
    const request = provider === "OPENAI" ? caller(input, model) : caller(input);
    return await Promise.race([request, timeoutPromise]);
  } finally {
    if (timer !== void 0) {
      clearTimeout(timer);
    }
  }
}
async function callPlanner(input, deps = {}) {
  const now = deps.now ?? (() => performance.now());
  const callers = {
    OPENAI: deps.callOpenAI ?? callOpenAIPlanner,
    OLLAMA: deps.callOllama ?? callOllamaPlanner
  };
  const mode = getProviderMode();
  const chain = getProviderChain(mode);
  const timeoutMs = getTimeoutMs(input.timeoutMs);
  const events = [];
  const attempts = [];
  const emit = (action, detail) => events.push({ timestamp: (/* @__PURE__ */ new Date()).toISOString(), action, detail });
  if (!mode) {
    emit("AGENT_PROVIDER_UNAVAILABLE", { reason: "Invalid AGENT_PROVIDER value", errorClass: "INVALID_PROVIDER_MODE" });
    return {
      provider: "UNAVAILABLE",
      providerStatus: "UNAVAILABLE",
      model: "N/A",
      callAttempted: false,
      error: "AGENT_PROVIDER_INVALID_MODE",
      errorClass: "INVALID_PROVIDER_MODE",
      attempts,
      fallbackCount: 0,
      fallbackReason: null,
      providerEvents: events,
      estimatedCloudCostUsd: null,
      pricingLabel: null
    };
  }
  let fallbackCount = 0;
  let fallbackReason = null;
  let lastResult;
  for (let index = 0; index < chain.length; index += 1) {
    const provider = chain[index];
    const model = modelFor(provider);
    emit("AGENT_PROVIDER_SELECTED", { mode, provider, model });
    const providerResults = [];
    if (provider === "OPENAI" && !isOpenAIConfigured()) {
      providerResults.push({
        model,
        result: {
          provider,
          providerStatus: "UNAVAILABLE",
          model,
          callAttempted: false,
          error: "OPENAI_MISSING_API_KEY",
          errorClass: "MISSING_API_KEY"
        },
        latencyMs: 0
      });
    } else {
      const callModel = async (attemptModel) => {
        emit("AGENT_PROVIDER_CALL_STARTED", { provider, model: attemptModel });
        const started = now();
        let result2;
        try {
          result2 = await callProviderWithTimeout(provider, attemptModel, callers[provider], input, timeoutMs);
        } catch {
          result2 = {
            provider,
            providerStatus: "UNAVAILABLE",
            model: attemptModel,
            callAttempted: true,
            errorClass: "NETWORK_ERROR"
          };
        }
        providerResults.push({
          model: attemptModel,
          result: result2,
          latencyMs: Math.max(0, now() - started)
        });
        return result2;
      };
      let result = await callModel(model);
      if (provider === "OPENAI" && model !== OPENAI_FALLBACK_MODEL && result.callAttempted !== false && result.providerStatus !== "AVAILABLE" && shouldRetryOpenAIModel(result.errorClass)) {
        const errorClass2 = result.errorClass ?? "PROVIDER_UNAVAILABLE";
        emit("AGENT_MODEL_FALLBACK", {
          provider,
          fromModel: model,
          toModel: OPENAI_FALLBACK_MODEL,
          model: OPENAI_FALLBACK_MODEL,
          errorClass: errorClass2,
          reason: `Retrying with ${OPENAI_FALLBACK_MODEL} after ${errorClass2}`
        });
        result = await callModel(OPENAI_FALLBACK_MODEL);
      }
    }
    let successfulResult;
    for (const providerResult of providerResults) {
      const result = providerResult.result;
      lastResult = result;
      const succeeded = result.providerStatus === "AVAILABLE" && Boolean(result.decision);
      const errorClass2 = succeeded ? void 0 : result.errorClass ?? "PROVIDER_UNAVAILABLE";
      attempts.push({
        provider,
        model: result.model || providerResult.model,
        callAttempted: result.callAttempted ?? false,
        outcome: succeeded ? "COMPLETED" : "FAILED",
        latencyMs: providerResult.latencyMs,
        errorClass: errorClass2,
        usage: result.usage
      });
      if (succeeded) {
        successfulResult = result;
        emit("AGENT_PROVIDER_CALL_COMPLETED", {
          provider,
          model: result.model || providerResult.model,
          latencyMs: Math.round(providerResult.latencyMs)
        });
        break;
      }
      emit("AGENT_PROVIDER_CALL_FAILED", {
        provider,
        model: result.model || providerResult.model,
        latencyMs: Math.round(providerResult.latencyMs),
        errorClass: errorClass2
      });
    }
    if (successfulResult) {
      const result = successfulResult;
      const cost2 = estimateCloudCost(attempts);
      return {
        ...result,
        callAttempted: attempts.some((attempt) => attempt.callAttempted),
        usage: {
          ...result.usage,
          inputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.inputTokens)),
          outputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.outputTokens)),
          totalTokens: sumKnown(attempts.map((attempt) => attempt.usage?.totalTokens))
        },
        error: void 0,
        errorClass: void 0,
        mode,
        attempts,
        fallbackCount,
        fallbackReason,
        providerEvents: events,
        estimatedCloudCostUsd: cost2.usd,
        pricingLabel: cost2.label
      };
    }
    const lastAttempt = attempts[attempts.length - 1];
    const errorClass = lastAttempt?.errorClass ?? "PROVIDER_UNAVAILABLE";
    const next = chain[index + 1];
    if (next) {
      fallbackCount += 1;
      fallbackReason ??= safeReason(provider, errorClass);
      emit("AGENT_PROVIDER_FALLBACK", { from: provider, to: next, errorClass, reason: safeReason(provider, errorClass) });
    }
  }
  const lastError = attempts[attempts.length - 1]?.errorClass ?? "PROVIDER_UNAVAILABLE";
  emit("AGENT_PROVIDER_UNAVAILABLE", {
    mode,
    reason: "All configured agent providers are unavailable; deterministic safety workflow only.",
    errorClass: lastError
  });
  const cost = estimateCloudCost(attempts);
  return {
    provider: "UNAVAILABLE",
    providerStatus: "UNAVAILABLE",
    model: chain.length === 1 ? modelFor(chain[0]) : "N/A",
    callAttempted: attempts.some((attempt) => attempt.callAttempted),
    usage: {
      inputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.inputTokens)),
      outputTokens: sumKnown(attempts.map((attempt) => attempt.usage?.outputTokens))
    },
    // Single-provider modes keep the provider's own error code (server-side only).
    error: chain.length === 1 ? lastResult?.error ?? "AGENT_PROVIDER_UNAVAILABLE" : "AGENT_PROVIDER_UNAVAILABLE",
    errorClass: lastError,
    mode,
    attempts,
    fallbackCount,
    fallbackReason,
    providerEvents: events,
    estimatedCloudCostUsd: cost.usd,
    pricingLabel: cost.label
  };
}
var DEFAULT_PROVIDER_TIMEOUT_MS, PROVIDER_LABEL;
var init_client = __esm({
  "src/agent/client.ts"() {
    "use strict";
    init_ollama();
    init_openai();
    init_pricing();
    DEFAULT_PROVIDER_TIMEOUT_MS = 15e3;
    PROVIDER_LABEL = {
      OPENAI: "OpenAI cloud",
      OLLAMA: "Ollama local"
    };
  }
});

// src/status.ts
var init_status = __esm({
  "src/status.ts"() {
    "use strict";
  }
});

// src/coverage.ts
function detectBenefitDomain(goal) {
  const text = goal.toLowerCase();
  if (CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "CHILDCARE";
  }
  return "HOUSING";
}
function assessQueryCoverage(goal) {
  const text = goal.toLowerCase();
  if (CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    if (UNSUPPORTED_CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return {
        status: "NOT_COVERED",
        domain: "CHILDCARE",
        reason: "CHILDCARE_POLICY_NOT_IMPLEMENTED",
        message: "\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u300C\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u300D\uFF0C\u5C1A\u672A\u6DB5\u84CB\u6258\u80B2\u88DC\u52A9\u3001\u751F\u80B2\u734E\u52F5\u91D1\u3001\u5C31\u5B78\u88DC\u52A9\u6216\u80B2\u5B30\u7559\u8077\u505C\u85AA\u6D25\u8CBC\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u9805\u88DC\u52A9\u4E4B\u8CC7\u683C\u5224\u5B9A\u3002\u9019\u4E0D\u4EE3\u8868\u60A8\u7121\u6CD5\u7533\u8ACB\uFF0C\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002",
        officialReferrals: [
          {
            label: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72\uFF0D\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u8207\u6258\u80B2\u88DC\u52A9\u5C08\u5340",
            agency: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72",
            url: "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582"
          },
          {
            label: "\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u7DDA\u4E0A\u7533\u8ACB\u7DB2",
            agency: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72",
            url: "https://twbaby.sfaa.gov.tw/"
          }
        ]
      };
    }
    return {
      status: "COVERED",
      domain: "CHILDCARE",
      reason: "CHILDCARE_UNDER2_ALLOWANCE_IN_SCOPE",
      message: "\u76EE\u524D\u7248\u672C\u5DF2\u652F\u63F4\u300C\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\uFF08115\u5E74\u5EA6\uFF09\u300D\u4E4B\u8CC7\u683C\u9810\u5BE9\u3001\u80CE\u6B21\u91D1\u984D\u8A66\u7B97\u8207\u7533\u8FA6\u5C0E\u822A\u3002",
      officialReferrals: [
        {
          label: "\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u7DDA\u4E0A\u7533\u8ACB\u7DB2",
          agency: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72",
          url: "https://twbaby.sfaa.gov.tw/"
        }
      ]
    };
  }
  if (UNSUPPORTED_HOUSING_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_HOUSING_POLICY_NOT_IMPLEMENTED",
      message: "\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u300C300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\uFF08\u542B\u96D9\u5317\u8207\u6843\u5712\u5E02\u53D7\u7406\u5C0E\u822A\uFF09\u300D\u3001\u300C\u81FA\u5317\u5E02\u81FA\u5317\u5E78\u798F\u79DF\u52A0\u78BC\u300D\u8207\u300C\u65B0\u5317\u5E02\u9752\u5E74\u79DF\u91D1\u88DC\u8CBC\u300D\uFF0C\u5C1A\u672A\u6DB5\u84CB\u6843\u5712\u5E02\u7368\u7ACB\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\u3001\u539F\u4F4F\u6C11\u65CF\u5C08\u6848\u79DF\u91D1\u88DC\u8CBC\u3001\u793E\u6703\u4F4F\u5B85\u5305\u79DF\u4EE3\u7BA1\u6216\u8CFC\u5C4B\u8CB8\u6B3E\u88DC\u8CBC\u3002\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002",
      officialReferrals: [
        {
          label: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72\uFF0D300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\u7DDA\u4E0A\u7533\u8ACB\u7CFB\u7D71",
          agency: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72",
          url: "https://has.nlma.gov.tw/subsidyOnline/"
        },
        {
          label: "\u6843\u5712\u5E02\u653F\u5E9C\u4F4F\u5B85\u767C\u5C55\u8655\u5B98\u65B9\u7DB2\u7AD9",
          agency: "\u6843\u5712\u5E02\u653F\u5E9C\u4F4F\u5B85\u767C\u5C55\u8655",
          url: "https://ohd.tycg.gov.tw/"
        }
      ]
    };
  }
  const normalizedText = text.replace(/台/g, "\u81FA");
  const matchedCity = TAIWAN_CITIES.find((c) => normalizedText.includes(c));
  if (matchedCity && !ALL_COVERED_HOUSING_CITIES.includes(matchedCity)) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_CITY_HOUSING_POLICY_NOT_IMPLEMENTED",
      message: `\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u96D9\u5317\u53CA\u6843\u5712\u5E02\uFF08\u53D7\u7406\u5C0E\u822A\uFF09\u4E4B\u79DF\u91D1\u88DC\u8CBC\uFF0C\u5C1A\u672A\u5B8C\u6574\u6DB5\u84CB${matchedCity}\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u7E23\u5E02\u88DC\u52A9\u4E4B\u8CC7\u683C\u5224\u5B9A\u3002\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002`,
      officialReferrals: [
        {
          label: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72\uFF0D300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\u7DDA\u4E0A\u7533\u8ACB\u7CFB\u7D71",
          agency: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72",
          url: "https://has.nlma.gov.tw/subsidyOnline/"
        }
      ]
    };
  }
  if (UNSUPPORTED_GENERAL_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_DOMAIN_NOT_IMPLEMENTED",
      message: "\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u7279\u5B9A\u79DF\u5C4B\u88DC\u8CBC\u8207\u672A\u6EFF2\u6B72\u80B2\u5152\u6D25\u8CBC\uFF0C\u5C1A\u672A\u6DB5\u84CB\u6B64\u985E\u653F\u7B56\u9805\u76EE\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u9805\u88DC\u52A9\u4E4B\u8CC7\u683C\u5224\u5B9A\u3002\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002",
      officialReferrals: [
        {
          label: "\u885B\u751F\u798F\u5229\u90E8 1957 \u798F\u5229\u8AEE\u8A62\u5C08\u7DDA",
          agency: "\u885B\u751F\u798F\u5229\u90E8",
          url: "https://1957.mohw.gov.tw/"
        }
      ]
    };
  }
  return {
    status: "COVERED",
    domain: "RENTAL_SUBSIDY",
    reason: "RENTAL_SUBSIDY_IN_SCOPE",
    message: "\u76EE\u524D\u7248\u672C\u53EF\u9032\u884C\u79DF\u5C4B\u88DC\u52A9\u7684\u90E8\u5206\u689D\u4EF6\u9810\u5BE9\u8207\u7533\u8FA6\u5C0E\u822A\u3002",
    officialReferrals: []
  };
}
var COVERED_LOCAL_CITIES, COVERED_CENTRAL_NAVIGATION_CITIES, ALL_COVERED_HOUSING_CITIES, CHILDCARE_KEYWORDS, UNSUPPORTED_CHILDCARE_KEYWORDS, UNSUPPORTED_HOUSING_KEYWORDS, UNSUPPORTED_GENERAL_KEYWORDS, TAIWAN_CITIES;
var init_coverage = __esm({
  "src/coverage.ts"() {
    "use strict";
    COVERED_LOCAL_CITIES = ["\u81FA\u5317\u5E02", "\u65B0\u5317\u5E02"];
    COVERED_CENTRAL_NAVIGATION_CITIES = ["\u6843\u5712\u5E02"];
    ALL_COVERED_HOUSING_CITIES = [
      ...COVERED_LOCAL_CITIES,
      ...COVERED_CENTRAL_NAVIGATION_CITIES
    ];
    CHILDCARE_KEYWORDS = [
      "\u80B2\u5152",
      "\u80B2\u5B30",
      "\u6258\u80B2",
      "\u6258\u5B30",
      "\u5E7C\u5152",
      "\u751F\u80B2",
      "\u5B30\u5152",
      "\u4FDD\u6BCD",
      "\u4FDD\u59C6",
      "\u6E96\u516C\u5171",
      "\u672A\u6EFF2\u6B72",
      "\u672A\u6EFF\u4E8C\u6B72",
      "childcare",
      "child care",
      "parental leave"
    ];
    UNSUPPORTED_CHILDCARE_KEYWORDS = [
      "\u6258\u80B2\u88DC\u52A9",
      "\u6E96\u516C\u5171\u6258\u80B2\u88DC\u52A9",
      "\u751F\u80B2\u6D25\u8CBC",
      "\u751F\u80B2\u734E\u52F5",
      "\u751F\u80B2\u88DC\u52A9",
      "\u5C31\u5B78\u88DC\u52A9",
      "\u5E7C\u5152\u5712\u88DC\u52A9",
      "\u80B2\u5B30\u7559\u8077\u505C\u85AA",
      "parental leave"
    ];
    UNSUPPORTED_HOUSING_KEYWORDS = [
      "\u6843\u5712\u5E02\u5730\u65B9\u52A0\u78BC",
      "\u6843\u5712\u5730\u65B9\u52A0\u78BC",
      "\u6843\u5712\u5E02\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9",
      "\u6843\u5712\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9",
      "\u539F\u4F4F\u6C11\u65CF\u79DF\u91D1\u88DC\u8CBC",
      "\u539F\u4F4F\u6C11\u79DF\u91D1\u88DC\u8CBC",
      "\u5305\u79DF\u4EE3\u7BA1",
      "\u8CFC\u5C4B\u8CB8\u6B3E",
      "\u9752\u5E74\u8CFC\u5C4B",
      "\u4FEE\u7E55\u4F4F\u5B85"
    ];
    UNSUPPORTED_GENERAL_KEYWORDS = [
      "\u8001\u4EBA",
      "\u9577\u7167",
      "\u8EAB\u5FC3\u969C\u7919",
      "\u6025\u96E3\u6551\u52A9",
      "\u5931\u696D",
      "\u5E74\u91D1",
      "\u52DE\u4FDD",
      "\u5065\u4FDD",
      "\u91CD\u967D"
    ];
    TAIWAN_CITIES = [
      "\u81FA\u5317\u5E02",
      "\u65B0\u5317\u5E02",
      "\u6843\u5712\u5E02",
      "\u81FA\u4E2D\u5E02",
      "\u81FA\u5357\u5E02",
      "\u9AD8\u96C4\u5E02",
      "\u57FA\u9686\u5E02",
      "\u65B0\u7AF9\u5E02",
      "\u5609\u7FA9\u5E02",
      "\u65B0\u7AF9\u7E23",
      "\u82D7\u6817\u7E23",
      "\u5F70\u5316\u7E23",
      "\u5357\u6295\u7E23",
      "\u96F2\u6797\u7E23",
      "\u5609\u7FA9\u7E23",
      "\u5C4F\u6771\u7E23",
      "\u5B9C\u862D\u7E23",
      "\u82B1\u84EE\u7E23",
      "\u81FA\u6771\u7E23",
      "\u6F8E\u6E56\u7E23",
      "\u91D1\u9580\u7E23",
      "\u9023\u6C5F\u7E23"
    ];
  }
});

// src/evidence.ts
var init_evidence = __esm({
  "src/evidence.ts"() {
    "use strict";
  }
});

// src/rules.ts
var init_rules = __esm({
  "src/rules.ts"() {
    "use strict";
  }
});

// src/navigation.ts
var init_navigation = __esm({
  "src/navigation.ts"() {
    "use strict";
    init_evidence();
    init_rules();
  }
});

// src/passport.ts
var init_passport = __esm({
  "src/passport.ts"() {
    "use strict";
    init_evidence();
    init_navigation();
    init_status();
    init_coverage();
  }
});

// src/conflict.ts
var init_conflict = __esm({
  "src/conflict.ts"() {
    "use strict";
  }
});

// src/scenario.ts
var init_scenario = __esm({
  "src/scenario.ts"() {
    "use strict";
    init_rules();
    init_status();
    init_coverage();
  }
});

// src/childcare.ts
var init_childcare = __esm({
  "src/childcare.ts"() {
    "use strict";
    init_evidence();
    init_navigation();
    init_rules();
    init_status();
    init_coverage();
  }
});

// src/agent/missing-fields.ts
var HOUSING_MISSING_FIELDS, CHILDCARE_MISSING_FIELDS, SUPPORTED_MISSING_FIELDS;
var init_missing_fields = __esm({
  "src/agent/missing-fields.ts"() {
    "use strict";
    init_coverage();
    HOUSING_MISSING_FIELDS = [
      "ownsHome",
      "receivesOtherHousingAid",
      "city",
      "monthlyIncome",
      "age",
      "centralRentApproved",
      "newTaipeiResidenceStudyWork",
      "registeredCity"
    ];
    CHILDCARE_MISSING_FIELDS = [
      "childAgeMonths",
      "childHasBirthOrInitialHouseholdRegistration",
      "isGovernmentPlaced",
      "receivesPublicOrQuasiPublicChildcare",
      "birthOrder"
    ];
    SUPPORTED_MISSING_FIELDS = [
      ...HOUSING_MISSING_FIELDS,
      ...CHILDCARE_MISSING_FIELDS,
      "childRegisteredCity"
    ];
  }
});

// src/agent/tools.ts
function listAllowedTools() {
  return [...ALLOWED_TOOLS];
}
var ALLOWED_TOOLS;
var init_tools = __esm({
  "src/agent/tools.ts"() {
    "use strict";
    init_passport();
    init_evidence();
    init_conflict();
    init_scenario();
    init_childcare();
    init_rules();
    init_status();
    init_coverage();
    init_missing_fields();
    ALLOWED_TOOLS = [
      "evaluate_central_rules",
      "evaluate_actual_scenario",
      "evaluate_what_if_scenario",
      "evaluate_childcare_rules",
      "detect_policy_conflict",
      "generate_decision_passport",
      "generate_childcare_passport",
      "get_policy_evidence",
      "request_missing_field",
      "request_human_confirmation",
      "complete"
    ];
  }
});

// src/agent/trace.ts
var init_trace = __esm({
  "src/agent/trace.ts"() {
    "use strict";
  }
});

// src/agent/orchestrator.ts
function buildSafePlan(goal, domain = detectBenefitDomain(goal)) {
  if (domain === "CHILDCARE") {
    return [
      "Check under-2 childcare allowance rules",
      "Resolve missing childcare applicant fields",
      "Check official childcare policy evidence",
      "Generate Childcare Decision Passport"
    ].map((step, index) => `${index + 1}. ${step} \u2014 ${goal}`);
  }
  return [
    "Check central rental rules",
    "Resolve missing applicant fields",
    "Evaluate ACTUAL scenario",
    "Evaluate WHAT-IF scenario",
    "Check policy evidence",
    "Generate Decision Passport"
  ].map((step, index) => `${index + 1}. ${step} \u2014 ${goal}`);
}
var init_orchestrator = __esm({
  "src/agent/orchestrator.ts"() {
    "use strict";
    init_status();
    init_coverage();
    init_tools();
    init_missing_fields();
    init_trace();
    init_types();
  }
});

// src/server.ts
var server_exports = {};
__export(server_exports, {
  MAX_GOAL_LENGTH: () => MAX_GOAL_LENGTH,
  MAX_REQUEST_BODY_BYTES: () => MAX_REQUEST_BODY_BYTES,
  RATE_LIMIT_MAX_REQUESTS: () => RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS: () => RATE_LIMIT_WINDOW_MS,
  checkRateLimit: () => checkRateLimit,
  handleRequest: () => handleRequest,
  resetRateLimiter: () => resetRateLimiter,
  server: () => server,
  setRateLimitMaxRequests: () => setRateLimitMaxRequests
});
function resetRateLimiter() {
  rateLimitBuckets.clear();
  configuredRateLimitMax = RATE_LIMIT_MAX_REQUESTS;
}
function setRateLimitMaxRequests(limit) {
  configuredRateLimitMax = limit;
}
function checkRateLimit(clientKey, now = Date.now()) {
  const existing = rateLimitBuckets.get(clientKey);
  if (!existing || now >= existing.resetAt) {
    rateLimitBuckets.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return {
      allowed: true,
      remaining: Math.max(0, configuredRateLimitMax - 1),
      retryAfterSeconds: 0
    };
  }
  if (existing.count >= configuredRateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1e3));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, configuredRateLimitMax - existing.count),
    retryAfterSeconds: 0
  };
}
function sendJson(response, statusCode, body, extraHeaders) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}
async function readBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const declaredLength = Number(request.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiHttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds maximum size of ${maxBytes} bytes.`
    );
  }
  const parsedBody = request.body;
  let raw;
  if (parsedBody !== void 0) {
    raw = Buffer.isBuffer(parsedBody) ? parsedBody.toString("utf8") : parsedBody instanceof Uint8Array ? Buffer.from(parsedBody).toString("utf8") : typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody) ?? "";
    if (Buffer.byteLength(raw) > maxBytes) {
      throw new ApiHttpError(
        413,
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds maximum size of ${maxBytes} bytes.`
      );
    }
  } else {
    if (!request.readable) {
      return {};
    }
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        throw new ApiHttpError(
          413,
          "PAYLOAD_TOO_LARGE",
          `Request body exceeds maximum size of ${maxBytes} bytes.`
        );
      }
      chunks.push(buf);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  raw = raw.trim();
  if (!raw) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiHttpError(400, "INVALID_JSON_BODY", "Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiHttpError(400, "INVALID_BODY_OBJECT", "Request body must be a JSON object.");
  }
  return parsed;
}
async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const filePath = (0, import_node_path.resolve)(DIST_DIR, `.${decodedPath}`);
  const relativePath = (0, import_node_path.relative)(DIST_DIR, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${import_node_path.sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  let content;
  let contentType;
  try {
    const fileStat = await (0, import_promises.stat)(filePath);
    if (fileStat.isFile()) {
      content = await (0, import_promises.readFile)(filePath);
      contentType = MIME_TYPES[(0, import_node_path.extname)(filePath).toLowerCase()] ?? "application/octet-stream";
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
      throw error;
    }
  }
  if (!content && (!(0, import_node_path.extname)(decodedPath) || request.headers.accept?.includes("text/html"))) {
    const indexPath = (0, import_node_path.resolve)(DIST_DIR, "index.html");
    content = await (0, import_promises.readFile)(indexPath);
    contentType = MIME_TYPES[".html"];
  }
  if (!content || !contentType) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": decodedPath === "/" || (0, import_node_path.extname)(decodedPath) === "" ? "no-cache" : "public, max-age=31536000, immutable"
  });
  response.end(request.method === "HEAD" ? void 0 : content);
}
function getClientIp(request) {
  return request.socket?.remoteAddress ?? "127.0.0.1";
}
async function handleRequest(request, response) {
  const url = new import_node_url.URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname === "/health" ? "/api/health" : url.pathname === "/agent/plan" ? "/api/agent/plan" : url.pathname;
  if (request.method === "GET" && pathname === "/api/health") {
    const health = await getProviderHealth();
    const available = health.providerStatus === "AVAILABLE";
    sendJson(response, 200, {
      ok: available,
      provider: health.provider,
      providerStatus: health.providerStatus,
      model: health.model,
      available,
      mode: getRuntimeDisplayMode(health.provider, available, health.fallbackActive),
      providerMode: health.mode ?? null,
      fallbackActive: health.fallbackActive ?? false,
      fallbackReason: health.fallbackReason ?? null,
      status: health.providerStatus === "AVAILABLE" ? "configured" : "provider_unavailable",
      // Safe error class only; raw provider messages never leave the server.
      error: health.errorClass ?? (health.providerStatus === "AVAILABLE" ? null : "PROVIDER_UNAVAILABLE"),
      lastError: health.errorClass ?? null,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/agent/plan") {
    const clientIp = getClientIp(request);
    const rateStatus = checkRateLimit(clientIp);
    if (!rateStatus.allowed) {
      sendJson(
        response,
        429,
        {
          ok: false,
          errorCode: "RATE_LIMIT_EXCEEDED",
          error: "Too many requests. Please wait before retrying.",
          retryAfterSeconds: rateStatus.retryAfterSeconds
        },
        { "Retry-After": String(rateStatus.retryAfterSeconds) }
      );
      return;
    }
    let body;
    try {
      body = await readBody(request, MAX_REQUEST_BODY_BYTES);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        sendJson(response, error.statusCode, {
          ok: false,
          errorCode: error.errorCode,
          error: error.message
        });
        return;
      }
      throw error;
    }
    if (body.goal !== void 0 && typeof body.goal !== "string") {
      sendJson(response, 400, {
        ok: false,
        errorCode: "INVALID_GOAL_TYPE",
        error: "Field 'goal' must be a string."
      });
      return;
    }
    const rawGoal = typeof body.goal === "string" ? body.goal : "Compare rental subsidy options.";
    const trimmedGoal = rawGoal.trim();
    if (!trimmedGoal) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "EMPTY_GOAL",
        error: "Field 'goal' must not be empty."
      });
      return;
    }
    if (rawGoal.length > MAX_GOAL_LENGTH) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "GOAL_TOO_LONG",
        error: `Field 'goal' exceeds maximum length of ${MAX_GOAL_LENGTH} characters.`
      });
      return;
    }
    if (body.profile !== void 0 && (typeof body.profile !== "object" || body.profile === null || Array.isArray(body.profile))) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "INVALID_PROFILE",
        error: "Field 'profile' must be a JSON object."
      });
      return;
    }
    const allowlistedTools = listAllowedTools();
    const domain = detectBenefitDomain(trimmedGoal);
    const coverage = assessQueryCoverage(trimmedGoal);
    const defaultPlan = buildSafePlan(trimmedGoal, domain);
    const timeoutMs = Number(process.env.AGENT_PROVIDER_TIMEOUT_MS ?? DEFAULT_PROVIDER_TIMEOUT_MS);
    const plannerStarted = performance.now();
    const llmResult = await callPlanner({
      goal: trimmedGoal,
      availableTools: allowlistedTools,
      timeoutMs
    });
    const plannerLatencyMs = performance.now() - plannerStarted;
    const llmCallSucceeded = llmResult.providerStatus === "AVAILABLE" && Boolean(llmResult.decision);
    const lastAttempt = llmResult.attempts?.[llmResult.attempts.length - 1];
    const lastFailedAttempt = [...llmResult.attempts ?? []].reverse().find((attempt) => attempt.outcome === "FAILED" && attempt.callAttempted);
    const lastLlmFailureReason = lastFailedAttempt ? `${lastFailedAttempt.provider} \xB7 ${lastFailedAttempt.errorClass ?? "PROVIDER_UNAVAILABLE"}` : null;
    const responseProvider = llmResult.provider !== "UNAVAILABLE" ? llmResult.provider : lastAttempt?.provider ?? (llmResult.mode === "openai" ? "OPENAI" : llmResult.mode === "ollama" ? "OLLAMA" : "UNAVAILABLE");
    const responseModel = llmResult.model !== "N/A" ? llmResult.model : lastAttempt?.model ?? "N/A";
    const safeErrorCode = llmCallSucceeded ? null : llmResult.error === "AGENT_PROVIDER_TIMEOUT" ? "AGENT_PROVIDER_TIMEOUT" : llmResult.errorClass ?? "PROVIDER_UNAVAILABLE";
    const fallbackDecision = coverage.status === "NOT_COVERED" ? {
      reasoningSummary: coverage.message ?? "Request is outside covered policies; safe fallback stops without tool execution.",
      nextAction: "COMPLETE"
    } : domain === "CHILDCARE" ? {
      reasoningSummary: "Live provider unavailable; fallback to deterministic childcare plan.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_childcare_rules",
      toolArguments: {
        profile: body.profile ?? {}
      }
    } : {
      reasoningSummary: "Live provider unavailable; fallback to deterministic plan and tool allowlist.",
      nextAction: "CALL_TOOL",
      toolName: "evaluate_central_rules",
      toolArguments: {
        profile: body.profile ?? {}
      }
    };
    const responseBody = {
      ok: true,
      provider: responseProvider,
      providerStatus: llmResult.providerStatus,
      model: responseModel,
      available: llmCallSucceeded,
      mode: getRuntimeDisplayMode(
        responseProvider,
        llmCallSucceeded,
        !llmCallSucceeded || (llmResult.fallbackCount ?? 0) > 0
      ),
      goal: trimmedGoal,
      plan: defaultPlan,
      allowedTools: allowlistedTools,
      decision: llmResult.decision ?? fallbackDecision,
      metadata: {
        mode: llmResult.mode ?? null,
        usage: llmResult.usage ?? null,
        // Safe error class only; raw provider messages never leave the server.
        error: safeErrorCode,
        errorClass: llmCallSucceeded ? null : llmResult.errorClass ?? "PROVIDER_UNAVAILABLE",
        lastLlmFailureReason,
        llmCallAttempted: llmResult.callAttempted ?? false,
        llmCallSucceeded,
        llmCalls: (llmResult.attempts ?? []).filter((attempt) => attempt.callAttempted).length,
        plannerLatencyMs,
        attempts: (llmResult.attempts ?? []).map((attempt) => ({
          provider: attempt.provider,
          model: attempt.model,
          callAttempted: attempt.callAttempted,
          outcome: attempt.outcome,
          latencyMs: Math.round(attempt.latencyMs),
          errorClass: attempt.errorClass ?? null,
          inputTokens: attempt.usage?.inputTokens ?? null,
          outputTokens: attempt.usage?.outputTokens ?? null
        })),
        fallbackCount: llmResult.fallbackCount ?? 0,
        fallbackReason: llmResult.fallbackReason ?? null,
        providerEvents: llmResult.providerEvents ?? [],
        estimatedCloudCostUsd: llmResult.estimatedCloudCostUsd ?? null,
        pricingLabel: llmResult.pricingLabel ?? null
      }
    };
    sendJson(response, 200, responseBody);
    return;
  }
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    await serveStatic(request, response, url.pathname);
    return;
  }
  sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", error: "Not found" });
}
var import_promises, import_node_http, import_node_path, import_node_url, PORT, HOST, DIST_DIR, MAX_REQUEST_BODY_BYTES, MAX_GOAL_LENGTH, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, configuredRateLimitMax, rateLimitBuckets, ApiHttpError, MIME_TYPES, server;
var init_server = __esm({
  "src/server.ts"() {
    "use strict";
    import_promises = require("node:fs/promises");
    import_node_http = require("node:http");
    import_node_path = require("node:path");
    import_node_url = require("node:url");
    init_client();
    init_orchestrator();
    init_tools();
    init_types();
    init_coverage();
    try {
      process.loadEnvFile((0, import_node_path.resolve)(__dirname, "../.env"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    PORT = Number(process.env.PORT ?? 8787);
    HOST = "127.0.0.1";
    DIST_DIR = (0, import_node_path.resolve)(__dirname, "../dist");
    MAX_REQUEST_BODY_BYTES = 16 * 1024;
    MAX_GOAL_LENGTH = 800;
    RATE_LIMIT_WINDOW_MS = 6e4;
    RATE_LIMIT_MAX_REQUESTS = 20;
    configuredRateLimitMax = RATE_LIMIT_MAX_REQUESTS;
    rateLimitBuckets = /* @__PURE__ */ new Map();
    ApiHttpError = class extends Error {
      constructor(statusCode, errorCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
      }
    };
    MIME_TYPES = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".txt": "text/plain; charset=utf-8",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2"
    };
    server = (0, import_node_http.createServer)((request, response) => {
      void handleRequest(request, response).catch((error) => {
        console.error("Request failed", error);
        if (response.headersSent) {
          response.destroy(error instanceof Error ? error : void 0);
          return;
        }
        sendJson(response, 500, {
          ok: false,
          errorCode: "INTERNAL_SERVER_ERROR",
          error: "Internal server error"
        });
      });
    });
    if (typeof require !== "undefined" && require.main === module) {
      server.listen(PORT, HOST, () => {
        console.log(`GovAid Atlas production preview listening on http://${HOST}:${PORT}`);
      });
    }
  }
});

// src/vercel-handler.ts
var vercel_handler_exports = {};
__export(vercel_handler_exports, {
  default: () => handler
});
module.exports = __toCommonJS(vercel_handler_exports);
function sendError(response, errorCode, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, errorCode, error: message }));
}
async function handler(request, response) {
  let handleRequest2;
  try {
    ({ handleRequest: handleRequest2 } = await Promise.resolve().then(() => (init_server(), server_exports)));
  } catch (error) {
    console.error("Vercel backend initialization failed", error);
    sendError(response, "BACKEND_INITIALIZATION_FAILED", "Backend initialization failed.");
    return;
  }
  try {
    await handleRequest2(request, response);
  } catch (error) {
    console.error("Vercel API request failed", error);
    sendError(response, "INTERNAL_SERVER_ERROR", "Internal server error.");
  }
}
