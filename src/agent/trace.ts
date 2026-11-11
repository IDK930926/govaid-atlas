import type { EligibilityStatus } from "../types";
import type { AgentRun, AgentStatus, AgentTraceEvent } from "./types";

const SENSITIVE_KEY_PATTERN =
  /^(api[_-]?key|openai[_-]?api[_-]?key|token|access[_-]?token|secret|password|authorization|auth|bearer|system[_-]?prompt|hidden[_-]?prompt|raw[_-]?prompt|chain[_-]?of[_-]?thought|thinking|cot|national[_-]?id|phone|name)$/i;

const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)/g;

export function sanitizeForTrace(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "string") {
    return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForTrace(item, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      out[key] = sanitizeForTrace(entry, depth + 1);
    }
    return out;
  }

  return String(value);
}

export type AgentTraceDocument = {
  schemaVersion: "wave2-trace-v1";
  runId: string;
  exportedAt: string;
  goalSummary: string;
  maxSteps: number;
  stepsTaken: number;
  finalStatus: AgentStatus;
  finalEligibilityStatus: EligibilityStatus | "HUMAN_REVIEW_REQUIRED" | null;
  coverageStatus: "COVERED" | "NOT_COVERED" | "MISSING";
  events: AgentTraceEvent[];
};

export function serializeAgentTrace(run: AgentRun): AgentTraceDocument {
  const lastEvent = run.trace[run.trace.length - 1];
  const finalEligibilityStatus =
    run.state?.overallEligibilityStatus ??
    run.toolResult?.status ??
    lastEvent?.eligibilityStatus ??
    (run.status === "NOT_COVERED" ? "NOT_COVERED" : null);

  const coverageStatus =
    run.coverage?.status ??
    lastEvent?.coverageStatus ??
    (run.status === "NOT_COVERED" ? "NOT_COVERED" : "COVERED");

  return {
    schemaVersion: "wave2-trace-v1",
    runId: run.runId,
    exportedAt: new Date().toISOString(),
    goalSummary: String(sanitizeForTrace(run.goal.slice(0, 300))),
    maxSteps: run.maximumSteps,
    stepsTaken: run.stepsTaken,
    finalStatus: run.status,
    finalEligibilityStatus,
    coverageStatus,
    events: (sanitizeForTrace(run.trace) as AgentTraceEvent[]) ?? [],
  };
}

export async function exportAgentTrace(
  run: AgentRun,
  baseDir?: string
): Promise<string> {
  const safeFileId = run.runId.replace(/[^A-Za-z0-9._-]/g, "_");
  const doc = serializeAgentTrace(run);
  const content = `${JSON.stringify(doc, null, 2)}\n`;

  const fsModuleId = "node:fs/promises";
  const pathModuleId = "node:path";
  const osModuleId = "node:os";
  const { mkdir, writeFile } = (await import(/* @vite-ignore */ fsModuleId)) as typeof import("node:fs/promises");
  const { resolve } = (await import(/* @vite-ignore */ pathModuleId)) as typeof import("node:path");
  const { tmpdir } = (await import(/* @vite-ignore */ osModuleId)) as typeof import("node:os");
  const targetDir = baseDir ?? resolve(process.cwd(), "artifacts/traces");

  try {
    await mkdir(targetDir, { recursive: true });
    const filePath = resolve(targetDir, `${safeFileId}.json`);
    await writeFile(filePath, content, "utf8");
    return filePath;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) {
      const fallbackDir = resolve(tmpdir(), "govaid-atlas-traces");
      await mkdir(fallbackDir, { recursive: true });
      const fallbackPath = resolve(fallbackDir, `${safeFileId}.json`);
      await writeFile(fallbackPath, content, "utf8");
      return fallbackPath;
    }
    throw error;
  }
}
