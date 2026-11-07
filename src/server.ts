import { createServer } from "node:http";
import { URL } from "node:url";

import { callOpenAIPlanner, isOpenAIConfigured } from "./agent/client";
import { buildSafePlan } from "./agent/orchestrator";
import { listAllowedTools } from "./agent/tools";

const PORT = Number(process.env.PORT ?? 8787);

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        status: isOpenAIConfigured() ? "configured" : "provider_unavailable",
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

    const llmResult = await callOpenAIPlanner({
      goal,
      availableTools: allowlistedTools,
    });

    const responseBody = {
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
      },
    };

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responseBody));
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`GovAid Atlas agent API listening on http://localhost:${PORT}`);
});
