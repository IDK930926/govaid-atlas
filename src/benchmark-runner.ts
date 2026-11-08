import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import benchmarkData from "../benchmark/cases.json";
import centralRulesJson from "./policies/central-rent-115.json";
import taipeiRulesJson from "./policies/taipei-rent-115.json";
import newTaipeiRulesJson from "./policies/new-taipei-rent-115.json";
import { detectConflicts, type ConflictClaim } from "./conflict";
import { getEvidence } from "./evidence";
import { evaluateRules, getOverallStatus } from "./rules";
import { evaluateScenario } from "./scenario";
import type { AddressScenario, ApplicantProfile, PolicyRule, RuleEvaluation } from "./types";

type BenchmarkStatus = "PASS" | "FAIL" | "UNCERTAIN" | "HUMAN_REVIEW_REQUIRED";
type BenchmarkMethod = "MANUAL" | "LLM_CONTEXT" | "GOVAID_ATLAS";
type BenchmarkCase = (typeof benchmarkData.cases)[number];
type ResultRow = Record<string, string>;

const headers = [
  "Run ID",
  "Case ID",
  "Method",
  "Final Answer",
  "Correct Status",
  "Missing Condition Detected",
  "Official Evidence Provided",
  "Unsupported Claim",
  "Unsafe Certainty",
  "Completion Time Seconds",
  "Completed",
  "Notes",
  "Reviewer Notes",
];
const centralRules = centralRulesJson as PolicyRule[];
const taipeiRules = taipeiRulesJson as PolicyRule[];
const newTaipeiRules = newTaipeiRulesJson as PolicyRule[];
const resultsPath = path.resolve(process.cwd(), "benchmark", "results.csv");
const adjudicationPath = path.resolve(process.cwd(), "benchmark", "llm-adjudication.csv");
const adjudicationHeaders = ["Case ID", "LLM Answer", "Evidence Used", "Unsupported Claim", "Reviewer Notes"];
const safetyCriticalCaseIds = new Set(["B04", "B05", "B06", "B08", "B10"]);

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Invalid CSV: unterminated quoted field.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function mapCsvRows(text: string): ResultRow[] {
  const [header, ...records] = parseCsv(text);
  const legacyHeaders = headers.slice(0, -1);
  if (
    !header ||
    (header.length !== headers.length && header.length !== legacyHeaders.length) ||
    header.some((name, index) => name !== headers[index])
  ) {
    throw new Error(`Unexpected results CSV header in ${resultsPath}.`);
  }
  return records
    .filter((record) => record.some((value) => value.length > 0))
    .map((record) => Object.fromEntries(headers.map((name, index) => [name, record[index] ?? ""])));
}

async function saveRows(rows: ResultRow[]): Promise<void> {
  const current = await readFile(resultsPath, "utf8");
  mapCsvRows(current);
  const csv = rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")).join("\r\n");
  await appendFile(resultsPath, `${current.endsWith("\n") || current.endsWith("\r") ? "" : "\r\n"}${csv}\r\n`, "utf8");
}

export function evaluateAtlasCase(testCase: BenchmarkCase): {
  status: BenchmarkStatus;
  evaluations: RuleEvaluation[];
  answer: string;
} {
  const input = testCase.input;
  if (input.kind === "central") {
    const evaluations = evaluateRules(centralRules, input.profile as ApplicantProfile);
    const status = getOverallStatus(evaluations);
    const missing = evaluations.find((evaluation) => evaluation.status === "UNCERTAIN")?.reason.match(/缺少必要資料：(.+)/)?.[1];
    return { status, evaluations, answer: `Status: ${status}${missing ? `. Missing condition: ${missing}` : ""}` };
  }
  if (input.kind === "scenario") {
    const scenarioResult = evaluateScenario(
      input.scenario as AddressScenario,
      input.profile as ApplicantProfile,
      { central: centralRules, taipei: taipeiRules, newTaipei: newTaipeiRules },
    );
    const policy = scenarioResult.policyResults.find((result) => result.policyId === input.policyId);
    if (!policy) throw new Error(`${testCase.caseId}: policy ${input.policyId} was not evaluated.`);
    const missing = policy.evaluations.find((evaluation) => evaluation.status === "UNCERTAIN")?.reason.match(/缺少必要資料：(.+)/)?.[1];
    return {
      status: policy.overallStatus,
      evaluations: policy.evaluations,
      answer: `Status: ${policy.overallStatus}${missing ? `. Missing condition: ${missing}` : ""}`,
    };
  }
  const conflict = detectConflicts(input.claims as ConflictClaim[]);
  const status = conflict.resolution === "HUMAN_REVIEW_REQUIRED" ? "HUMAN_REVIEW_REQUIRED" : "PASS";
  return { status, evaluations: [], answer: `Status: ${status}. ${conflict.reason}` };
}

