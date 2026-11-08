import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import { callPlanner, getProviderHealth, getOllamaModel } from "./agent/client";
import { buildSafePlan } from "./agent/orchestrator";
import { listAllowedTools } from "./agent/tools";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const DIST_DIR = resolve(__dirname, "../dist");

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

async function readBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  if (!request.readable) {
    return {};
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveStatic(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, pathname: string): Promise<void> {
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

async function handleRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    const health = await getProviderHealth();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: health.providerStatus === "AVAILABLE",
        provider: health.provider,
        providerStatus: health.providerStatus,
        model: health.model ?? getOllamaModel(),
        status: health.providerStatus === "AVAILABLE" ? "configured" : "provider_unavailable",
        error: health.error ?? null,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/plan") {
    const body = (await readBody(request)) as {
      goal?: string;
      profile?: Record<string, unknown>;
    };

    const goal = body.goal ?? "Compare rental subsidy options.";
    const allowlistedTools = listAllowedTools();
    const defaultPlan = buildSafePlan(goal);

    const llmResult = await callPlanner({
      goal,
      availableTools: allowlistedTools,
    });

    const responseBody = {
      provider: llmResult.provider,
      providerStatus: llmResult.providerStatus,
      model: llmResult.model,
      goal,
      plan: defaultPlan,
      allowedTools: allowlistedTools,
      decision: llmResult.decision ?? {
        reasoningSummary: "Live provider unavailable; fallback to deterministic plan and tool allowlist.",
        nextAction: "CALL_TOOL",
        toolName: "evaluate_central_rules",
        toolArguments: {
          profile: body.profile ?? {},
        },
      },
      metadata: {
        usage: llmResult.usage ?? null,
        error: llmResult.error ?? null,
        llmCallAttempted: llmResult.callAttempted ?? false,
        llmCallSucceeded: llmResult.providerStatus === "AVAILABLE" && Boolean(llmResult.decision),
      },
    };

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responseBody));
    return;
  }

  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    await serveStatic(request, response, url.pathname);
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "Not found" }));
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error("Request failed", error);
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }

    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Internal server error" }));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GovAid Atlas production preview listening on http://${HOST}:${PORT}`);
});
