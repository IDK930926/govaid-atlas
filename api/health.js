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

// src/agent/providers/mode.ts
function getProviderMode() {
  const raw = (typeof process !== "undefined" ? process.env?.AGENT_PROVIDER : void 0) ?? "auto";
  const normalized = raw.trim().toLowerCase() || "auto";
  return normalized === "auto" || normalized === "openai" || normalized === "ollama" ? normalized : null;
}
function getProviderChain(mode = getProviderMode()) {
  if (mode === "auto") return ["OPENAI", "OLLAMA"];
  if (mode === "openai") return ["OPENAI"];
  if (mode === "ollama") return ["OLLAMA"];
  return [];
}
var init_mode = __esm({
  "src/agent/providers/mode.ts"() {
    "use strict";
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
function positiveInt(raw, fallback) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function getOllamaTimeoutMs() {
  return positiveInt(getEnv().OLLAMA_TIMEOUT_MS, DEFAULT_OLLAMA_TIMEOUT_MS);
}
function getOllamaHealthTimeoutMs() {
  return positiveInt(getEnv().OLLAMA_HEALTH_TIMEOUT_MS, DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS);
}
async function healthCheckOllama(signal) {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();
  try {
    const timeout = AbortSignal.timeout(getOllamaHealthTimeoutMs());
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
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
      errorClass: classifyThrownError(error) === "TIMEOUT" ? "TIMEOUT" : "PROVIDER_UNAVAILABLE"
    };
  }
}
async function callOllamaPlanner(input) {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();
  const health = await healthCheckOllama(input.signal);
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
      body: JSON.stringify(payload),
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(getOllamaTimeoutMs())]) : AbortSignal.timeout(getOllamaTimeoutMs())
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
var DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS, DEFAULT_OLLAMA_TIMEOUT_MS;
var init_ollama = __esm({
  "src/agent/providers/ollama.ts"() {
    "use strict";
    init_types();
    init_mode();
    DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";
    DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS = 2e3;
    DEFAULT_OLLAMA_TIMEOUT_MS = 8e3;
  }
});

// src/agent/providers/openai.ts
function getEnv2() {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }
  return process.env;
}
function positiveInt2(raw, fallback) {
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
  return positiveInt2(getEnv2().OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS);
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
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(getOpenAITimeoutMs())]) : AbortSignal.timeout(getOpenAITimeoutMs())
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
    DEFAULT_OPENAI_TIMEOUT_MS = 8e3;
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
function positiveEnvMs(name) {
  const value = Number(process.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : void 0;
}
function getTimeoutMs(explicitTimeoutMs) {
  if (typeof explicitTimeoutMs === "number" && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }
  return positiveEnvMs("AGENT_PROVIDER_TIMEOUT_MS") ?? DEFAULT_PROVIDER_TIMEOUT_MS;
}
function getPlannerBudgetMs(attemptTimeoutMs) {
  return Math.max(attemptTimeoutMs, positiveEnvMs("AGENT_PLANNER_BUDGET_MS") ?? DEFAULT_PLANNER_BUDGET_MS);
}
async function callProviderWithTimeout(provider, model, caller, input, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    const timeoutPromise = new Promise((resolveTimeout) => {
      timer = setTimeout(() => {
        controller.abort();
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
    const requestInput = { ...input, timeoutMs, signal: controller.signal };
    const request = provider === "OPENAI" ? caller(requestInput, model) : caller(requestInput);
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
  const budgetMs = getPlannerBudgetMs(timeoutMs);
  const chainStarted = now();
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
        result: { provider, providerStatus: "UNAVAILABLE", model, callAttempted: false, error: "OPENAI_MISSING_API_KEY", errorClass: "MISSING_API_KEY" },
        latencyMs: 0
      });
    } else {
      const callModel = async (attemptModel) => {
        const remainingBudgetMs = budgetMs - Math.max(0, now() - chainStarted);
        const minimumBudgetMs = Math.min(MIN_ATTEMPT_BUDGET_MS, timeoutMs / 2);
        if (remainingBudgetMs < (index > 0 || providerResults.length > 0 ? minimumBudgetMs : 1)) {
          const skipped = {
            provider,
            providerStatus: "UNAVAILABLE",
            model: attemptModel,
            callAttempted: false,
            error: "AGENT_PLANNER_BUDGET_EXHAUSTED",
            errorClass: "TIMEOUT"
          };
          providerResults.push({ model: attemptModel, result: skipped, latencyMs: 0 });
          return skipped;
        }
        emit("AGENT_PROVIDER_CALL_STARTED", { provider, model: attemptModel });
        const started = now();
        let result2;
        try {
          result2 = await callProviderWithTimeout(
            provider,
            attemptModel,
            callers[provider],
            input,
            Math.min(timeoutMs, remainingBudgetMs)
          );
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
var DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_PLANNER_BUDGET_MS, MIN_ATTEMPT_BUDGET_MS, PROVIDER_LABEL;
var init_client = __esm({
  "src/agent/client.ts"() {
    "use strict";
    init_ollama();
    init_openai();
    init_pricing();
    init_mode();
    DEFAULT_PROVIDER_TIMEOUT_MS = 8e3;
    DEFAULT_PLANNER_BUDGET_MS = 1e4;
    MIN_ATTEMPT_BUDGET_MS = 1e3;
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

// src/taiwan-cities.ts
function normalizeCityName(city) {
  const trimmed = city?.trim();
  if (!trimmed) {
    return void 0;
  }
  return trimmed.replace(/^台/, "\u81FA");
}
var TAIWAN_CITIES;
var init_taiwan_cities = __esm({
  "src/taiwan-cities.ts"() {
    "use strict";
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

// src/fact-extraction.ts
function isThousandsComma(text, index) {
  if (!/\d/.test(text[index - 1] ?? "")) return false;
  const group = text.slice(index + 1, index + 4);
  if (!/^\d{3}$/.test(group)) return false;
  if (/\d/.test(text[index + 4] ?? "")) return false;
  let start = index - 1;
  while (start >= 0 && /\d/.test(text[start])) start -= 1;
  const lead = index - 1 - start;
  if (lead <= 3) return true;
  return false;
}
function segment(text, separators) {
  const clauses = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    const isBreak = i === text.length || separators.has(ch) || ch === "," && !isThousandsComma(text, i);
    if (isBreak) {
      if (i > start) clauses.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return clauses;
}
function splitClauses(text) {
  return segment(text, HARD_SEPARATORS);
}
function splitSentences(text) {
  return segment(text, SENTENCE_SEPARATORS);
}
function parseCnSmall(token) {
  if (!token) return void 0;
  if (/^[一二兩三四五六七八九]$/.test(token)) return CN_DIGIT[token];
  const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(token);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  return void 0;
}
function parseAmountAt(text, index) {
  const rest = text.slice(index);
  const arabic = /^(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?(?:\s*(萬)\s*(\d{1,4})?|\s*(千))?/.exec(rest);
  if (arabic) {
    const whole = Number(arabic[1].replace(/,/g, ""));
    const frac = arabic[2] ? Number(`0.${arabic[2]}`) : 0;
    let value = whole + frac;
    if (arabic[3]) {
      value *= 1e4;
      if (arabic[4]) {
        const tail = arabic[4];
        value += tail.length === 1 ? Number(tail) * 1e3 : Number(tail);
      }
    } else if (arabic[5]) {
      value *= 1e3;
    }
    return { value: Math.round(value), start: index, end: index + arabic[0].length, text: arabic[0] };
  }
  const cn = /^([一二兩三四五六七八九十]{1,3})萬(?:([一二兩三四五六七八九])(千)?)?/.exec(rest);
  if (cn) {
    const head = parseCnSmall(cn[1]);
    if (head === void 0) return void 0;
    const value = head * 1e4 + (cn[2] ? CN_DIGIT[cn[2]] * 1e3 : 0);
    return { value, start: index, end: index + cn[0].length, text: cn[0] };
  }
  return void 0;
}
function amountAfterCue(clause, cue, options = {}) {
  const maxGap = options.maxGap ?? 8;
  const global = new RegExp(cue.source, cue.flags.includes("g") ? cue.flags : cue.flags + "g");
  for (const match of clause.text.matchAll(global)) {
    const afterCue = (match.index ?? 0) + match[0].length;
    for (let gap = 0; gap <= maxGap && afterCue + gap < clause.text.length; gap += 1) {
      const ch = clause.text[afterCue + gap];
      if (/[\d一二兩三四五六七八九十]/.test(ch)) {
        const gapText = clause.text.slice(afterCue, afterCue + gap);
        if (options.forbiddenGap && options.forbiddenGap.test(gapText)) break;
        const parsed = parseAmountAt(clause.text, afterCue + gap);
        if (!parsed) {
          if (/\d/.test(ch)) break;
          continue;
        }
        if (FOREIGN_UNIT.test(clause.text.slice(parsed.end))) break;
        return {
          ...parsed,
          start: clause.start + parsed.start,
          end: clause.start + parsed.end,
          cueStart: clause.start + (match.index ?? 0)
        };
      }
    }
  }
  return void 0;
}
function cityCandidates(token) {
  if (token === "\u5317\u5E02") return ["\u81FA\u5317\u5E02"];
  const normalized = normalizeCityName(token);
  if (!normalized) return [];
  if (TAIWAN_CITIES.includes(normalized)) return [normalized];
  return TAIWAN_CITIES.filter((city) => city.slice(0, -1) === normalized);
}
function districtCities(name) {
  return DISTRICT_INDEX.get(name.replace(/區$/, "")) ?? [];
}
function findRawLocations(text) {
  const found = [];
  const cityAlt = [...CITY_TOKENS, "\u5317\u5E02"].map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const districtAlt = DISTRICT_NAMES.join("|");
  const pattern = new RegExp(`(?:(${cityAlt})\\s*(?:(${districtAlt})(\u5340)?)?)|(?:(${districtAlt})(\u5340))|(${districtAlt})`, "g");
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const [whole, cityTok, cityDistrict, cityDistrictSuffix, soloDistrictWithSuffix, , bareDistrict] = match;
    if (cityTok) {
      if (cityTok === "\u5317\u5E02" && /[新臺台]$/.test(text.slice(0, index))) continue;
      let district;
      let length = whole.length;
      if (cityDistrict) {
        const candidates = districtCities(cityDistrict);
        const hint = cityCandidates(cityTok);
        const fits = candidates.filter((city) => hint.includes(city));
        const singleChar = cityDistrict.length === 1;
        if (fits.length > 0 && (!singleChar || cityDistrictSuffix) && !NOT_A_PLACE_AFTER.test(text.slice(index + whole.length))) {
          district = cityDistrict;
        } else {
          length = cityTok.length;
        }
      }
      found.push({
        start: index,
        end: index + length,
        text: text.slice(index, index + length),
        cityHint: cityCandidates(cityTok),
        district: district ? `${district}\u5340` : void 0,
        districtCandidates: district ? districtCities(district) : []
      });
      continue;
    }
    const name = soloDistrictWithSuffix ?? bareDistrict;
    if (!name) continue;
    if (bareDistrict && (NO_BARE.has(bareDistrict) || NOT_A_PLACE_AFTER.test(text.slice(index + whole.length)))) continue;
    found.push({
      start: index,
      end: index + whole.length,
      text: whole,
      cityHint: [],
      district: `${name}\u5340`,
      districtCandidates: districtCities(name)
    });
  }
  return found;
}
function classifyRole(text, clause, start, end) {
  const before = text.slice(clause.start, start);
  const after = text.slice(end, clause.end);
  if (WITHDRAWN.test(clause.text)) return "WITHDRAWN";
  if (/(?:改查|改成只看|改成|改看|改為|換成|只看|只比較|改問)\s*$/.test(before)) return "RENTAL";
  if (/(?:戶籍|設籍|籍)(?:地)?(?:設)?(?:在|於|為|是)?\s*$/.test(before) || /^\s*(?:的)?戶籍/.test(after) || /^[^，。]{0,6}(?:登記|設(?:有)?)戶籍/.test(after)) {
    return "REGISTRATION";
  }
  if (/(?:搬到|搬去|搬至|搬往)\s*$/.test(before)) return "MOVE";
  const clauseText = clause.text;
  if (/^(?:市|縣)?(?:政府|市府|縣府)?(?:自辦|自己的|地方|的地方|青年|市)?[^，。]{0,6}?(?:租補|租金補貼|租金加碼|加碼|方案|租屋補助)/.test(after) && !/^\s*(?:\S{0,3})?租(?!補|金補|金加碼|屋補)/.test(after)) {
    return "PROGRAM";
  }
  if (/^[^，。]{0,4}(?:名下)?(?:有|持有|擁有)[^，。租]{0,14}(?:住宅|房子|房屋|房產|自宅)/.test(after) || /名下\s*(?:在)?\s*$/.test(before)) {
    return "PROPERTY";
  }
  const rentalWord = /租(?!補|金補|金加碼|屋補)/;
  if (/(?:住在|居住在|居住於|住|租屋在|租屋於|租在|租)\s*$/.test(before) || rentalWord.test(after) || rentalWord.test(clauseText) && !/^\s*(?:上班|工作)/.test(after)) {
    return "RENTAL";
  }
  if (/^\s*(?:上班|工作|唸書|念書|讀書|就學|就業|就讀)/.test(after) || /(?:工作在|就讀於|上班在)\s*$/.test(before)) {
    return "WORK_STUDY";
  }
  return "LOCATION";
}
function extractLocations(text) {
  return extractAllLocations(text).filter((loc) => loc.role !== "WITHDRAWN");
}
function extractAllLocations(text) {
  const raw = findRawLocations(text);
  const clauses = splitClauses(text);
  const hintCities = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (item.cityHint.length === 1) hintCities.add(item.cityHint[0]);
    else if (!item.cityHint.length && item.districtCandidates.length === 1) hintCities.add(item.districtCandidates[0]);
  }
  return raw.map((item) => {
    const clause = clauses.find((c) => item.start >= c.start && item.start < c.end) ?? { start: 0, end: text.length, text };
    let city;
    if (item.cityHint.length && item.districtCandidates.length) {
      const fits = item.districtCandidates.filter((candidate) => item.cityHint.includes(candidate));
      city = fits.length === 1 ? fits[0] : void 0;
    } else if (item.cityHint.length) {
      city = item.cityHint.length === 1 ? item.cityHint[0] : void 0;
    } else if (item.districtCandidates.length === 1) {
      city = item.districtCandidates[0];
    } else if (item.districtCandidates.length > 1) {
      const fits = item.districtCandidates.filter((candidate) => hintCities.has(candidate));
      city = fits.length === 1 ? fits[0] : void 0;
    }
    return {
      start: item.start,
      end: item.end,
      text: item.text,
      cityHint: item.cityHint,
      district: city ? item.district : void 0,
      city,
      role: classifyRole(text, clause, item.start, item.end)
    };
  });
}
function hedgedBefore(text, clause, index) {
  return HEDGE.test(text.slice(clause.start, index));
}
function clauseHits(text, pattern, guard) {
  const hits = [];
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const clause of splitClauses(text)) {
    for (const match of clause.text.matchAll(global)) {
      const hit = { start: clause.start + (match.index ?? 0), end: clause.start + (match.index ?? 0) + match[0].length, text: match[0] };
      if (hedgedBefore(text, clause, hit.start)) continue;
      if (guard && !guard(hit, clause)) continue;
      hits.push(hit);
    }
  }
  return hits;
}
function booleanFact(field, positive, negative, clarification, source = "EXPLICIT") {
  if (positive.length && negative.length) {
    return { field, state: "CONFLICT", candidates: [true, false], spans: [...negative, ...positive], source, clarification };
  }
  if (positive.length) return { field, state: "KNOWN_TRUE", value: true, spans: positive, source };
  if (negative.length) return { field, state: "KNOWN_FALSE", value: false, spans: negative, source };
  return void 0;
}
function markHedged(text, facts, field, mention, exclude) {
  if (facts[field]) return;
  for (const sentence of splitSentences(text)) {
    const hit = mention.exec(sentence.text);
    if (!hit || !HEDGE.test(sentence.text)) continue;
    if (exclude && exclude.test(sentence.text.slice(Math.max(0, hit.index - 3), hit.index + hit[0].length + 3))) continue;
    const start = sentence.start + hit.index;
    facts[field] = { field, state: "UNKNOWN", spans: [{ start, end: start + hit[0].length, text: hit[0] }], source: "EXPLICIT", note: "HEDGED" };
    return;
  }
}
function quote(spans, index) {
  return spans[index]?.text ?? "";
}
function extractAge(text, facts) {
  for (const clause of splitClauses(text)) {
    const explicit = /年齡\s*(?:為|是|:)?\s*(\d{1,3})(?!\d)/.exec(clause.text);
    if (explicit) {
      const age = Number(explicit[1]);
      if (age >= 0 && age <= 130) {
        const start = clause.start + (explicit.index ?? 0);
        facts.age = { field: "age", state: "KNOWN_VALUE", value: age, spans: [{ start, end: start + explicit[0].length, text: explicit[0] }], source: "EXPLICIT" };
        return;
      }
    }
    for (const match of clause.text.matchAll(/(\d{1,3})\s*歲/g)) {
      const index = match.index ?? 0;
      const before = clause.text.slice(Math.max(0, index - 2), index);
      const after = clause.text.slice(index + match[0].length, index + match[0].length + 3);
      if (/(?:未滿|不滿|年滿|超過|高於|低於|以上|以下)$/.test(before) || /滿$/.test(before) && !/(?:剛|已)滿$/.test(before)) continue;
      if (/^\s*(?:以上|以下|至|到|~|-|－|個月|半)/.test(after)) continue;
      if (/\d|,/.test(clause.text[index - 1] ?? "")) continue;
      const age = Number(match[1]);
      if (age >= 0 && age <= 130) {
        const start = clause.start + index;
        facts.age = { field: "age", state: "KNOWN_VALUE", value: age, spans: [{ start, end: start + match[0].length, text: match[0] }], source: "EXPLICIT" };
        return;
      }
    }
  }
}
function extractIncome(text, facts) {
  for (const clause of splitClauses(text)) {
    const hit = amountAfterCue(clause, INCOME_CUE, { maxGap: 8, forbiddenGap: /租|歲/ });
    if (!hit) continue;
    const span = { start: hit.cueStart, end: hit.end, text: text.slice(hit.cueStart, hit.end) };
    if (hit.value < 0 || hit.value > 5e6) {
      facts.monthlyIncome = { field: "monthlyIncome", state: "UNKNOWN", spans: [span], source: "EXPLICIT", note: "IMPLAUSIBLE_VALUE" };
      return;
    }
    const perPerson = /人均|每人|平均每人|每個人/.test(clause.text);
    const householdTotal = /全戶|全家|合計|總共|一共|總所得|總收入|家戶總/.test(clause.text);
    if (householdTotal && !perPerson) {
      facts.monthlyIncome = { field: "monthlyIncome", state: "UNKNOWN", spans: [span], source: "EXPLICIT", note: "HOUSEHOLD_TOTAL_NOT_PER_PERSON" };
      return;
    }
    facts.monthlyIncome = { field: "monthlyIncome", state: "KNOWN_VALUE", value: hit.value, spans: [span], source: "EXPLICIT" };
    return;
  }
}
function rentHits(text, from = 0, to = text.length) {
  const hits = [];
  for (const clause of splitClauses(text)) {
    if (clause.end <= from || clause.start >= to) continue;
    const scoped = {
      start: Math.max(clause.start, from),
      end: Math.min(clause.end, to),
      text: text.slice(Math.max(clause.start, from), Math.min(clause.end, to))
    };
    let cursor = scoped;
    for (let guard = 0; guard < 4; guard += 1) {
      const hit = amountAfterCue(cursor, RENT_CUE, { maxGap: 8, forbiddenGap: /所得|收入|月入|薪|歲|年齡|補/ });
      if (!hit) break;
      hits.push(hit);
      const tail = text.slice(hit.end, scoped.end);
      const listed = /^\s*(?:元)?\s*(?:和|與|跟|、|及)\s*/.exec(tail);
      if (listed) {
        const second = parseAmountAt(text, hit.end + listed[0].length);
        if (second && !FOREIGN_UNIT.test(text.slice(second.end))) {
          hits.push({ ...second, cueStart: hit.cueStart });
        }
      }
      const nextStart = hit.end;
      if (nextStart >= scoped.end) break;
      cursor = { start: nextStart, end: scoped.end, text: text.slice(nextStart, scoped.end) };
    }
  }
  return hits.filter((hit) => hit.value >= 500 && hit.value <= 3e5);
}
function extractHousingBooleans(text, facts) {
  const ownsFalse = clauseHits(text, OWNS_HOME_FALSE);
  const ownsTrue = clauseHits(text, OWNS_HOME_TRUE, (hit) => !/租/.test(hit.text));
  const owns = booleanFact("ownsHome", ownsTrue, ownsFalse, "");
  if (owns) {
    if (owns.state === "CONFLICT") {
      owns.clarification = `\u4F60\u524D\u9762\u540C\u6642\u63D0\u5230\u300C${quote(ownsFalse, 0)}\u300D\u8207\u300C${quote(ownsTrue, 0)}\u300D\uFF0C\u8ACB\u78BA\u8A8D\uFF1A\u672C\u4EBA\u6216\u4F9D\u6CD5\u5217\u8A08\u7684\u5BB6\u5EAD\u6210\u54E1\u76EE\u524D\u662F\u5426\u6301\u6709\u4F4F\u5B85\uFF1F`;
    }
    facts.ownsHome = owns;
  }
  const aidFalse = clauseHits(text, OTHER_AID_FALSE, (hit) => !/托育|育兒/.test(text.slice(Math.max(0, hit.start - 2), hit.end)));
  const aidTrue = clauseHits(text, OTHER_AID_TRUE);
  const aid = booleanFact("receivesOtherHousingAid", aidTrue, aidFalse, "");
  if (aid) {
    if (aid.state === "CONFLICT") {
      aid.clarification = `\u4F60\u524D\u9762\u540C\u6642\u63D0\u5230\u300C${quote(aidFalse, 0)}\u300D\u8207\u300C${quote(aidTrue, 0)}\u300D\uFF0C\u8ACB\u78BA\u8A8D\uFF1A\u76EE\u524D\u662F\u5426\u6B63\u5728\u9818\u53D6\u5176\u4ED6\u653F\u5E9C\u4F4F\u5B85\u88DC\u8CBC\u6216\u79DF\u91D1\u88DC\u8CBC\uFF1F`;
    }
    facts.receivesOtherHousingAid = aid;
  }
}
function extractHousingFactsTyped(text) {
  const facts = {};
  const locations = extractLocations(text);
  const result = { facts, locations };
  const move = /(?:搬到|搬去|搬至|搬往)/.exec(text);
  const moveIndex = move ? move.index : text.length;
  const registration = locations.find((loc) => loc.role === "REGISTRATION" && loc.city);
  if (registration?.city) {
    facts.registeredCity = { field: "registeredCity", state: "KNOWN_VALUE", value: registration.city, spans: [registration], source: registration.district && !registration.cityHint.length ? "DISTRICT_INFERENCE" : "EXPLICIT" };
  }
  const moveLoc = locations.find((loc) => loc.role === "MOVE" && loc.city);
  if (moveLoc?.city) {
    result.whatIfCity = moveLoc.city;
    result.whatIfDistrict = moveLoc.district;
    const sentenceEnd = (() => {
      const after = text.slice(moveLoc.start).search(/[。？?！!]/);
      return after === -1 ? text.length : moveLoc.start + after;
    })();
    const whatIfRent = rentHits(text, moveLoc.start, sentenceEnd)[0];
    if (whatIfRent) result.whatIfMonthlyRent = whatIfRent.value;
  }
  const beforeMove = locations.filter((loc) => loc.start < moveIndex);
  const rentals = beforeMove.filter((loc) => loc.role === "RENTAL" && loc.city);
  const distinctRentalCities = [...new Set(rentals.map((loc) => loc.city))];
  const comparison = /比較|比租|分開|分別|兩處|兩地|兩邊/.test(text);
  const rents = rentHits(text, 0, moveLoc ? moveLoc.start : text.length);
  let residence;
  const competingRentals = !moveLoc && !comparison && distinctRentalCities.length >= 2;
  if (competingRentals) {
    facts.city = {
      field: "city",
      state: "CONFLICT",
      candidates: distinctRentalCities,
      spans: rentals,
      source: "EXPLICIT",
      clarification: `\u4F60\u63D0\u5230\u5728${distinctRentalCities.join("\u8207")}\u90FD\u6709\u79DF\u5C4B\uFF0C\u8ACB\u554F\u672C\u6B21\u7533\u8ACB\u4F7F\u7528\u7684\u662F\u54EA\u4E00\u500B\u7E23\u5E02\u7684\u79DF\u7D04\uFF1F`
    };
  } else if (rentals.length) {
    residence = rentals[0];
  } else {
    const plain = beforeMove.filter((loc) => loc.role === "LOCATION" && loc.city);
    const cities = [...new Set(plain.map((loc) => loc.city))];
    if (cities.length === 1) residence = plain[0];
  }
  if (!moveLoc && comparison && distinctRentalCities.length >= 2) {
    const second = rentals.find((loc) => loc.city !== rentals[0].city);
    result.whatIfCity = second.city;
    result.whatIfDistrict = second.district;
    result.dualCityComparison = true;
    const firstRent = rents.find((hit) => hit.start > rentals[0].start && hit.start < second.start) ?? rents[0];
    const secondRent = rents.find((hit) => hit.start > second.start && hit !== firstRent) ?? rents.find((hit) => hit !== firstRent);
    if (firstRent) facts.monthlyRent = { field: "monthlyRent", state: "KNOWN_VALUE", value: firstRent.value, spans: [firstRent], source: "EXPLICIT" };
    if (secondRent) result.whatIfMonthlyRent = secondRent.value;
  } else if (rents.length) {
    const values = [...new Set(rents.map((hit) => hit.value))];
    if (values.length === 1) {
      facts.monthlyRent = { field: "monthlyRent", state: "KNOWN_VALUE", value: values[0], spans: [rents[0]], source: "EXPLICIT" };
    } else {
      facts.monthlyRent = {
        field: "monthlyRent",
        state: "CONFLICT",
        candidates: values,
        spans: rents,
        source: "EXPLICIT",
        clarification: `\u4F60\u63D0\u5230\u7684\u6708\u79DF\u91D1\u6709 ${values.map((v) => v.toLocaleString()).join(" \u8207 ")} \u5143\u5169\u7A2E\uFF0C\u8ACB\u78BA\u8A8D\u4F9D\u79DF\u7D04\u4F60\u672C\u4EBA\u5BE6\u969B\u6BCF\u6708\u8CA0\u64D4\u7684\u79DF\u91D1\u3002`
      };
    }
  }
  if (residence?.city) {
    facts.city = {
      field: "city",
      state: "KNOWN_VALUE",
      value: residence.city,
      spans: [residence],
      source: residence.cityHint.length ? "EXPLICIT" : "DISTRICT_INFERENCE"
    };
    if (residence.district) result.district = residence.district;
  } else if (!competingRentals) {
    const ambiguous = beforeMove.find((loc) => (loc.role === "RENTAL" || loc.role === "LOCATION") && !loc.city);
    if (ambiguous) {
      facts.city = {
        field: "city",
        state: "UNKNOWN",
        spans: [ambiguous],
        source: "EXPLICIT",
        note: "AMBIGUOUS_PLACE_NAME",
        clarification: `\u300C${ambiguous.text}\u300D\u53EF\u80FD\u4F4D\u65BC\u4E0D\u540C\u7E23\u5E02\uFF0C\u8ACB\u554F\u60A8\u7684\u79DF\u5C4B\u8655\u4F4D\u65BC\u54EA\u500B\u7E23\u5E02\uFF1F`
      };
    }
  }
  const ntpcLink = locations.find((loc) => loc.city === "\u65B0\u5317\u5E02" && (loc.role === "WORK_STUDY" || loc.role === "REGISTRATION"));
  if (ntpcLink || /(?:在新北(?:市)?(?:上班|工作|唸書|念書|讀書|就學|就業)|工作在新北)/.test(text)) {
    facts.newTaipeiResidenceStudyWork = {
      field: "newTaipeiResidenceStudyWork",
      state: "KNOWN_TRUE",
      value: true,
      spans: ntpcLink ? [ntpcLink] : [],
      source: "EXPLICIT"
    };
  }
  extractAge(text, facts);
  extractIncome(text, facts);
  extractHousingBooleans(text, facts);
  markHedged(text, facts, "ownsHome", /房屋持有|有房|房產|自有住宅|名下[^，。]{0,6}房|家裡[^，。]{0,4}房/);
  markHedged(text, facts, "receivesOtherHousingAid", /(?:住宅|租金|租屋)?(?:補助|補貼|協助)/, /托育|育兒/);
  return result;
}
var HARD_SEPARATORS, SENTENCE_SEPARATORS, CN_DIGIT, FOREIGN_UNIT, DISTRICTS, NO_BARE, DISTRICT_INDEX, DISTRICT_NAMES, CITY_TOKENS, NOT_A_PLACE_AFTER, WITHDRAWN, HEDGE, RENT_CUE, INCOME_CUE, HOME_NOUN, OWNS_HOME_FALSE, OWNS_HOME_TRUE, OTHER_AID_FALSE, OTHER_AID_TRUE;
var init_fact_extraction = __esm({
  "src/fact-extraction.ts"() {
    "use strict";
    init_taiwan_cities();
    HARD_SEPARATORS = /* @__PURE__ */ new Set(["\uFF0C", "\u3002", "\uFF1B", ";", "\uFF01", "!", "\uFF1F", "?", "\n", "\uFF1A", "\uFE30"]);
    SENTENCE_SEPARATORS = /* @__PURE__ */ new Set(["\u3002", "\uFF01", "!", "\uFF1F", "?", "\n", "\uFF1B", ";"]);
    CN_DIGIT = { \u96F6: 0, \u4E00: 1, \u4E8C: 2, \u5169: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u4E03: 7, \u516B: 8, \u4E5D: 9 };
    FOREIGN_UNIT = /^\s*(?:歲|個月|月大|年|胎|小時|人|口|坪|%|％|次|天|週|周|間|戶)/;
    DISTRICTS = {
      \u81FA\u5317\u5E02: ["\u4E2D\u6B63", "\u5927\u540C", "\u4E2D\u5C71", "\u677E\u5C71", "\u5927\u5B89", "\u842C\u83EF", "\u4FE1\u7FA9", "\u58EB\u6797", "\u5317\u6295", "\u5167\u6E56", "\u5357\u6E2F", "\u6587\u5C71"],
      \u65B0\u5317\u5E02: [
        "\u677F\u6A4B",
        "\u4E09\u91CD",
        "\u4E2D\u548C",
        "\u6C38\u548C",
        "\u65B0\u838A",
        "\u65B0\u5E97",
        "\u6A39\u6797",
        "\u9DAF\u6B4C",
        "\u4E09\u5CFD",
        "\u6DE1\u6C34",
        "\u6C50\u6B62",
        "\u745E\u82B3",
        "\u571F\u57CE",
        "\u8606\u6D32",
        "\u4E94\u80A1",
        "\u6CF0\u5C71",
        "\u6797\u53E3",
        "\u6DF1\u5751",
        "\u77F3\u7887",
        "\u576A\u6797",
        "\u4E09\u829D",
        "\u77F3\u9580",
        "\u516B\u91CC",
        "\u5E73\u6EAA",
        "\u96D9\u6EAA",
        "\u8CA2\u5BEE",
        "\u91D1\u5C71",
        "\u842C\u91CC",
        "\u70CF\u4F86"
      ],
      \u6843\u5712\u5E02: ["\u6843\u5712", "\u4E2D\u58E2", "\u5927\u6EAA", "\u694A\u6885", "\u8606\u7AF9", "\u5927\u5712", "\u9F9C\u5C71", "\u516B\u5FB7", "\u9F8D\u6F6D", "\u5E73\u93AE", "\u65B0\u5C4B", "\u89C0\u97F3", "\u5FA9\u8208"],
      \u81FA\u4E2D\u5E02: [
        "\u4E2D",
        "\u6771",
        "\u5357",
        "\u897F",
        "\u5317",
        "\u5317\u5C6F",
        "\u897F\u5C6F",
        "\u5357\u5C6F",
        "\u592A\u5E73",
        "\u5927\u91CC",
        "\u9727\u5CF0",
        "\u70CF\u65E5",
        "\u8C50\u539F",
        "\u540E\u91CC",
        "\u77F3\u5CA1",
        "\u6771\u52E2",
        "\u548C\u5E73",
        "\u65B0\u793E",
        "\u6F6D\u5B50",
        "\u5927\u96C5",
        "\u795E\u5CA1",
        "\u5927\u809A",
        "\u6C99\u9E7F",
        "\u9F8D\u4E95",
        "\u68A7\u68F2",
        "\u6E05\u6C34",
        "\u5927\u7532",
        "\u5916\u57D4",
        "\u5927\u5B89"
      ],
      \u81FA\u5357\u5E02: [
        "\u4E2D\u897F",
        "\u6771",
        "\u5357",
        "\u5317",
        "\u5B89\u5E73",
        "\u5B89\u5357",
        "\u6C38\u5EB7",
        "\u6B78\u4EC1",
        "\u65B0\u5316",
        "\u5DE6\u93AE",
        "\u7389\u4E95",
        "\u6960\u897F",
        "\u5357\u5316",
        "\u4EC1\u5FB7",
        "\u95DC\u5EDF",
        "\u9F8D\u5D0E",
        "\u5B98\u7530",
        "\u9EBB\u8C46",
        "\u4F73\u91CC",
        "\u897F\u6E2F",
        "\u4E03\u80A1",
        "\u5C07\u8ECD",
        "\u5B78\u7532",
        "\u5317\u9580",
        "\u65B0\u71DF",
        "\u5F8C\u58C1",
        "\u767D\u6CB3",
        "\u6771\u5C71",
        "\u516D\u7532",
        "\u4E0B\u71DF",
        "\u67F3\u71DF",
        "\u9E7D\u6C34",
        "\u5584\u5316",
        "\u5927\u5167",
        "\u5C71\u4E0A",
        "\u65B0\u5E02",
        "\u5B89\u5B9A"
      ],
      \u9AD8\u96C4\u5E02: [
        "\u6960\u6893",
        "\u5DE6\u71DF",
        "\u9F13\u5C71",
        "\u4E09\u6C11",
        "\u9E7D\u57D5",
        "\u524D\u91D1",
        "\u65B0\u8208",
        "\u82D3\u96C5",
        "\u524D\u93AE",
        "\u65D7\u6D25",
        "\u5C0F\u6E2F",
        "\u9CF3\u5C71",
        "\u6797\u5712",
        "\u5927\u5BEE",
        "\u5927\u6A39",
        "\u5927\u793E",
        "\u4EC1\u6B66",
        "\u9CE5\u677E",
        "\u5CA1\u5C71",
        "\u6A4B\u982D",
        "\u71D5\u5DE2",
        "\u7530\u5BEE",
        "\u963F\u84EE",
        "\u8DEF\u7AF9",
        "\u6E56\u5167",
        "\u8304\u8423",
        "\u6C38\u5B89",
        "\u5F4C\u9640",
        "\u6893\u5B98",
        "\u65D7\u5C71",
        "\u7F8E\u6FC3",
        "\u516D\u9F9C",
        "\u7532\u4ED9",
        "\u6749\u6797",
        "\u5167\u9580",
        "\u8302\u6797",
        "\u6843\u6E90",
        "\u90A3\u746A\u590F"
      ],
      \u57FA\u9686\u5E02: ["\u4EC1\u611B", "\u4FE1\u7FA9", "\u4E2D\u6B63", "\u4E2D\u5C71", "\u5B89\u6A02", "\u6696\u6696", "\u4E03\u5835"],
      \u65B0\u7AF9\u5E02: ["\u6771", "\u5317", "\u9999\u5C71"],
      \u5609\u7FA9\u5E02: ["\u6771", "\u897F"]
    };
    NO_BARE = /* @__PURE__ */ new Set([
      "\u4E2D",
      "\u6771",
      "\u5357",
      "\u897F",
      "\u5317",
      "\u6843\u5712",
      "\u4E2D\u6B63",
      "\u4E2D\u5C71",
      "\u4FE1\u7FA9",
      "\u4EC1\u611B",
      "\u5927\u540C",
      "\u592A\u5E73",
      "\u548C\u5E73",
      "\u6E05\u6C34",
      "\u5B89\u5B9A",
      "\u5C71\u4E0A",
      "\u5927\u5167",
      "\u5C07\u8ECD",
      "\u5317\u9580",
      "\u6C38\u5B89",
      "\u65B0\u8208",
      "\u5927\u6A39",
      "\u4EC1\u5FB7",
      "\u5FA9\u8208",
      "\u89C0\u97F3",
      "\u6771\u5C71",
      "\u65B0\u5C4B",
      "\u65B0\u5E02",
      "\u4E2D\u897F",
      "\u9E7D\u6C34",
      "\u5F4C\u9640",
      "\u6A4B\u982D",
      "\u5927\u809A",
      "\u6A39\u6797",
      "\u6DF1\u5751",
      "\u77F3\u9580",
      "\u5B89\u6A02",
      "\u6696\u6696",
      "\u91D1\u5C71",
      "\u842C\u91CC",
      "\u6CF0\u5C71",
      "\u9999\u5C71",
      "\u9F8D\u4E95",
      "\u5927\u5B89"
    ]);
    DISTRICT_INDEX = (() => {
      const index = /* @__PURE__ */ new Map();
      for (const [city, names] of Object.entries(DISTRICTS)) {
        for (const name of names) {
          const list = index.get(name) ?? [];
          list.push(city);
          index.set(name, list);
        }
      }
      return index;
    })();
    DISTRICT_NAMES = [...DISTRICT_INDEX.keys()].sort((a, b) => b.length - a.length);
    CITY_TOKENS = (() => {
      const tokens = /* @__PURE__ */ new Set();
      for (const city of TAIWAN_CITIES) {
        tokens.add(city);
        tokens.add(city.slice(0, -1));
        if (city.startsWith("\u81FA")) {
          tokens.add("\u53F0" + city.slice(1));
          tokens.add("\u53F0" + city.slice(1, -1));
        }
      }
      return [...tokens].sort((left, right) => right.length - left.length);
    })();
    NOT_A_PLACE_AFTER = /^(?:路|街|大道|國小|國中|高中|大學|站|里|村|捷運|醫院|公園|堂|鄉|鎮|號|段|巷|線|港口)/;
    WITHDRAWN = /撤回|不再納入|不再看|不再考慮|不納入|取消|不算|作廢/;
    HEDGE = /(?:是否|有沒有|有無|不確定|不知道|不清楚|沒弄清楚|弄不清|說不清|可能|也許|或許|還沒(?:有)?確認|尚未確認|未確認|還沒查|口頭)/;
    RENT_CUE = /(?:月租|租金|房租|租屋|租房|一個月|租)(?!補|約|客|戶|賃|金補|金加碼|屋補)/;
    INCOME_CUE = /(?:月薪|月收入|月所得|月入|月收|薪水|薪資|所得|收入)/;
    HOME_NOUN = "(?:\u623F\u5B50|\u623F\u5C4B|\u623F\u7522|\u4F4F\u5B85|\u81EA\u5B85|\u81EA\u6709\u5C4B|\u5C4B|\u623F)";
    OWNS_HOME_FALSE = new RegExp(`(?:\u6C92\u6709|\u6C92|\u7121|\u672A\u6301\u6709|\u4E26\u7121|\u4E0D\u6301\u6709|\u540D\u4E0B\u7121)(?:\u4EFB\u4F55)?(?:\u81EA\u6709|\u81EA\u5DF1\u7684)?${HOME_NOUN}(?![\u79DF\u88DC\u8CBC\u9593\u6771\u5BA2\u50F9])`);
    OWNS_HOME_TRUE = /(?<![沒無未自])(?:持有|擁有|有)(?:一|1|兩|2)?(?:間|棟|戶|整間|套)?[^，。；租,沒無未不]{0,14}?(?:住宅|房子|房屋|房產|自宅|自有屋)(?![租補貼])|(?<![沒無未是否自])有房(?![租補貼間])/;
    OTHER_AID_FALSE = /(?:沒有|沒|未曾|未|無|並未|不曾)(?:有)?(?:在)?(?:領|領取|請領|申請|享有|接受)?(?:過)?(?:任何)?(?:其他|另外|別的)?(?:的)?(?:政府)?(?:住宅|租金|租屋|房租)?(?:補助|補貼|協助)/;
    OTHER_AID_TRUE = /(?<![沒未無])(?:現領|正在領|目前(?:每月)?(?:都)?(?:在)?領|有在領|有領|已領|領有|仍在領|還在領)(?:取)?[^，。；,]{0,8}?(?:租金補貼|住宅補貼|住宅補助|租屋補助|租補|租金補助|住宅協助)/;
  }
});

// src/intent.ts
function polarityOf(text, clause, start, end, term) {
  const before = text.slice(clause.start, start);
  const after = text.slice(end, clause.end);
  if (NEGATED_BEFORE.test(before) || NEGATED_AFTER.test(after)) return "NEGATED";
  const near = before.slice(-8);
  if ((STATUS_BEFORE.test(near) || STATUS_LIST.test(before)) && !/(?:想|要|可以|能否|能不能|可不可以)(?:同時)?(?:請)?(?:領|領取|請領|申請)?\s*$/.test(near)) {
    return "STATUS_FACT";
  }
  void term;
  return "INTENT";
}
function findTopicMentions(goal) {
  const text = goal.normalize("NFKC");
  const lower = text.toLowerCase();
  const clauses = splitClauses(text);
  const taken = new Array(text.length).fill(false);
  const mentions = [];
  for (const { topic, term } of ALL_TERMS) {
    const needle = term.toLowerCase();
    let from = 0;
    for (; ; ) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      from = index + needle.length;
      let overlap = false;
      for (let i = index; i < index + needle.length; i += 1) if (taken[i]) {
        overlap = true;
        break;
      }
      if (overlap) continue;
      if (term === "\u4E2D\u592E" && !/^[^，。；,]{0,6}?(?:租|住宅)/.test(text.slice(index + needle.length))) continue;
      for (let i = index; i < index + needle.length; i += 1) taken[i] = true;
      const clause = clauses.find((c) => index >= c.start && index < c.end) ?? { start: 0, end: text.length, text };
      mentions.push({ topic, term, start: index, end: index + needle.length, polarity: polarityOf(text, clause, index, index + needle.length, term) });
    }
  }
  return mentions.sort((left, right) => left.start - right.start);
}
function analyzeRequestIntent(goal) {
  const mentions = findTopicMentions(goal);
  const has = (topic, polarity) => mentions.some((m) => m.topic === topic && m.polarity === polarity);
  const any = (topic, polarities) => mentions.some((m) => m.topic === topic && polarities.includes(m.polarity));
  const housingSubsidyIntent = has("HOUSING_SUBSIDY", "INTENT") || has("CENTRAL_RENT", "INTENT") || has("LOCAL_RENT_PROGRAM", "INTENT");
  const housingContext = any("HOUSING_CONTEXT", ["INTENT", "STATUS_FACT"]);
  const housingNegated = (has("HOUSING_SUBSIDY", "NEGATED") || has("HOUSING_CONTEXT", "NEGATED")) && !housingSubsidyIntent;
  const housing = !housingNegated && (housingSubsidyIntent || housingContext);
  const centralIntent = has("CENTRAL_RENT", "INTENT");
  const centralNegated = has("CENTRAL_RENT", "NEGATED") && !centralIntent;
  const localProgramIntent = has("LOCAL_RENT_PROGRAM", "INTENT");
  const localOnly = localProgramIntent && !centralIntent;
  const childcareAllowance = has("CHILDCARE_ALLOWANCE", "INTENT");
  const childcareSubsidy = has("CHILDCARE_SUBSIDY", "INTENT");
  const childcareNegated = (has("CHILDCARE_ALLOWANCE", "NEGATED") || has("CHILDCARE_SUBSIDY", "NEGATED") || has("CHILDCARE_CONTEXT", "NEGATED")) && !childcareAllowance && !childcareSubsidy;
  const childcareContext = !childcareNegated && (any("CHILDCARE_CONTEXT", ["INTENT", "STATUS_FACT"]) || any("CHILDCARE_ALLOWANCE", ["STATUS_FACT"]) || any("CHILDCARE_SUBSIDY", ["STATUS_FACT"]));
  const unsupported = UNSUPPORTED_TOPICS.filter((topic) => has(topic, "INTENT"));
  return {
    mentions,
    housing,
    housingNegated,
    centralIntent,
    centralNegated,
    localProgramIntent,
    localOnly,
    childcareAllowance,
    childcareSubsidy,
    childcareContext,
    childcareNegated,
    unsupported
  };
}
var TOPICS, ALL_TERMS, NEGATED_BEFORE, NEGATED_AFTER, STATUS_BEFORE, STATUS_LIST, UNSUPPORTED_TOPICS;
var init_intent = __esm({
  "src/intent.ts"() {
    "use strict";
    init_fact_extraction();
    TOPICS = [
      { topic: "CENTRAL_RENT", terms: ["300\u5104", "\u4E09\u767E\u5104", "\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC", "\u4E2D\u592E\u79DF\u91D1\u88DC\u8CBC", "\u4E2D\u592E\u79DF\u88DC", "\u4E2D\u592E"] },
      {
        topic: "LOCAL_RENT_PROGRAM",
        terms: ["\u81FA\u5317\u5E78\u798F\u79DF", "\u53F0\u5317\u5E78\u798F\u79DF", "\u5E78\u798F\u79DF", "\u9752\u5E74\u79DF\u91D1\u88DC\u8CBC", "\u9752\u5E74\u79DF\u88DC", "\u9752\u5E74\u79DF\u91D1\u52A0\u78BC", "\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9", "\u5730\u65B9\u79DF\u88DC", "\u5730\u65B9\u52A0\u78BC", "\u5730\u65B9\u65B9\u6848", "\u5730\u65B9\u7684\u52A0\u78BC", "\u81EA\u8FA6\u5730\u65B9\u79DF\u88DC", "\u81EA\u8FA6", "\u52A0\u78BC"]
      },
      { topic: "HOUSING_SUBSIDY", terms: ["\u79DF\u91D1\u88DC\u8CBC", "\u79DF\u5C4B\u88DC\u52A9", "\u79DF\u91D1\u88DC\u52A9", "\u79DF\u88DC", "\u4F4F\u5B85\u88DC\u8CBC", "\u79DF\u5C4B\u88DC\u8CBC"] },
      { topic: "HOUSING_CONTEXT", terms: ["\u79DF\u5C4B", "\u79DF\u623F", "\u6708\u79DF", "\u623F\u79DF", "\u79DF\u91D1", "\u79DF\u7D04", "\u79DF\u5BA2", "\u5408\u79DF", "rent", "housing", "lease"] },
      { topic: "UNSUPPORTED_HOUSING", terms: ["\u539F\u4F4F\u6C11\u65CF\u79DF\u91D1\u88DC\u8CBC", "\u539F\u4F4F\u6C11\u79DF\u91D1\u88DC\u8CBC", "\u5305\u79DF\u4EE3\u7BA1", "\u8CFC\u5C4B\u8CB8\u6B3E", "\u9752\u5E74\u8CFC\u5C4B", "\u4FEE\u7E55\u4F4F\u5B85"] },
      { topic: "CHILDCARE_ALLOWANCE", terms: ["\u80B2\u5152\u6D25\u8CBC", "\u80B2\u5152", "0\u5230\u672A\u6EFF2\u6B72", "0\u52302\u6B72", "0\u81F3\u672A\u6EFF2\u6B72", "\u672A\u6EFF2\u6B72", "\u672A\u6EFF\u4E8C\u6B72", "0-2\u6B72"] },
      { topic: "CHILDCARE_SUBSIDY", terms: ["\u6258\u80B2\u8CBB\u7528\u88DC\u52A9", "\u6E96\u516C\u5171\u6258\u80B2\u88DC\u52A9", "\u516C\u5171\u6258\u80B2\u88DC\u52A9", "\u6258\u80B2\u88DC\u52A9", "\u6258\u80B2\u88DC\u8CBC", "\u6258\u80B2\u8CBB\u7528"] },
      { topic: "UNSUPPORTED_CHILDCARE", terms: ["\u751F\u80B2\u6D25\u8CBC", "\u751F\u80B2\u734E\u52F5", "\u751F\u80B2\u88DC\u52A9", "\u5C31\u5B78\u88DC\u52A9", "\u5E7C\u5152\u5712\u88DC\u52A9", "\u80B2\u5B30\u7559\u8077\u505C\u85AA", "parental leave"] },
      { topic: "CHILDCARE_CONTEXT", terms: ["\u5BF6\u5BF6", "\u5B30\u5152", "\u5E7C\u5152", "\u6258\u5B30", "\u4FDD\u6BCD", "\u4FDD\u59C6", "\u80B2\u5B30", "\u6258\u80B2", "\u6E96\u516C\u5171", "\u751F\u80B2", "childcare", "child care"] },
      { topic: "LONG_TERM_CARE", terms: ["\u9577\u7167", "\u9577\u671F\u7167\u9867", "\u5C45\u5BB6\u670D\u52D9", "\u5C45\u5BB6\u7167\u9867\u670D\u52D9"] },
      { topic: "FARMER_ALLOWANCE", terms: ["\u8001\u5E74\u8FB2\u6C11\u798F\u5229\u6D25\u8CBC", "\u8001\u8FB2\u6D25\u8CBC", "\u8FB2\u4FDD", "\u8FB2\u6C11", "\u6F01\u6C11"] },
      { topic: "VOCATIONAL_TRAINING", terms: ["\u8077\u8A13\u751F\u6D3B\u6D25\u8CBC", "\u8077\u696D\u8A13\u7DF4\u751F\u6D3B\u6D25\u8CBC", "\u8077\u8A13", "\u8077\u696D\u8A13\u7DF4"] },
      {
        topic: "OTHER_WELFARE",
        terms: ["\u8001\u4EBA", "\u8EAB\u5FC3\u969C\u7919", "\u6025\u96E3\u6551\u52A9", "\u5931\u696D", "\u5E74\u91D1", "\u52DE\u4FDD", "\u5065\u4FDD", "\u91CD\u967D", "\u656C\u8001", "\u5047\u7259", "\u5B78\u8CB8", "\u5C31\u5B78\u8CB8\u6B3E", "\u734E\u5B78\u91D1"]
      }
    ];
    ALL_TERMS = TOPICS.flatMap((def) => def.terms.map((term) => ({ topic: def.topic, term }))).sort((left, right) => right.term.length - left.term.length);
    NEGATED_BEFORE = /(?:不是要問|不是問|不是要查|不問|不查|不看|不用(?:幫我)?(?:看|查|問|評估)?|不要|不需要|不必|不考慮|並非)[^，。；,]{0,10}$/;
    NEGATED_AFTER = /^[^，。；,]{0,12}?(?:都)?(?:跟我|與我|和我)?(?:無關|沒關係|不相關|不需要|不用|不必|不考慮)/;
    STATUS_BEFORE = /(?:(?:沒有|沒|未曾|未|無|還沒|尚未|並未)(?:在)?(?:請)?(?:領|領取|請領|申請|使用)?|(?:正在|現在|現|已|有在|有|目前(?:每月)?(?:都)?(?:在)?|仍在|還在)(?:請)?(?:領|領取|請領|申請|使用))(?:過)?(?:任何)?(?:其他|另一項|另一筆|另外)?(?:政府)?(?:的)?\s*$/;
    STATUS_LIST = /(?:沒有|沒|未|無|並未|還沒|尚未)[^，。；,]{0,10}(?:或|和|及|、|與|也沒有|也沒|也未)\s*$/;
    UNSUPPORTED_TOPICS = ["LONG_TERM_CARE", "FARMER_ALLOWANCE", "VOCATIONAL_TRAINING", "OTHER_WELFARE", "UNSUPPORTED_CHILDCARE", "UNSUPPORTED_HOUSING"];
  }
});

// src/coverage.ts
function notCoveredComponents(intent) {
  return intent.unsupported.map((topic) => TOPIC_COMPONENTS[topic]).filter((component) => Boolean(component)).map((component) => ({ ...component, status: "NOT_COVERED" }));
}
function outsideVerifiedCoverage(intent) {
  const components = intent ? notCoveredComponents(intent) : [];
  const referrals = components.map((component) => component.referral).filter((ref) => Boolean(ref));
  const unique = referrals.filter((ref, index) => referrals.findIndex((other) => other.url === ref.url) === index);
  return {
    status: "NOT_COVERED",
    domain: "OTHER",
    reason: "UNSUPPORTED_DOMAIN_NOT_IMPLEMENTED",
    message: OUTSIDE_VERIFIED_COVERAGE_MESSAGE,
    officialReferrals: unique.length ? unique : GENERAL_WELFARE_REFERRALS,
    ...components.length ? { components } : {}
  };
}
function isLocalOnlyHousingQuery(goal) {
  const intent = analyzeRequestIntent(goal);
  return intent.localOnly && !intent.housingNegated;
}
function asksHousing(intent) {
  return intent.mentions.some(
    (m) => m.polarity === "INTENT" && (m.topic === "HOUSING_SUBSIDY" || m.topic === "CENTRAL_RENT" || m.topic === "LOCAL_RENT_PROGRAM")
  );
}
function asksChildcare(intent) {
  return intent.childcareAllowance || intent.childcareSubsidy || intent.unsupported.includes("UNSUPPORTED_CHILDCARE");
}
function detectBenefitDomain(goal) {
  const intent = analyzeRequestIntent(goal);
  const childcare = asksChildcare(intent);
  const housing = asksHousing(intent) && !intent.housingNegated;
  if (childcare) return "CHILDCARE";
  if (housing) return "HOUSING";
  if (intent.housing) return "HOUSING";
  if (intent.childcareContext) return "CHILDCARE";
  return "HOUSING";
}
function housingCityOf(goal) {
  const extracted = extractHousingFactsTyped(goal.normalize("NFKC")).facts.city;
  if (extracted?.state === "KNOWN_VALUE" && typeof extracted.value === "string") return extracted.value;
  const normalizedText = goal.replace(/台/g, "\u81FA");
  return TAIWAN_CITIES.find((c) => normalizedText.includes(c));
}
function assessQueryCoverage(goal) {
  const text = goal.toLowerCase();
  const intent = analyzeRequestIntent(goal);
  const extraComponents = notCoveredComponents(intent);
  const withComponents = (assessment, components) => components.length ? { ...assessment, components } : assessment;
  if (detectBenefitDomain(goal) === "CHILDCARE") {
    const allowanceAsked = intent.childcareAllowance || !intent.childcareSubsidy && !intent.unsupported.includes("UNSUPPORTED_CHILDCARE");
    if (!allowanceAsked) {
      return withComponents(
        {
          status: "NOT_COVERED",
          domain: "CHILDCARE",
          reason: "CHILDCARE_POLICY_NOT_IMPLEMENTED",
          message: CHILDCARE_NOT_IMPLEMENTED_MESSAGE,
          officialReferrals: CHILDCARE_NOT_IMPLEMENTED_REFERRALS
        },
        [
          ...intent.childcareSubsidy ? [{ ...CHILDCARE_SUBSIDY_COMPONENT, status: "NOT_COVERED" }] : [],
          ...extraComponents
        ]
      );
    }
    const components = [
      {
        key: "CHILDCARE_ALLOWANCE_UNDER_2",
        label: "\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\uFF08115\u5E74\u5EA6\uFF09",
        status: "COVERED",
        message: "\u53EF\u9032\u884C\u8CC7\u683C\u9810\u5BE9\u3001\u80CE\u6B21\u91D1\u984D\u8A66\u7B97\u8207\u7533\u8FA6\u5C0E\u822A\u3002"
      },
      ...intent.childcareSubsidy ? [{ ...CHILDCARE_SUBSIDY_COMPONENT, status: "NOT_COVERED" }] : [],
      ...extraComponents
    ];
    return withComponents(
      {
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
      },
      components.length > 1 ? components : []
    );
  }
  const housingRequested = intent.housing && !intent.housingNegated;
  if (!housingRequested && (intent.unsupported.length > 0 || intent.housingNegated || intent.childcareNegated)) {
    return outsideVerifiedCoverage(intent);
  }
  if (
    // Explicit unsupported housing programme; only an explicit central request keeps a supported part.
    UNSUPPORTED_HOUSING_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase())) && !intent.centralIntent
  ) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_HOUSING_POLICY_NOT_IMPLEMENTED",
      message: "\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u300C300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\uFF08\u542B\u96D9\u5317\u8207\u6843\u5712\u5E02\u53D7\u7406\u5C0E\u822A\uFF09\u300D\u3001\u300C\u81FA\u5317\u5E02\u81FA\u5317\u5E78\u798F\u79DF\u52A0\u78BC\u300D\u8207\u300C\u65B0\u5317\u5E02\u9752\u5E74\u79DF\u91D1\u88DC\u8CBC\u300D\uFF0C\u5C1A\u672A\u6DB5\u84CB\u6843\u5712\u5E02\u7368\u7ACB\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\u3001\u539F\u4F4F\u6C11\u65CF\u5C08\u6848\u79DF\u91D1\u88DC\u8CBC\u3001\u793E\u6703\u4F4F\u5B85\u5305\u79DF\u4EE3\u7BA1\u6216\u8CFC\u5C4B\u8CB8\u6B3E\u88DC\u8CBC\u3002\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002",
      officialReferrals: [
        NLMA_REFERRAL,
        {
          label: "\u6843\u5712\u5E02\u653F\u5E9C\u4F4F\u5B85\u767C\u5C55\u8655\u5B98\u65B9\u7DB2\u7AD9",
          agency: "\u6843\u5712\u5E02\u653F\u5E9C\u4F4F\u5B85\u767C\u5C55\u8655",
          url: "https://ohd.tycg.gov.tw/"
        }
      ]
    };
  }
  const matchedCity = housingCityOf(goal);
  if (matchedCity && !ALL_COVERED_HOUSING_CITIES.includes(matchedCity)) {
    if (isLocalOnlyHousingQuery(goal)) {
      return withComponents(
        {
          status: "NOT_COVERED",
          domain: "RENTAL_SUBSIDY",
          reason: "UNSUPPORTED_CITY_HOUSING_POLICY_NOT_IMPLEMENTED",
          message: `\u76EE\u524D\u7248\u672C\u5C1A\u672A\u6DB5\u84CB${matchedCity}\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\u6216\u52A0\u78BC\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u7E23\u5E02\u5730\u65B9\u65B9\u6848\u4E4B\u8CC7\u683C\u5224\u5B9A\u3002\u5168\u570B\u9069\u7528\u4E4B\u4E2D\u592E\u79DF\u91D1\u88DC\u8CBC\u53EF\u53E6\u884C\u9810\u5BE9\u3002\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002`,
          officialReferrals: [NLMA_REFERRAL]
        },
        extraComponents
      );
    }
    return {
      status: "COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "CENTRAL_ONLY_LOCAL_NOT_COVERED",
      message: `\u53EF\u9810\u5BE9\u5168\u570B\u9069\u7528\u4E4B\u300C300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\u300D\u90E8\u5206\u689D\u4EF6\uFF1B${matchedCity}\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\u6216\u52A0\u78BC\u5C1A\u672A\u6DB5\u84CB\uFF0C\u4E0D\u4F5C\u6210\u5730\u65B9\u65B9\u6848\u5224\u5B9A\u3002`,
      officialReferrals: [NLMA_REFERRAL],
      components: [
        {
          key: "CENTRAL_RENT_115",
          label: "300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\uFF08\u5168\u570B\u9069\u7528\uFF09",
          status: "COVERED",
          message: "\u53EF\u9810\u5BE9\u5DF2\u5BE6\u4F5C\u4E4B\u90E8\u5206\u689D\u4EF6\u3002"
        },
        {
          key: "LOCAL_RENT_PROGRAM",
          label: `${matchedCity}\u5730\u65B9\u79DF\u5C4B\u88DC\u52A9\u6216\u52A0\u78BC`,
          status: "NOT_COVERED",
          message: `${matchedCity}\u5730\u65B9\u65B9\u6848\u5C1A\u672A\u7D0D\u5165\u672C\u7CFB\u7D71\uFF0C\u4E0D\u4F5C\u6210\u5730\u65B9\u65B9\u6848\u5224\u5B9A\uFF1B\u8ACB\u4EE5\u8A72\u7E23\u5E02\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002`
        },
        ...extraComponents
      ]
    };
  }
  return withComponents(
    {
      status: "COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "RENTAL_SUBSIDY_IN_SCOPE",
      message: "\u76EE\u524D\u7248\u672C\u53EF\u9032\u884C\u79DF\u5C4B\u88DC\u52A9\u7684\u90E8\u5206\u689D\u4EF6\u9810\u5BE9\u8207\u7533\u8FA6\u5C0E\u822A\u3002",
      officialReferrals: []
    },
    extraComponents.length ? [
      {
        key: "RENTAL_SUBSIDY",
        label: "\u79DF\u5C4B\u88DC\u52A9\uFF08\u5DF2\u5BE6\u4F5C\u90E8\u5206\u689D\u4EF6\uFF09",
        status: "COVERED",
        message: "\u53EF\u9032\u884C\u90E8\u5206\u689D\u4EF6\u9810\u5BE9\u8207\u7533\u8FA6\u5C0E\u822A\u3002"
      },
      ...extraComponents
    ] : []
  );
}
var COVERED_LOCAL_CITIES, COVERED_CENTRAL_NAVIGATION_CITIES, ALL_COVERED_HOUSING_CITIES, UNSUPPORTED_HOUSING_KEYWORDS, OUTSIDE_VERIFIED_COVERAGE_MESSAGE, GENERAL_WELFARE_REFERRALS, TOPIC_COMPONENTS, CHILDCARE_SUBSIDY_COMPONENT, CHILDCARE_NOT_IMPLEMENTED_MESSAGE, CHILDCARE_NOT_IMPLEMENTED_REFERRALS, NLMA_REFERRAL;
var init_coverage = __esm({
  "src/coverage.ts"() {
    "use strict";
    init_taiwan_cities();
    init_intent();
    init_fact_extraction();
    COVERED_LOCAL_CITIES = ["\u81FA\u5317\u5E02", "\u65B0\u5317\u5E02"];
    COVERED_CENTRAL_NAVIGATION_CITIES = ["\u6843\u5712\u5E02"];
    ALL_COVERED_HOUSING_CITIES = [
      ...COVERED_LOCAL_CITIES,
      ...COVERED_CENTRAL_NAVIGATION_CITIES
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
    OUTSIDE_VERIFIED_COVERAGE_MESSAGE = "\u60A8\u67E5\u8A62\u7684\u653F\u7B56\uFF0F\u9818\u57DF\u4E0D\u5728\u76EE\u524D\u5DF2\u9A57\u8B49\u7684\u6DB5\u84CB\u7BC4\u570D\u5167\uFF08Requested policy/domain is outside current verified coverage\uFF09\u3002\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u7279\u5B9A\u79DF\u5C4B\u88DC\u8CBC\u8207\u672A\u6EFF2\u6B72\u80B2\u5152\u6D25\u8CBC\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u9805\u88DC\u52A9\u4E4B\u8CC7\u683C\u5224\u5B9A\uFF0C\u4E5F\u4E0D\u6703\u6539\u4EE5\u79DF\u5C4B\u88DC\u8CBC\u56DE\u7B54\u3002\u9019\u4E0D\u4EE3\u8868\u60A8\u7121\u6CD5\u7533\u8ACB\uFF0C\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002";
    GENERAL_WELFARE_REFERRALS = [
      {
        label: "\u885B\u751F\u798F\u5229\u90E8 1957 \u798F\u5229\u8AEE\u8A62\u5C08\u7DDA",
        agency: "\u885B\u751F\u798F\u5229\u90E8",
        url: "https://1957.mohw.gov.tw/"
      }
    ];
    TOPIC_COMPONENTS = {
      LONG_TERM_CARE: {
        key: "LONG_TERM_CARE",
        label: "\u9577\u671F\u7167\u9867\u670D\u52D9\uFF08\u9577\u7167\uFF09",
        message: "\u9577\u7167\u670D\u52D9\u4E0D\u5728\u672C\u7CFB\u7D71\u6DB5\u84CB\u7BC4\u570D\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\uFF1B\u8ACB\u6D3D 1966 \u9577\u7167\u670D\u52D9\u5C08\u7DDA\u6216\u885B\u798F\u90E8\u9577\u7167\u5C08\u5340\u3002",
        referral: { label: "\u885B\u751F\u798F\u5229\u90E8\u9577\u7167\u5C08\u5340\uFF081966 \u9577\u7167\u670D\u52D9\u5C08\u7DDA\uFF09", agency: "\u885B\u751F\u798F\u5229\u90E8", url: "https://1966.gov.tw/" }
      },
      FARMER_ALLOWANCE: {
        key: "FARMER_ALLOWANCE",
        label: "\u8001\u5E74\u8FB2\u6C11\u798F\u5229\u6D25\u8CBC",
        message: "\u8001\u5E74\u8FB2\u6C11\u798F\u5229\u6D25\u8CBC\u4E0D\u5728\u672C\u7CFB\u7D71\u6DB5\u84CB\u7BC4\u570D\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\uFF1B\u4E3B\u8CAC\u6A5F\u95DC\u70BA\u52DE\u52D5\u90E8\u52DE\u5DE5\u4FDD\u96AA\u5C40\u3002",
        referral: { label: "\u52DE\u52D5\u90E8\u52DE\u5DE5\u4FDD\u96AA\u5C40", agency: "\u52DE\u52D5\u90E8\u52DE\u5DE5\u4FDD\u96AA\u5C40", url: "https://www.bli.gov.tw/" }
      },
      VOCATIONAL_TRAINING: {
        key: "VOCATIONAL_TRAINING",
        label: "\u8077\u696D\u8A13\u7DF4\u751F\u6D3B\u6D25\u8CBC",
        message: "\u8077\u696D\u8A13\u7DF4\u751F\u6D3B\u6D25\u8CBC\u4E0D\u5728\u672C\u7CFB\u7D71\u6DB5\u84CB\u7BC4\u570D\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\uFF1B\u8ACB\u6D3D\u52DE\u52D5\u90E8\u52DE\u52D5\u529B\u767C\u5C55\u7F72\u3002",
        referral: { label: "\u52DE\u52D5\u90E8\u52DE\u52D5\u529B\u767C\u5C55\u7F72", agency: "\u52DE\u52D5\u90E8\u52DE\u52D5\u529B\u767C\u5C55\u7F72", url: "https://www.wda.gov.tw/" }
      },
      OTHER_WELFARE: {
        key: "OTHER_WELFARE",
        label: "\u5176\u4ED6\u793E\u6703\u798F\u5229\u9805\u76EE",
        message: "\u6B64\u9805\u798F\u5229\u4E0D\u5728\u672C\u7CFB\u7D71\u6DB5\u84CB\u7BC4\u570D\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\uFF1B\u8ACB\u6D3D\u4E3B\u7BA1\u6A5F\u95DC\u6216 1957 \u798F\u5229\u8AEE\u8A62\u5C08\u7DDA\u3002",
        referral: GENERAL_WELFARE_REFERRALS[0]
      },
      UNSUPPORTED_CHILDCARE: {
        key: "UNSUPPORTED_CHILDCARE",
        label: "\u751F\u80B2\uFF0F\u5C31\u5B78\uFF0F\u80B2\u5B30\u7559\u8077\u505C\u85AA\u7B49\u5176\u4ED6\u80B2\u5152\u76F8\u95DC\u7D66\u4ED8",
        message: "\u6B64\u9805\u7D66\u4ED8\u4E0D\u5728\u672C\u7CFB\u7D71\u6DB5\u84CB\u7BC4\u570D\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\uFF1B\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002"
      }
    };
    CHILDCARE_SUBSIDY_COMPONENT = {
      key: "CHILDCARE_SUBSIDY",
      label: "\u6258\u80B2\u8CBB\u7528\u88DC\u52A9\uFF08\u516C\u5171\u5316\uFF0F\u6E96\u516C\u5171\u6258\u80B2\uFF09",
      message: "\u6258\u80B2\u8CBB\u7528\u88DC\u52A9\u5C1A\u672A\u7D0D\u5165\u672C\u7CFB\u7D71\u898F\u5247\uFF0C\u4E0D\u4F5C\u8CC7\u683C\u5224\u5B9A\u6216\u91D1\u984D\u8A66\u7B97\uFF1B\u8ACB\u6D3D\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72\u6216\u6236\u7C4D\u5730\u5730\u65B9\u653F\u5E9C\u3002",
      referral: {
        label: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72\uFF0D\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u8207\u6258\u80B2\u88DC\u52A9\u5C08\u5340",
        agency: "\u885B\u751F\u798F\u5229\u90E8\u793E\u6703\u53CA\u5BB6\u5EAD\u7F72",
        url: "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582"
      }
    };
    CHILDCARE_NOT_IMPLEMENTED_MESSAGE = "\u76EE\u524D\u7248\u672C\u50C5\u6DB5\u84CB\u300C\u80B2\u6709\u672A\u6EFF2\u6B72\u5152\u7AE5\u80B2\u5152\u6D25\u8CBC\u300D\uFF0C\u5C1A\u672A\u6DB5\u84CB\u6258\u80B2\u88DC\u52A9\u3001\u751F\u80B2\u734E\u52F5\u91D1\u3001\u5C31\u5B78\u88DC\u52A9\u6216\u80B2\u5B30\u7559\u8077\u505C\u85AA\u6D25\u8CBC\uFF0C\u56E0\u6B64\u7121\u6CD5\u4F5C\u6210\u8A72\u9805\u88DC\u52A9\u4E4B\u8CC7\u683C\u5224\u5B9A\u3002\u9019\u4E0D\u4EE3\u8868\u60A8\u7121\u6CD5\u7533\u8ACB\uFF0C\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002";
    CHILDCARE_NOT_IMPLEMENTED_REFERRALS = [
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
    ];
    NLMA_REFERRAL = {
      label: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72\uFF0D300\u5104\u5143\u4E2D\u592E\u64F4\u5927\u79DF\u91D1\u88DC\u8CBC\u7DDA\u4E0A\u7533\u8ACB\u7CFB\u7D71",
      agency: "\u5167\u653F\u90E8\u570B\u571F\u7BA1\u7406\u7F72",
      url: "https://has.nlma.gov.tw/subsidyOnline/"
    };
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

// src/ui-copy.ts
var agentStatusCopy, workflowSteps, childcareWorkflowSteps, singleScenarioWorkflowSteps, statusCopy, currentStepCopy, auditCopy;
var init_ui_copy = __esm({
  "src/ui-copy.ts"() {
    "use strict";
    agentStatusCopy = {
      IDLE: { zh: "\u5F85\u547D", en: "Idle" },
      PLANNING: { zh: "\u898F\u5283\u4E2D", en: "Planning" },
      RUNNING_TOOL: { zh: "\u57F7\u884C\u5DE5\u5177", en: "Running tool" },
      WAITING_FOR_HUMAN: { zh: "\u7B49\u5F85\u4EBA\u5DE5\u78BA\u8A8D", en: "Waiting for human" },
      RESUMING: { zh: "\u7E7C\u7E8C\u57F7\u884C", en: "Resuming" },
      COMPLETED: { zh: "\u5DF2\u5B8C\u6210", en: "Completed" },
      FAILED: { zh: "\u57F7\u884C\u5931\u6557", en: "Failed" },
      ABORTED: { zh: "\u5DF2\u5B89\u5168\u4E2D\u6B62", en: "Aborted" },
      HUMAN_REVIEW_REQUIRED: { zh: "\u9700\u8981\u4EBA\u5DE5\u5BE9\u67E5", en: "Human review required" },
      NOT_COVERED: { zh: "\u5C1A\u672A\u6DB5\u84CB", en: "Not covered" }
    };
    workflowSteps = [
      { key: "goal", zh: "\u7533\u8ACB\u76EE\u6A19", en: "Goal" },
      { key: "analyze", zh: "Agent \u5206\u6790", en: "Analyze" },
      { key: "human", zh: "\u4EBA\u5DE5\u78BA\u8A8D", en: "Human Gate" },
      { key: "compare", zh: "\u60C5\u5883\u6BD4\u8F03", en: "Compare" },
      { key: "decision", zh: "\u6C7A\u7B56\u8B77\u7167", en: "Decision" }
    ];
    childcareWorkflowSteps = workflowSteps.map(
      (step) => step.key === "compare" ? { key: "eligibility", zh: "\u8CC7\u683C\u8207\u91D1\u984D", en: "Eligibility" } : step
    );
    singleScenarioWorkflowSteps = workflowSteps.map(
      (step) => step.key === "compare" ? { key: "evaluate", zh: "\u8CC7\u683C\u8A55\u4F30", en: "Evaluate" } : step
    );
    statusCopy = {
      ...agentStatusCopy,
      PASS: { zh: "\u901A\u904E", en: "PASS" },
      FAIL: { zh: "\u4E0D\u901A\u904E", en: "FAIL" },
      UNCERTAIN: { zh: "\u5F85\u78BA\u8A8D", en: "UNCERTAIN" },
      PARTIAL_CHECK: { zh: "\u5DF2\u5B8C\u6210\u7CFB\u7D71\u53EF\u9A57\u8B49\u9805\u76EE", en: "PARTIAL_CHECK" },
      NOT_COVERED: { zh: "\u5C1A\u672A\u6DB5\u84CB", en: "NOT_COVERED" },
      PENDING: { zh: "\u7B49\u5F85\u4E2D", en: "PENDING" },
      ACTIVE: { zh: "\u57F7\u884C\u4E2D", en: "ACTIVE" },
      DONE: { zh: "\u5B8C\u6210", en: "DONE" },
      BLOCKED: { zh: "\u53D7\u963B", en: "BLOCKED" },
      AVAILABLE: { zh: "\u53EF\u7528", en: "AVAILABLE" },
      UNAVAILABLE: { zh: "\u7121\u6CD5\u4F7F\u7528", en: "UNAVAILABLE" },
      UNKNOWN: { zh: "\u6AA2\u67E5\u4E2D", en: "CHECKING" },
      CLEAR: { zh: "\u7121\u885D\u7A81", en: "Clear" },
      CONFLICT: { zh: "\u767C\u73FE\u885D\u7A81", en: "Conflict" },
      CONTINUE: { zh: "\u7E7C\u7E8C\u57F7\u884C", en: "Continue" },
      ALLOWED: { zh: "\u5141\u8A31\u5B58\u53D6", en: "Allowed" },
      ACCESS_DENIED: { zh: "\u62D2\u7D55\u5B58\u53D6", en: "Access denied" }
    };
    currentStepCopy = {
      IDLE: {
        title: { zh: "\u6E96\u5099\u958B\u59CB", en: "Ready to begin" },
        description: { zh: "\u8F38\u5165\u7533\u8ACB\u76EE\u6A19\uFF0C\u958B\u59CB\u898F\u5283\u88DC\u52A9\u5C0E\u822A\u3002", en: "Enter a goal to start your benefit navigation." }
      },
      PLANNING: {
        title: agentStatusCopy.PLANNING,
        description: { zh: "Agent \u6B63\u5728\u7406\u89E3\u76EE\u6A19\u4E26\u898F\u5283\u5DE5\u5177\u57F7\u884C\u9806\u5E8F\u3002", en: "The agent is understanding the goal and planning tool execution." }
      },
      RUNNING_TOOL: {
        title: agentStatusCopy.RUNNING_TOOL,
        description: { zh: "\u4F9D\u898F\u5247\u5F15\u64CE\u8207\u5B98\u65B9\u8B49\u64DA\u6AA2\u67E5\u5FC5\u8981\u689D\u4EF6\u3002", en: "Checking required conditions against rules and official evidence." }
      },
      WAITING_FOR_HUMAN: {
        title: { zh: "\u9700\u8981\u4EBA\u5DE5\u78BA\u8A8D", en: "Human confirmation required" },
        description: { zh: "\u5FC5\u8981\u689D\u4EF6\u5C1A\u672A\u78BA\u8A8D\uFF0CAgent \u5DF2\u66AB\u505C\u63A8\u8AD6\u3002", en: "A required condition is still unknown, so the agent has paused." }
      },
      RESUMING: {
        title: agentStatusCopy.RESUMING,
        description: { zh: "\u5DF2\u6536\u5230\u4EBA\u5DE5\u78BA\u8A8D\uFF0C\u91CD\u65B0\u57F7\u884C\u898F\u5247\u6AA2\u67E5\u3002", en: "Human input received; running the rules again." }
      },
      COMPLETED: {
        title: { zh: "\u6C7A\u7B56\u8B77\u7167\u5DF2\u7522\u51FA", en: "Decision passport ready" },
        description: { zh: "\u60C5\u5883\u6BD4\u8F03\u8207\u653F\u7B56\u4F9D\u64DA\u5DF2\u6574\u7406\uFF0C\u672A\u78BA\u8A8D\u689D\u4EF6\u4ECD\u4FDD\u7559\u5F85\u78BA\u8A8D\u72C0\u614B\u3002", en: "Scenarios and evidence are ready; unknown conditions remain uncertain." }
      },
      FAILED: {
        title: agentStatusCopy.FAILED,
        description: { zh: "\u672C\u6B21\u57F7\u884C\u672A\u80FD\u5B8C\u6210\uFF0C\u8ACB\u6AA2\u67E5\u9664\u932F\u8CC7\u8A0A\u5F8C\u91CD\u8A66\u3002", en: "This run could not finish. Check debug details before retrying." }
      },
      ABORTED: {
        title: agentStatusCopy.ABORTED,
        description: { zh: "\u5DF2\u9054\u5B89\u5168\u6B65\u6578\u4E0A\u9650\u4E26\u4E2D\u6B62\u57F7\u884C\u3002", en: "Execution aborted safely after reaching the step limit." }
      },
      HUMAN_REVIEW_REQUIRED: {
        title: agentStatusCopy.HUMAN_REVIEW_REQUIRED,
        description: { zh: "\u653F\u7B56\u8CC7\u6599\u9700\u8981\u4EBA\u5DE5\u67E5\u6838\uFF0CAgent \u5DF2\u505C\u6B62\u78BA\u5B9A\u5F0F\u5224\u65B7\u3002", en: "Policy information needs human review; definitive judgment has paused." }
      },
      NOT_COVERED: {
        title: { zh: "\u76EE\u524D\u7248\u672C\u5C1A\u672A\u6DB5\u84CB\u6B64\u985E\u88DC\u52A9", en: "Not covered in current version" },
        description: { zh: "\u7CFB\u7D71\u5C1A\u672A\u5167\u5EFA\u6B64\u9805\u88DC\u52A9\u4E4B\u5B8C\u6574\u898F\u5247\uFF0C\u7121\u6CD5\u4F5C\u6210\u8CC7\u683C\u5224\u5B9A\uFF1B\u8ACB\u4EE5\u4E3B\u7BA1\u6A5F\u95DC\u5B98\u65B9\u516C\u544A\u70BA\u6E96\u3002", en: "This policy is not yet encoded in the current version; please refer to official announcements." }
      }
    };
    auditCopy = {
      CASE_CREATED: { zh: "\u5EFA\u7ACB\u6848\u4EF6", en: "Case created" },
      INITIAL_EVALUATION: { zh: "\u521D\u6B65\u898F\u5247\u6AA2\u67E5", en: "Initial evaluation" },
      HUMAN_CONFIRMATION_REQUIRED: { zh: "\u8981\u6C42\u4EBA\u5DE5\u78BA\u8A8D", en: "Human confirmation required" },
      FIELD_CONFIRMED: { zh: "\u5DF2\u78BA\u8A8D\u8CC7\u6599", en: "Field confirmed" },
      ROLE_CHANGED: { zh: "\u5207\u63DB\u89D2\u8272", en: "Role changed" },
      ACCESS_DENIED: statusCopy.ACCESS_DENIED,
      MASKED_PROFILE_ACCESSED: { zh: "\u5B58\u53D6\u906E\u7F69\u8CC7\u6599", en: "Masked profile accessed" },
      SENSITIVE_PROFILE_ACCESSED: { zh: "\u5B58\u53D6\u500B\u4EBA\u8CC7\u6599", en: "Profile accessed" },
      ACTUAL_SCENARIO_EVALUATED: { zh: "\u5BE6\u969B\u60C5\u5883\u8A55\u4F30\u5B8C\u6210", en: "Actual scenario evaluated" },
      WHAT_IF_SCENARIO_EVALUATED: { zh: "\u5047\u8A2D\u60C5\u5883\u8A55\u4F30\u5B8C\u6210", en: "What-if scenario evaluated" },
      DECISION_PASSPORT_GENERATED: { zh: "\u7522\u51FA\u6C7A\u7B56\u8B77\u7167", en: "Passport generated" },
      POLICY_CONFLICT_CHECK: { zh: "\u653F\u7B56\u885D\u7A81\u6AA2\u67E5", en: "Policy conflict check" },
      HUMAN_REVIEW_REQUIRED: statusCopy.HUMAN_REVIEW_REQUIRED,
      AGENT_RUN_STARTED: { zh: "\u4EE3\u7406\u555F\u52D5", en: "Agent started" },
      AGENT_PLAN_CREATED: { zh: "\u5EFA\u7ACB\u57F7\u884C\u8A08\u756B", en: "Plan created" },
      AGENT_LLM_CALL_COMPLETED: { zh: "\u6A21\u578B\u63A8\u8AD6\u5B8C\u6210", en: "Model call completed" },
      AGENT_LLM_CALL_FAILED: { zh: "\u6A21\u578B\u63A8\u8AD6\u5931\u6557", en: "Model call failed" },
      AGENT_TOOL_REQUESTED: { zh: "\u547C\u53EB\u5DE5\u5177", en: "Tool requested" },
      AGENT_TOOL_COMPLETED: { zh: "\u5DE5\u5177\u57F7\u884C\u5B8C\u6210", en: "Tool completed" },
      AGENT_WAITING_FOR_HUMAN: { zh: "\u7B49\u5F85\u4EBA\u5DE5\u78BA\u8A8D", en: "Waiting for human" },
      AGENT_RESUMED: { zh: "\u6062\u5FA9\u4EE3\u7406\u57F7\u884C", en: "Agent resumed" },
      AGENT_COMPLETED: { zh: "\u4EE3\u7406\u57F7\u884C\u5B8C\u6210", en: "Agent completed" },
      AGENT_NOT_COVERED: { zh: "\u8D85\u51FA\u76EE\u524D\u6DB5\u84CB\u7BC4\u570D", en: "Outside coverage boundary" },
      AGENT_PROPOSAL_REJECTED: { zh: "\u62D2\u7D55\u4E0D\u5B89\u5168\u898F\u5283\u63D0\u6848", en: "Proposal rejected" },
      // No proposal existed in these two cases, so they must never read as "rejected".
      AGENT_PLANNER_TIMEOUT_FALLBACK: { zh: "\u898F\u5283\u5668\u903E\u6642 \u2014 \u555F\u7528\u78BA\u5B9A\u6027\u5099\u63F4\u6D41\u7A0B", en: "Planner timeout \u2014 deterministic fallback activated" },
      AGENT_PLANNER_UNAVAILABLE_FALLBACK: { zh: "\u898F\u5283\u5668\u7121\u6CD5\u4F7F\u7528 \u2014 \u555F\u7528\u78BA\u5B9A\u6027\u5099\u63F4\u6D41\u7A0B", en: "Planner unavailable \u2014 deterministic fallback activated" },
      DETERMINISTIC_WORKFLOW_COMPLETED: { zh: "\u78BA\u5B9A\u6027\u6D41\u7A0B\u5B8C\u6210", en: "Deterministic workflow completed" },
      AGENT_PROVIDER_SELECTED: { zh: "\u9078\u5B9A\u6A21\u578B\u4F9B\u61C9\u8005", en: "Provider selected" },
      AGENT_PROVIDER_CALL_STARTED: { zh: "\u958B\u59CB\u547C\u53EB\u6A21\u578B", en: "Provider call started" },
      AGENT_PROVIDER_CALL_COMPLETED: { zh: "\u6A21\u578B\u56DE\u50B3\u898F\u5283\u63D0\u6848", en: "Provider returned a proposal" },
      AGENT_PROVIDER_CALL_FAILED: { zh: "\u6A21\u578B\u547C\u53EB\u5931\u6557", en: "Provider call failed" },
      AGENT_PROVIDER_FALLBACK: { zh: "\u5207\u63DB\u81F3\u4E0B\u4E00\u500B\u6A21\u578B\u4F9B\u61C9\u8005", en: "Falling back to next provider" },
      AGENT_PROVIDER_UNAVAILABLE: { zh: "\u6240\u6709\u6A21\u578B\u7686\u7121\u6CD5\u4F7F\u7528", en: "All providers unavailable" },
      AGENT_HUMAN_INPUT_INVALID: { zh: "\u4EBA\u5DE5\u8F38\u5165\u683C\u5F0F\u7121\u6548", en: "Invalid human input" }
    };
  }
});

// src/guidance.ts
var init_guidance = __esm({
  "src/guidance.ts"() {
    "use strict";
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
    init_ui_copy();
    init_guidance();
    init_guidance();
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
    if (body.goal === void 0) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "MISSING_GOAL",
        error: "Field 'goal' is required."
      });
      return;
    }
    if (typeof body.goal !== "string") {
      sendJson(response, 400, {
        ok: false,
        errorCode: "INVALID_GOAL_TYPE",
        error: "Field 'goal' must be a string."
      });
      return;
    }
    const rawGoal = body.goal;
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
    const plannerStarted = performance.now();
    const llmResult = await callPlanner({
      goal: trimmedGoal,
      availableTools: allowlistedTools
    });
    const plannerLatencyMs = performance.now() - plannerStarted;
    const llmCallSucceeded = llmResult.providerStatus === "AVAILABLE" && Boolean(llmResult.decision);
    const executionMode = llmCallSucceeded ? "AGENT" : "DETERMINISTIC_FALLBACK";
    const fallbackActive = llmCallSucceeded ? (llmResult.fallbackCount ?? 0) > 0 : true;
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
        executionMode,
        fallbackActive,
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
var import_promises, import_node_http, import_node_path, import_node_url, PROJECT_ROOT, PORT, HOST, DIST_DIR, MAX_REQUEST_BODY_BYTES, MAX_GOAL_LENGTH, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, configuredRateLimitMax, rateLimitBuckets, ApiHttpError, MIME_TYPES, server;
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
    PROJECT_ROOT = process.cwd();
    try {
      process.loadEnvFile((0, import_node_path.resolve)(PROJECT_ROOT, ".env"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    PORT = Number(process.env.PORT ?? 8787);
    HOST = "127.0.0.1";
    DIST_DIR = (0, import_node_path.resolve)(PROJECT_ROOT, "dist");
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

// src/vercel-health.ts
var vercel_health_exports = {};
__export(vercel_health_exports, {
  default: () => handleHealth
});
module.exports = __toCommonJS(vercel_health_exports);

// src/vercel-handler.ts
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

// src/vercel-health.ts
function handleHealth(request, response) {
  return handler(request, response);
}