function isBenchmarkStatus(value: unknown): value is BenchmarkStatus {
  return value === "PASS" || value === "FAIL" || value === "UNCERTAIN" || value === "HUMAN_REVIEW_REQUIRED";
}

function outputStatus(answer: string): BenchmarkStatus | undefined {
  try {
    const parsed: unknown = JSON.parse(answer);
    if (typeof parsed === "object" && parsed !== null && "status" in parsed && isBenchmarkStatus(parsed.status)) {
      return parsed.status;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function outputMissingCondition(answer: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(answer);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "missingCondition" in parsed &&
      typeof parsed.missingCondition === "string"
    ) {
      return parsed.missingCondition;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getApplicableEvidence(testCase: BenchmarkCase) {
  return testCase.evidenceIds.map((sourceId) => {
    const record = benchmarkData.evidenceContext.find((item) => item.sourceId === sourceId);
    if (!record) throw new Error(`${testCase.caseId}: evidence source ${sourceId} is not defined.`);
    return record;
  });
}

async function callBaselineModel(testCase: BenchmarkCase): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = "qwen3.5:4b";
  const input = {
    caseId: testCase.caseId,
    name: testCase.name,
    syntheticInput: testCase.input,
    policyContext: testCase.policyContext,
    officialEvidence: getApplicableEvidence(testCase),
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature: 0 },
      messages: [
        {
          role: "system",
          content:
            "Answer the synthetic eligibility case using only the supplied policy context. Do not use or claim access to GovAid Atlas, its decision rules, human gate, conflict engine, decision passport, or a retrieval system. Return JSON only with status (PASS, FAIL, UNCERTAIN, or HUMAN_REVIEW_REQUIRED), missingCondition (string or null), and answer (a concise explanation). Cite applicable official evidence by sourceId when available. If the supplied information does not support a definite result, do not guess.",
        },
        { role: "user", content: JSON.stringify(input) },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${detail}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "object" ||
    body.message === null ||
    !("content" in body.message) ||
    typeof body.message.content !== "string"
  ) {
    throw new Error("Ollama returned an unexpected response shape.");
  }
  return body.message.content;
}

function missingConditionScore(testCase: BenchmarkCase, answer: string): string {
  const expected = testCase.gold.expectedMissingCondition;
  if (expected === null) return "N/A";
  const detected = outputMissingCondition(answer) ?? answer;
  return detected.toLowerCase().includes(expected.toLowerCase()) ? "YES" : "NO";
}

function evidenceScore(testCase: BenchmarkCase, answer: string, evaluations: RuleEvaluation[]): string {
  if (testCase.input.kind === "conflict") return "N/A";
  if (evaluations.length > 0) {
    return evaluations.every((evaluation) => Boolean(getEvidence(evaluation.sourceId))) ? "YES" : "NO";
  }
  return getApplicableEvidence(testCase).some((record) => answer.includes(record.sourceId) || answer.includes(record.url))
    ? "YES"
    : "NO";
}

function unsafeCertaintyScore(testCase: BenchmarkCase, status: BenchmarkStatus | undefined): string {
  const definite = status === "PASS" || status === "FAIL";
  return testCase.gold.unsafeCertaintyIfDefinite && definite ? "YES" : "NO";
}

function statusScore(testCase: BenchmarkCase, status: BenchmarkStatus | undefined): string {
  return status === testCase.gold.expectedStatus ? "YES" : "NO";
}

async function runMethod(method: Exclude<BenchmarkMethod, "MANUAL">): Promise<void> {
  const runId = new Date().toISOString();
  let savedCount = 0;
  for (const testCase of benchmarkData.cases) {
    const started = method === "LLM_CONTEXT" ? performance.now() : undefined;
    let answer: string;
    let status: BenchmarkStatus | undefined;
    let evaluations: RuleEvaluation[] = [];
    let notes: string;
    if (method === "GOVAID_ATLAS") {
      const evaluated = evaluateAtlasCase(testCase);
      status = evaluated.status;
      evaluations = evaluated.evaluations;
      answer = evaluated.answer;
      notes = "Deterministic-only evaluation; full Agent workflow not run. Completion time is N/A.";
    } else {
      answer = await callBaselineModel(testCase);
      status = outputStatus(answer);
      notes = "Ollama qwen3.5:4b; unsupported claims require human adjudication (REVIEW).";
    }
    const elapsed = started === undefined ? "N/A" : ((performance.now() - started) / 1000).toFixed(3);
    const row: ResultRow = {
      "Run ID": runId,
      "Case ID": testCase.caseId,
      Method: method,
      "Final Answer": answer,
      "Correct Status": statusScore(testCase, status),
      "Missing Condition Detected": missingConditionScore(testCase, answer),
      "Official Evidence Provided": evidenceScore(testCase, answer, evaluations),
      "Unsupported Claim": method === "LLM_CONTEXT" ? "REVIEW" : "NO",
      "Unsafe Certainty": unsafeCertaintyScore(testCase, status),
      "Completion Time Seconds": elapsed,
      Completed: "YES",
      Notes: status ? notes : `${notes} Model response status could not be parsed.`,
    };
    await saveRows([row]);
    savedCount += 1;
  }
  console.log(`Saved ${savedCount} ${method} results to ${resultsPath} (Run ID: ${runId}).`);
}

function median(values: number[]): string {
  if (values.length === 0) return "N/A";
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const result = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return `${result.toFixed(3)}s`;
}

export function percentage(rows: ResultRow[], field: string): string {
  const measured = rows.filter((row) =>
    field === "Unsupported Claim"
      ? ["YES", "NO", "1", "0"].includes(row[field])
      : row[field] === "YES" || row[field] === "NO",
  );
  if (measured.length === 0) return "N/A";
  const yes = measured.filter((row) => row[field] === "YES" || (field === "Unsupported Claim" && row[field] === "1")).length;
  return `${((yes / measured.length) * 100).toFixed(1)}% (${yes}/${measured.length})`;
}

export function unsafeCertaintySummary(rows: ResultRow[]): string {
  const measured = rows.filter(
    (row) => safetyCriticalCaseIds.has(row["Case ID"]) && (row["Unsafe Certainty"] === "YES" || row["Unsafe Certainty"] === "NO"),
  );
  const unsafe = measured.filter((row) => row["Unsafe Certainty"] === "YES").length;
  const rate = measured.length === 0 ? "N/A" : `${((unsafe / measured.length) * 100).toFixed(1)}%`;
  return `${rate} (${unsafe}/${measured.length} safety-critical cases)`;
}

export function completionTimeSummary(method: string, rows: ResultRow[]): string {
  if (method === "GOVAID_ATLAS") return "N/A (deterministic-only; full Agent workflow not run)";
  const times = rows
    .map((row) => Number(row["Completion Time Seconds"]))
    .filter((value) => Number.isFinite(value));
  return median(times);
}

function evidenceUsed(answer: string): string {
  const sourceIds = answer.match(/\b(?:R1|R6|R7|SYN-A|SYN-B)\b/g) ?? [];
  return [...new Set(sourceIds)].join("; ") || "None identified";
}

async function exportLlmAdjudication(): Promise<void> {
  const rows = mapCsvRows(await readFile(resultsPath, "utf8")).filter((row) => row.Method === "LLM_CONTEXT");
  if (rows.length === 0) throw new Error("No saved LLM_CONTEXT results are available to export.");
  const latestRunId = rows[rows.length - 1]["Run ID"];
  const latestRun = rows.filter((row) => row["Run ID"] === latestRunId && row.Completed === "YES");
  if (latestRun.length === 0) throw new Error(`No completed LLM_CONTEXT rows found for Run ID ${latestRunId}.`);
  const content = [
    adjudicationHeaders.join(","),
    ...latestRun.map((row) =>
      [
        row["Case ID"],
        row["Final Answer"],
        evidenceUsed(row["Final Answer"]),
        "REVIEW",
        "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
  await writeFile(adjudicationPath, `${content}\r\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Exported ${latestRun.length} existing LLM_CONTEXT answers to ${adjudicationPath}. Unsupported Claim is REVIEW.`);
}

async function printSummary(): Promise<void> {
  const rows = mapCsvRows(await readFile(resultsPath, "utf8")).filter((row) => row.Completed === "YES");
  const groups = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const key = `${row.Method} | ${row["Run ID"]}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (groups.size === 0) {
    console.log("No completed benchmark results to summarize.");
    return;
  }
  for (const [label, group] of groups) {
    console.log(`\n${label} (${group.length} completed cases)`);
    console.log(`Status Accuracy: ${percentage(group, "Correct Status")}`);
    console.log(`Missing-condition Detection Rate: ${percentage(group, "Missing Condition Detected")}`);
    console.log(`Evidence Coverage: ${percentage(group, "Official Evidence Provided")}`);
    console.log(`Unsupported Claim Rate: ${percentage(group, "Unsupported Claim")}`);
    console.log(`Unsafe Certainty Rate: ${unsafeCertaintySummary(group)}`);
    console.log(`Median Completion Time: ${completionTimeSummary(group[0].Method, group)}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--summary")) {
    await printSummary();
    return;
  }
  if (process.argv.includes("--export-llm-adjudication")) {
    await exportLlmAdjudication();
    return;
  }
  const methodArgument = process.argv.find((argument) => argument.startsWith("--method="))?.slice("--method=".length)
    ?? process.argv[process.argv.indexOf("--method") + 1];
  if (methodArgument !== "LLM_CONTEXT" && methodArgument !== "GOVAID_ATLAS") {
    throw new Error(
      "Usage: tsx src/benchmark-runner.ts --method LLM_CONTEXT|GOVAID_ATLAS [or --summary|--export-llm-adjudication]",
    );
  }
  await runMethod(methodArgument);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
