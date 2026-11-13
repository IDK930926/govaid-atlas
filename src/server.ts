import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import { callPlanner, getProviderHealth } from "./agent/client";
import { buildSafePlan } from "./agent/orchestrator";
import { listAllowedTools } from "./agent/tools";
import type { AgentDecision } from "./agent/types";
import { getRuntimeDisplayMode } from "./agent/providers/types";
import { assessQueryCoverage, detectBenefitDomain } from "./coverage";

// Secrets such as OPENAI_API_KEY stay server-side: load an optional, gitignored .env into this
// process only. Values already present in the real environment take precedence.
try {
  process.loadEnvFile(resolve(__dirname, "../.env"));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const DIST_DIR = resolve(__dirname, "../dist");

export const MAX_REQUEST_BODY_BYTES = 16 * 1024; // 16 KB
export const MAX_GOAL_LENGTH = 800; // characters
export const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
export const RATE_LIMIT_MAX_REQUESTS = 20;

let configuredRateLimitMax = RATE_LIMIT_MAX_REQUESTS;

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateBucket>();

export function resetRateLimiter(): void {
  rateLimitBuckets.clear();
  configuredRateLimitMax = RATE_LIMIT_MAX_REQUESTS;
}

export function setRateLimitMaxRequests(limit: number): void {
  configuredRateLimitMax = limit;
}

export function checkRateLimit(
  clientKey: string,
  now = Date.now()
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const existing = rateLimitBuckets.get(clientKey);
  if (!existing || now >= existing.resetAt) {
    rateLimitBuckets.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: Math.max(0, configuredRateLimitMax - 1),
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= configuredRateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, configuredRateLimitMax - existing.count),
    retryAfterSeconds: 0,
  };
}

class ApiHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const MIME_TYPES: Record<string, string> = {
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
  ".woff2": "font/woff2",
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readBody(
  request: IncomingMessage,
  maxBytes = MAX_REQUEST_BODY_BYTES
): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiHttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds maximum size of ${maxBytes} bytes.`
    );
  }

  const parsedBody = (request as IncomingMessage & { body?: unknown }).body;
  let raw: string;
  if (parsedBody !== undefined) {
    raw = Buffer.isBuffer(parsedBody)
      ? parsedBody.toString("utf8")
      : parsedBody instanceof Uint8Array
        ? Buffer.from(parsedBody).toString("utf8")
        : typeof parsedBody === "string"
          ? parsedBody
          : JSON.stringify(parsedBody) ?? "";
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

    const chunks: Buffer[] = [];
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiHttpError(400, "INVALID_JSON_BODY", "Request body must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiHttpError(400, "INVALID_BODY_OBJECT", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const filePath = resolve(DIST_DIR, `.${decodedPath}`);
  const relativePath = relative(DIST_DIR, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  let content: Buffer | undefined;
  let contentType: string | undefined;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      content = await readFile(filePath);
      contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
      throw error;
    }
  }

  if (!content && (!extname(decodedPath) || request.headers.accept?.includes("text/html"))) {
    const indexPath = resolve(DIST_DIR, "index.html");
    content = await readFile(indexPath);
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
    "Cache-Control": decodedPath === "/" || extname(decodedPath) === "" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

function getClientIp(request: IncomingMessage): string {
  return request.socket?.remoteAddress ?? "127.0.0.1";
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname === "/health"
    ? "/api/health"
    : url.pathname === "/agent/plan"
      ? "/api/agent/plan"
      : url.pathname;

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
      timestamp: new Date().toISOString(),
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
          retryAfterSeconds: rateStatus.retryAfterSeconds,
        },
        { "Retry-After": String(rateStatus.retryAfterSeconds) }
      );
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readBody(request, MAX_REQUEST_BODY_BYTES);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        sendJson(response, error.statusCode, {
          ok: false,
          errorCode: error.errorCode,
          error: error.message,
        });
        return;
      }
      throw error;
    }

    if (body.goal === undefined) {
      // No implicit demo goal: a request without a goal must not be answered as a rental query.
      sendJson(response, 400, {
        ok: false,
        errorCode: "MISSING_GOAL",
        error: "Field 'goal' is required.",
      });
      return;
    }

    if (typeof body.goal !== "string") {
      sendJson(response, 400, {
        ok: false,
        errorCode: "INVALID_GOAL_TYPE",
        error: "Field 'goal' must be a string.",
      });
      return;
    }

    const rawGoal = body.goal;
    const trimmedGoal = rawGoal.trim();
    if (!trimmedGoal) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "EMPTY_GOAL",
        error: "Field 'goal' must not be empty.",
      });
      return;
    }

    if (rawGoal.length > MAX_GOAL_LENGTH) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "GOAL_TOO_LONG",
        error: `Field 'goal' exceeds maximum length of ${MAX_GOAL_LENGTH} characters.`,
      });
      return;
    }

    if (
      body.profile !== undefined &&
      (typeof body.profile !== "object" || body.profile === null || Array.isArray(body.profile))
    ) {
      sendJson(response, 400, {
        ok: false,
        errorCode: "INVALID_PROFILE",
        error: "Field 'profile' must be a JSON object.",
      });
      return;
    }

    const allowlistedTools = listAllowedTools();
    const domain = detectBenefitDomain(trimmedGoal);
    const coverage = assessQueryCoverage(trimmedGoal);
    const defaultPlan = buildSafePlan(trimmedGoal, domain);

    // Timeout hierarchy (per-attempt cap + whole-chain budget) is owned by callPlanner.
    const plannerStarted = performance.now();
    const llmResult = await callPlanner({
      goal: trimmedGoal,
      availableTools: allowlistedTools,
    });
    const plannerLatencyMs = performance.now() - plannerStarted;
    const llmCallSucceeded = llmResult.providerStatus === "AVAILABLE" && Boolean(llmResult.decision);
    // What actually happened: an LLM planner produced the decision, or none did and the
    // deterministic workflow decides. Health/config alone never makes this "AGENT".
    const executionMode = llmCallSucceeded ? "AGENT" : "DETERMINISTIC_FALLBACK";
    const fallbackActive = llmCallSucceeded ? (llmResult.fallbackCount ?? 0) > 0 : true;
    const lastAttempt = llmResult.attempts?.[llmResult.attempts.length - 1];
    const lastFailedAttempt = [...(llmResult.attempts ?? [])]
      .reverse()
      .find((attempt) => attempt.outcome === "FAILED" && attempt.callAttempted);
    const lastLlmFailureReason = lastFailedAttempt
      ? `${lastFailedAttempt.provider} · ${lastFailedAttempt.errorClass ?? "PROVIDER_UNAVAILABLE"}`
      : null;
    const responseProvider = llmResult.provider !== "UNAVAILABLE"
      ? llmResult.provider
      : lastAttempt?.provider ?? (llmResult.mode === "openai"
        ? "OPENAI"
        : llmResult.mode === "ollama"
          ? "OLLAMA"
          : "UNAVAILABLE");
    const responseModel = llmResult.model !== "N/A"
      ? llmResult.model
      : lastAttempt?.model ?? "N/A";

    const safeErrorCode = llmCallSucceeded
      ? null
      : llmResult.error === "AGENT_PROVIDER_TIMEOUT"
        ? "AGENT_PROVIDER_TIMEOUT"
        : llmResult.errorClass ?? "PROVIDER_UNAVAILABLE";

    const fallbackDecision: AgentDecision =
      coverage.status === "NOT_COVERED"
        ? {
            reasoningSummary:
              coverage.message ?? "Request is outside covered policies; safe fallback stops without tool execution.",
            nextAction: "COMPLETE",
          }
        : domain === "CHILDCARE"
          ? {
              reasoningSummary: "Live provider unavailable; fallback to deterministic childcare plan.",
              nextAction: "CALL_TOOL",
              toolName: "evaluate_childcare_rules",
              toolArguments: {
                profile: (body.profile as Record<string, unknown> | undefined) ?? {},
              },
            }
          : {
              reasoningSummary: "Live provider unavailable; fallback to deterministic plan and tool allowlist.",
              nextAction: "CALL_TOOL",
              toolName: "evaluate_central_rules",
              toolArguments: {
                profile: (body.profile as Record<string, unknown> | undefined) ?? {},
              },
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
          outputTokens: attempt.usage?.outputTokens ?? null,
        })),
        fallbackCount: llmResult.fallbackCount ?? 0,
        fallbackReason: llmResult.fallbackReason ?? null,
        providerEvents: llmResult.providerEvents ?? [],
        estimatedCloudCostUsd: llmResult.estimatedCloudCostUsd ?? null,
        pricingLabel: llmResult.pricingLabel ?? null,
      },
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

export const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error("Request failed", error);
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }

    sendJson(response, 500, {
      ok: false,
      errorCode: "INTERNAL_SERVER_ERROR",
      error: "Internal server error",
    });
  });
});

if (typeof require !== "undefined" && require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`GovAid Atlas production preview listening on http://${HOST}:${PORT}`);
  });
}
