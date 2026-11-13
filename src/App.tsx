import React, {useEffect, useMemo, useRef, useState} from "react";
import {
  actorCopy,
  auditCopy,
  benchmarkCopy,
  resultCopy,
  roleCopy,
  statusCopy,
  statusDisplayCopy,
  summarizeFailReasons,
  toolCopy,
  workflowSteps,
} from "./ui-copy";

import {
  detectConflicts,
  syntheticConflictClaims,
  type ConflictCheckResult,
} from "./conflict";

import {
  getVisibleProfile,
  type SensitiveProfile,
  type UserRole,
} from "./permissions";

import {
  createRuntimeMetrics,
  measureSync,
  recordProviderRun,
  recordRuntimeCall,
  recordRuntimeOperation,
  type RuntimeCounterKey,
  type RuntimeMetrics,
} from "./metrics";

import {runBenchmark} from "./benchmark";
import {finalBenchmark} from "./benchmark-final";
import {RENTAL_SUBSIDY_COMPARISON_METADATA} from "./navigation";

import centralRulesJson from "./policies/central-rent-115.json";

import type {
  AddressScenario,
  ApplicantProfile,
  AuditEvent,
  EligibilityStatus,
  PolicyRule,
  RuleEvaluation,
} from "./types";

import {evaluateRules} from "./rules";
import type {ScenarioResult} from "./scenario";
import type {DecisionPassport} from "./passport";

import {
  createAgentRun,
  resumeAgentRun,
  resumeAgentWithFieldResponse,
  runAgenticGoldenCase,
} from "./agent/orchestrator";
import {listAllowedTools} from "./agent/tools";

import type {AgentRun, AgentStatus} from "./agent/types";
import {
  getRuntimeDisplayMode,
  type ProviderMode,
  type ProviderName,
  type ProviderPlannerResult,
  type ProviderUsage,
  type RuntimeDisplayMode,
} from "./agent/providers/types";

import {
  buildCaseDraft,
  buildPersonaChips,
  CASE_PRESETS,
  DEFAULT_GOAL,
  DUAL_CITY_ACTUAL_SCENARIO,
  extractFactsFromGoal,
  WENSHAN_WHAT_IF_SCENARIO,
  PRESET_HOUSING_APPLICANT,
  FIELD_SPECS,
  getGateControl,
  SELECTABLE_CITIES,
  submitHumanGateAnswer,
  toInputString,
  type CaseDraft,
  type CaseEditField,
  type CaseEdits,
  type CaseEditsByDomain,
  type CaseField,
  type CasePreset,
  EMPTY_CASE_EDITS,
} from "./case-input";
import { detectBenefitDomain } from "./coverage";

const centralRules = centralRulesJson as PolicyRule[];

const initialApplicant: ApplicantProfile = PRESET_HOUSING_APPLICANT;
const actualScenario: AddressScenario = DUAL_CITY_ACTUAL_SCENARIO;
const whatIfScenario: AddressScenario = WENSHAN_WHAT_IF_SCENARIO;
const taoyuanActualScenario: AddressScenario = CASE_PRESETS[1].actualScenario;
const initialChildcareApplicant: ApplicantProfile = CASE_PRESETS[2].applicant;
const DEMO_PRESETS = CASE_PRESETS;
const agentGoal = DEFAULT_GOAL;

const OWNS_HOME_QUESTION = "本人是否持有住宅？";

type ProviderInfo = {
  provider: ProviderName;
  providerStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  model: string;
  available: boolean;
  mode: RuntimeDisplayMode;
  providerMode: ProviderMode | null;
};

type RuntimeInference = {
  provider: ProviderName;
  model: string;
  available: boolean;
  mode: RuntimeDisplayMode;
  latencyMs: number | null;
  ruleFallbackUsed: boolean;
  providerFallbackCount: number;
  lastLlmFailureReason?: string | null;
  recordedAt: string;
};

type AgentPlanResponse = {
  provider: ProviderName;
  providerStatus: "AVAILABLE" | "UNAVAILABLE";
  model: string;
  available?: boolean;
  mode?: RuntimeDisplayMode;
  decision?: ProviderPlannerResult["decision"];
  metadata?: {
    usage?: ProviderUsage | null;
    error?: string | null;
    llmCallAttempted?: boolean;
    llmCallSucceeded?: boolean;
    mode?: ProviderMode | null;
    plannerLatencyMs?: number;
    llmCalls?: number;
    fallbackCount?: number;
    fallbackReason?: string | null;
    lastLlmFailureReason?: string | null;
    estimatedCloudCostUsd?: number | null;
    pricingLabel?: string | null;
  };
};

const RUNTIME_INFERENCE_STORAGE_KEY = "govaid-atlas.latest-inference.v1";

function isRuntimeInference(value: unknown): value is RuntimeInference {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.provider === "OPENAI" || record.provider === "OLLAMA" || record.provider === "UNAVAILABLE") &&
    typeof record.model === "string" &&
    typeof record.available === "boolean" &&
    (record.mode === "cloud" || record.mode === "local" || record.mode === "fallback") &&
    (record.latencyMs === null || (typeof record.latencyMs === "number" && Number.isFinite(record.latencyMs))) &&
    typeof record.ruleFallbackUsed === "boolean" &&
    typeof record.providerFallbackCount === "number" &&
    Number.isFinite(record.providerFallbackCount) &&
    (record.lastLlmFailureReason === undefined || record.lastLlmFailureReason === null || typeof record.lastLlmFailureReason === "string") &&
    typeof record.recordedAt === "string"
  );
}

function readStoredRuntimeInference(): {record: RuntimeInference | null; storageUnavailable: boolean} {
  if (typeof window === "undefined") return {record: null, storageUnavailable: false};
  try {
    const raw = window.localStorage.getItem(RUNTIME_INFERENCE_STORAGE_KEY);
    if (!raw) return {record: null, storageUnavailable: false};
    const parsed: unknown = JSON.parse(raw);
    return isRuntimeInference(parsed)
      ? {record: parsed, storageUnavailable: false}
      : {record: null, storageUnavailable: false};
  } catch {
    return {record: null, storageUnavailable: true};
  }
}

function providerDisplayName(provider: ProviderName): string {
  if (provider === "OPENAI") return "OpenAI";
  if (provider === "OLLAMA") return "Ollama";
  return "Agent";
}

function runtimeModeLabel(mode: RuntimeDisplayMode): string {
  if (mode === "cloud") return "Cloud";
  if (mode === "local") return "Local";
  return "Fallback";
}

const sensitiveProfile: SensitiveProfile = {
  name: "陳同學",
  nationalId: "A123456789",
  phone: "0912345678",
  monthlyIncome: 32000,
};

type Phase = "START" | "ANALYZE" | "DECIDE";
type GovernanceTab = "SAFETY" | "AUDIT" | "RUNTIME" | "EVAL";
type ResultStatus = EligibilityStatus;

function getCompletedToolResult<T>(run: AgentRun, toolName: string): T | null {
  const completed = [...run.auditTrail].reverse().find((event) => {
    if (event.action !== "AGENT_TOOL_COMPLETED" || !event.output || typeof event.output !== "object") {
      return false;
    }
    return (event.output as {toolName?: unknown}).toolName === toolName;
  });
  if (!completed?.output || typeof completed.output !== "object") {
    return null;
  }
  const result = (completed.output as {result?: unknown}).result;
  return result === undefined ? null : result as T;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function App() {
  const [userGoal, setUserGoal] = useState(DEFAULT_GOAL);
  const [caseEdits, setCaseEdits] = useState<CaseEditsByDomain>(EMPTY_CASE_EDITS);
  const [isCustomExpanded, setIsCustomExpanded] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const draft = useMemo(() => buildCaseDraft(userGoal, caseEdits), [userGoal, caseEdits]);
  const [applicant, setApplicant] = useState<ApplicantProfile>(() => draft.applicant);
  const [agentRunning, setAgentRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastInferenceSeconds, setLastInferenceSeconds] = useState<number | null>(null);
  const inferenceStartedAt = useRef<number | null>(null);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo>({
    provider: "UNAVAILABLE",
    providerStatus: "UNKNOWN",
    model: "N/A",
    available: false,
    mode: "fallback",
    providerMode: null,
  });
  const [storedInference] = useState(readStoredRuntimeInference);
  const [runtimeInference, setRuntimeInference] = useState<RuntimeInference | null>(() => storedInference.record);
  const [runtimeStorageUnavailable, setRuntimeStorageUnavailable] = useState(storedInference.storageUnavailable);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [centralEvaluation, setCentralEvaluation] = useState<RuleEvaluation[]>([]);
  const [actualResult, setActualResult] = useState<ScenarioResult | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<ScenarioResult | null>(null);
  const [passport, setPassport] = useState<DecisionPassport | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun>(() => createAgentRun(DEFAULT_GOAL));
  const [currentRole, setCurrentRole] = useState<UserRole>("APPLICANT");
  const [conflictResult, setConflictResult] = useState<ConflictCheckResult | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics>(createRuntimeMetrics());
  const [governanceTab, setGovernanceTab] = useState<GovernanceTab>("SAFETY");

  const benchmarkResult = useMemo(() => runBenchmark(), []);
  const visibleProfile = getVisibleProfile(currentRole, sensitiveProfile);

  useEffect(() => {
    if (!agentRunning) return;
    const tick = () => setElapsedSeconds((performance.now() - (inferenceStartedAt.current ?? performance.now())) / 1000);
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [agentRunning]);

  useEffect(() => {
    if (!runtimeInference || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(RUNTIME_INFERENCE_STORAGE_KEY, JSON.stringify(runtimeInference));
      setRuntimeStorageUnavailable(false);
    } catch {
      setRuntimeStorageUnavailable(true);
    }
  }, [runtimeInference]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", {signal: controller.signal})
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Provider health request failed: ${response.status}`);
        }
        return response.json() as Promise<{
          provider?: ProviderName;
          providerStatus?: "AVAILABLE" | "UNAVAILABLE";
          model?: string;
          available?: boolean;
          mode?: RuntimeDisplayMode;
          providerMode?: ProviderMode | null;
          fallbackActive?: boolean;
          error?: string | null;
        }>;
      })
      .then((health) => {
        const provider = health.provider ?? "UNAVAILABLE";
        const available = health.available ?? health.providerStatus === "AVAILABLE";
        const fallbackActive = health.fallbackActive ?? false;
        setProviderInfo({
          provider,
          providerStatus: health.providerStatus ?? "UNAVAILABLE",
          model: health.model ?? "N/A",
          available,
          mode: health.mode ?? getRuntimeDisplayMode(provider, available, fallbackActive),
          providerMode: health.providerMode ?? null,
        });
        setProviderError(health.error ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setProviderInfo((current) => ({
          ...current,
          providerStatus: "UNAVAILABLE",
          available: false,
          mode: "fallback",
        }));
        setProviderError(error instanceof Error ? error.message : "Provider health request failed.");
      });
    return () => controller.abort();
  }, []);

  function audit(
    actor: AuditEvent["actor"],
    action: string,
    input?: unknown,
    output?: unknown,
    policyVersion = "CENTRAL-RENT-115"
  ) {
    setAuditTrail((current) => [
      ...current,
      {
        timestamp: new Date().toISOString(),
        actor,
        action,
        input,
        output,
        policyVersion,
      },
    ]);
  }

  function recordMetric(counter: RuntimeCounterKey, latencyMs: number) {
    setRuntimeMetrics((current) => recordRuntimeOperation(current, counter, latencyMs));
  }

  function changeRole(role: UserRole) {
    if (role === currentRole) {
      return;
    }

    setCurrentRole(role);
    audit("SYSTEM", "ROLE_CHANGED", {role}, undefined, "RBAC-V1");

    const measured = measureSync(() => getVisibleProfile(role, sensitiveProfile));
    const result = measured.result;
    recordMetric("permissionChecks", measured.latencyMs);

    if (!result.permission.allowed) {
      audit("SYSTEM", "ACCESS_DENIED", {role, resource: "SENSITIVE_PROFILE"}, {reason: result.permission.reason}, "RBAC-V1");
      return;
    }

    if (result.permission.masked) {
      audit("SYSTEM", "MASKED_PROFILE_ACCESSED", {role, resource: "SENSITIVE_PROFILE"}, {masked: true}, "RBAC-V1");
      return;
    }

    audit("SYSTEM", "SENSITIVE_PROFILE_ACCESSED", {role, resource: "SENSITIVE_PROFILE"}, {masked: false}, "RBAC-V1");
  }

  function handleSelectPreset(preset: CasePreset) {
    setUserGoal(preset.goal);
    setGateError(null);
    setCaseEdits((prev) => ({
      ...prev,
      [preset.domain]: {},
    }));
  }

  function handleFieldEdit(field: CaseEditField, value: string) {
    setGateError(null);
    setCaseEdits((prev) => ({
      ...prev,
      [draft.domain]: {
        ...prev[draft.domain],
        [field]: value,
      },
    }));
  }

  function handleResetEdits() {
    setGateError(null);
    setCaseEdits((prev) => ({
      ...prev,
      [draft.domain]: {},
    }));
  }

  function startGoldenCase() {
    const freshApplicant = {...PRESET_HOUSING_APPLICANT};
    setApplicant(freshApplicant);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setConflictResult(null);
    setAuditTrail([]);
    setGateError(null);

    const newRun = runAgenticGoldenCase(DEFAULT_GOAL, freshApplicant, DUAL_CITY_ACTUAL_SCENARIO, WENSHAN_WHAT_IF_SCENARIO);
    setAgentRun(newRun);

    const measured = measureSync(() => evaluateRules(centralRules, freshApplicant));
    const evaluation = measured.result;
    recordMetric("rulesEngineCalls", measured.latencyMs);
    setCentralEvaluation(evaluation);

    setAuditTrail([
      {
        timestamp: new Date().toISOString(),
        actor: "USER",
        action: "CASE_CREATED",
        input: freshApplicant,
        policyVersion: "CENTRAL-RENT-115",
      },
      {
        timestamp: new Date().toISOString(),
        actor: "RULE_ENGINE",
        action: "INITIAL_EVALUATION",
        output: evaluation,
        policyVersion: "CENTRAL-RENT-115",
      },
      {
        timestamp: new Date().toISOString(),
        actor: "AGENT",
        action: "HUMAN_CONFIRMATION_REQUIRED",
        input: {missingField: "ownsHome"},
        policyVersion: "CENTRAL-RENT-115",
      },
    ]);
  }

  function recordAgentToolMetrics(run: AgentRun, fromIndex = 0) {
    setRuntimeMetrics((current) => run.auditTrail.slice(fromIndex).reduce((metrics, event) => {
      if (event.action !== "AGENT_TOOL_REQUESTED" || !event.input || typeof event.input !== "object") {
        return metrics;
      }
      const toolName = (event.input as {toolName?: unknown}).toolName;
      if (toolName === "evaluate_central_rules" || toolName === "evaluate_childcare_rules") {
        return recordRuntimeCall(metrics, "rulesEngineCalls");
      }
      if (toolName === "evaluate_actual_scenario" || toolName === "evaluate_what_if_scenario") {
        return recordRuntimeCall(metrics, "scenarioEvaluations");
      }
      if (toolName === "generate_decision_passport" || toolName === "generate_childcare_passport") {
        return recordRuntimeCall(metrics, "passportGenerations");
      }
      if (toolName === "detect_policy_conflict") {
        return recordRuntimeCall(metrics, "conflictChecks");
      }
      return metrics;
    }, current));
  }

  async function runCustomGoal() {
    const goal = userGoal.trim();
    if (!goal || agentRunning) {
      return;
    }

    const currentDraft = buildCaseDraft(goal, caseEdits);
    if (!currentDraft.valid) {
      return;
    }

    const freshApplicant = currentDraft.applicant;
    const selectedActualScenario = currentDraft.actualScenario;
    const selectedWhatIfScenario = currentDraft.whatIfScenario;

    inferenceStartedAt.current = performance.now();
    setElapsedSeconds(0);
    setAgentRunning(true);
    setProviderError(null);
    setGateError(null);
    setApplicant(freshApplicant);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setCentralEvaluation([]);
    setAgentRun({...createAgentRun(goal), status: "PLANNING"});
    setAuditTrail([{
      timestamp: new Date().toISOString(),
      actor: "USER",
      action: "CASE_CREATED",
      input: freshApplicant,
      policyVersion: "CENTRAL-RENT-115",
    }]);

    let plannerResult: ProviderPlannerResult;
    let inferenceRecord: RuntimeInference | null = null;
    const plannerRequestStartedAt = performance.now();
    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({goal, profile: freshApplicant}),
      });
      if (!response.ok) {
        throw new Error(`Agent planner request failed: ${response.status}`);
      }
      const payload = await response.json() as AgentPlanResponse;
      const usage = payload.metadata?.usage ?? undefined;
      const succeeded = payload.metadata?.llmCallSucceeded ??
        (payload.providerStatus === "AVAILABLE" && Boolean(payload.decision));
      const available = payload.available ?? succeeded;
      const providerFallbackCount = payload.metadata?.fallbackCount ?? 0;
      const mode = payload.mode ?? getRuntimeDisplayMode(
        payload.provider,
        available,
        !succeeded || providerFallbackCount > 0
      );
      plannerResult = {
        provider: payload.provider,
        providerStatus: payload.providerStatus,
        model: payload.model,
        decision: succeeded ? payload.decision : undefined,
        usage: usage ?? undefined,
        callAttempted: payload.metadata?.llmCallAttempted ?? false,
        error: payload.metadata?.error ?? undefined,
      };
      setProviderInfo({
        provider: payload.provider,
        providerStatus: payload.providerStatus,
        model: payload.model,
        available,
        mode,
        providerMode: payload.metadata?.mode ?? null,
      });
      setProviderError(payload.metadata?.error ?? null);
      inferenceRecord = {
        provider: payload.provider,
        model: payload.model,
        available,
        mode,
        latencyMs: payload.metadata?.plannerLatencyMs ?? performance.now() - plannerRequestStartedAt,
        ruleFallbackUsed: !succeeded,
        providerFallbackCount,
        lastLlmFailureReason: payload.metadata?.lastLlmFailureReason ?? null,
        recordedAt: new Date().toISOString(),
      };
      if (plannerResult.callAttempted || providerFallbackCount > 0) {
        setRuntimeMetrics((current) => recordProviderRun(current, {
          llmCalls: payload.metadata?.llmCalls ?? 1,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          estimatedCloudCostUsd: payload.metadata?.estimatedCloudCostUsd ?? null,
          pricingLabel: payload.metadata?.pricingLabel ?? null,
          fallbackCount: providerFallbackCount,
          fallbackReason: payload.metadata?.fallbackReason ?? null,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent planner request failed.";
      setProviderInfo((current) => ({
        ...current,
        providerStatus: "UNAVAILABLE",
        available: false,
        mode: "fallback",
      }));
      setProviderError(message);
      inferenceRecord = {
        provider: providerInfo.provider,
        model: providerInfo.model,
        available: false,
        mode: "fallback",
        latencyMs: performance.now() - plannerRequestStartedAt,
        ruleFallbackUsed: true,
        providerFallbackCount: 0,
        recordedAt: new Date().toISOString(),
      };
      plannerResult = {
        provider: "UNAVAILABLE",
        providerStatus: "UNAVAILABLE",
        model: providerInfo.model,
        error: message,
      };
    }

    const run = runAgenticGoldenCase(goal, freshApplicant, selectedActualScenario, selectedWhatIfScenario, plannerResult, {
      includePassport: true,
      domain: currentDraft.domain,
      ...(currentDraft.requiredFields ? { requiredFields: [...currentDraft.requiredFields] } : {}),
    });
    if (inferenceRecord) {
      const ruleFallbackUsed = run.trace.some((step) => step.fallbackUsed);
      setRuntimeInference({
        ...inferenceRecord,
        mode: ruleFallbackUsed ? "fallback" : inferenceRecord.mode,
        ruleFallbackUsed,
        recordedAt: new Date().toISOString(),
      });
    }
    setAgentRun(run);
    recordAgentToolMetrics(run);
    const centralResult = getCompletedToolResult<{evaluations?: RuleEvaluation[]}>(run, "evaluate_central_rules");
    setCentralEvaluation(centralResult?.evaluations ?? []);
    const actual = getCompletedToolResult<ScenarioResult>(run, "evaluate_actual_scenario");
    const whatIf = getCompletedToolResult<ScenarioResult>(run, "evaluate_what_if_scenario");
    const completedPassport =
      getCompletedToolResult<DecisionPassport>(run, "generate_decision_passport") ??
      getCompletedToolResult<DecisionPassport>(run, "generate_childcare_passport");
    if (actual) setActualResult(actual);
    if (whatIf) setWhatIfResult(whatIf);
    if (completedPassport) setPassport(completedPassport);
    // Planner latency is only meaningful when the model actually returned a plan; a fast
    // failure followed by the rule-based fallback must read N/A, not "0.0 s".
    setLastInferenceSeconds(plannerResult.decision
      ? (performance.now() - (inferenceStartedAt.current ?? performance.now())) / 1000
      : null);
    setAgentRunning(false);
  }

  function respondToHuman(answer: boolean | number | string) {
    if (agentRun.status !== "WAITING_FOR_HUMAN" || agentRunning) {
      return;
    }
    setGateError(null);
    const targetField = agentRun.missingField ?? "ownsHome";
    const existingAuditCount = agentRun.auditTrail.length;
    audit("USER", "FIELD_CONFIRMED", {field: targetField, value: answer});

    const submission = submitHumanGateAnswer(agentRun, answer, {
      whatIfMirrorsActual: draft.whatIfMirrorsActual,
    });
    if (!submission.ok || submission.error) {
      setGateError(submission.error ?? "輸入資料無效，請確認後重新輸入。");
      setAgentRun(submission.run);
      return;
    }

    const resumed = submission.run;
    if (resumed.state?.applicant) {
      setApplicant(resumed.state.applicant);
    }
    setAgentRun(resumed);
    recordAgentToolMetrics(resumed, existingAuditCount);

    const centralResult = getCompletedToolResult<{evaluations?: RuleEvaluation[]}>(resumed, "evaluate_central_rules");
    setCentralEvaluation(centralResult?.evaluations ?? []);
    const actual = getCompletedToolResult<ScenarioResult>(resumed, "evaluate_actual_scenario");
    const whatIf = getCompletedToolResult<ScenarioResult>(resumed, "evaluate_what_if_scenario");
    const completedPassport =
      getCompletedToolResult<DecisionPassport>(resumed, "generate_decision_passport") ??
      getCompletedToolResult<DecisionPassport>(resumed, "generate_childcare_passport");
    if (actual && whatIf && completedPassport) {
      setActualResult(actual);
      setWhatIfResult(whatIf);
      setPassport(completedPassport);
    } else if (completedPassport) {
      setPassport(completedPassport);
    }
  }

  function resetDemo() {
    setCaseEdits(EMPTY_CASE_EDITS);
    setUserGoal(DEFAULT_GOAL);
    setApplicant({...PRESET_HOUSING_APPLICANT});
    setCentralEvaluation([]);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setAuditTrail([]);
    setConflictResult(null);
    setCurrentRole("APPLICANT");
    setRuntimeMetrics(createRuntimeMetrics());
    setAgentRun(createAgentRun(DEFAULT_GOAL));
    setProviderError(null);
    setGateError(null);
    setLastInferenceSeconds(null);
  }

  function runConflictTest() {
    const measured = measureSync(() => detectConflicts(syntheticConflictClaims));
    const result = measured.result;
    recordMetric("conflictChecks", measured.latencyMs);
    setConflictResult(result);
    audit("SYSTEM", "POLICY_CONFLICT_CHECK", syntheticConflictClaims, result, "SYNTHETIC-CONFLICT-TEST");

    if (result.status === "CONFLICT") {
      audit("AGENT", "HUMAN_REVIEW_REQUIRED", {reason: "POLICY_CONFLICT"}, result, "SYNTHETIC-CONFLICT-TEST");
    }
  }

  const displayedAuditTrail = [...auditTrail, ...agentRun.auditTrail]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  // ---------- Presentation state (derived only; never written back to the agent) ----------

  const status = agentRun.status;
  const phase: Phase = status === "IDLE" && !agentRunning
    ? "START"
    : status === "COMPLETED" && passport
      ? "DECIDE"
      : "ANALYZE";

  const drawerRef = useRef<HTMLDialogElement | null>(null);
  const focusTargetRef = useRef<HTMLHeadingElement | null>(null);

  function openGovernance(tab: GovernanceTab = "SAFETY") {
    setGovernanceTab(tab);
    const dialog = drawerRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  function closeGovernance() {
    drawerRef.current?.close();
  }

  function runGoldenFromControls() {
    closeGovernance();
    startGoldenCase();
  }

  // Move focus and scroll position with the phase so keyboard and screen-reader users follow the flow.
  const focusKey = `${phase}:${status}:${agentRunning ? "run" : "idle"}`;
  const previousFocusKey = useRef(focusKey);
  useEffect(() => {
    if (previousFocusKey.current === focusKey) {
      return;
    }
    const phaseChanged = previousFocusKey.current.split(":")[0] !== phase;
    previousFocusKey.current = focusKey;
    if (phaseChanged || status === "WAITING_FOR_HUMAN") {
      window.scrollTo({top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth"});
    }
    if (phase !== "START") {
      focusTargetRef.current?.focus({preventScroll: true});
    }
  }, [focusKey, phase, status]);

  const providerKind = providerInfo.provider === "OPENAI"
    ? "CLOUD AGENT"
    : providerInfo.provider === "OLLAMA"
      ? "LOCAL AGENT"
      : "AGENT";
  const providerReady = providerInfo.available;
  const modelStatusState = providerInfo.providerStatus === "UNKNOWN"
    ? "checking"
    : !providerInfo.available
      ? "unavailable"
      : providerInfo.mode;
  const modelStatusLabel = providerInfo.providerStatus === "UNKNOWN"
    ? "AGENT · CHECKING"
    : !providerInfo.available
      ? "AGENT · UNAVAILABLE"
      : `${providerInfo.mode.toUpperCase()} · ${providerInfo.model}`;

  return (
    <div className={"app phase-" + phase.toLowerCase()}>
      <a className="skip-link" href="#main">跳到主要內容</a>

      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand" aria-label="GovAid Atlas">
            <span className="brand-mark" aria-hidden="true"/>
            GovAid Atlas
          </span>

          <WorkflowProgress status={status} running={agentRunning}/>

          <div className="topbar-actions">
            <button
              className={`model-status-pill model-status-${modelStatusState}`}
              type="button"
              onClick={() => openGovernance("RUNTIME")}
              aria-label={`開啟模型資訊 Runtime：${modelStatusLabel}`}
              aria-haspopup="dialog"
              title={modelStatusLabel}
            >
              <span className="model-status-dot" aria-hidden="true"/>
              <span>{modelStatusLabel}</span>
            </button>
            <span className={"phase-pill pill-" + (agentRunning ? "planning" : status.toLowerCase())} role="status" aria-live="polite">
              <span className="pill-dot" aria-hidden="true"/>
              {agentRunning ? "分析中" : statusDisplayCopy[status]}
            </span>
            <button className="ghost topbar-governance" type="button" onClick={() => openGovernance()} aria-haspopup="dialog">
              <span className="hide-sm">技術與治理</span><span className="show-sm">治理</span>
            </button>
            <button className="ghost" type="button" onClick={resetDemo} disabled={agentRunning}>重設</button>
          </div>
        </div>
      </header>

      <main id="main" className="main">
        {phase === "START" && (
          <StartView
            userGoal={userGoal}
            onGoalChange={setUserGoal}
            onSelectPreset={handleSelectPreset}
            draft={draft}
            caseEdits={caseEdits}
            onFieldEdit={handleFieldEdit}
            onResetEdits={handleResetEdits}
            isCustomExpanded={isCustomExpanded}
            onToggleExpand={setIsCustomExpanded}
            onSubmit={() => void runCustomGoal()}
            running={agentRunning}
            providerKind={providerKind}
            providerInfo={providerInfo}
            providerError={providerError}
          />
        )}

        {phase === "ANALYZE" && (
          <section className={"analyze phase-enter" + (status === "WAITING_FOR_HUMAN" ? " is-gated" : "")} aria-labelledby="action-title">
            <JourneyStepper run={agentRun} running={agentRunning}/>

            <div className="action-col">
              <CurrentAction
                run={agentRun}
                running={agentRunning}
                elapsedSeconds={elapsedSeconds}
                providerInfo={providerInfo}
                headingRef={focusTargetRef}
                gateError={gateError}
                onAnswer={respondToHuman}
                onReset={resetDemo}
              />
            </div>

            <ContextPanel
              run={agentRun}
              running={agentRunning}
              applicant={applicant}
              providerInfo={providerInfo}
              providerKind={providerKind}
              providerReady={providerReady}
              providerError={providerError}
              lastInferenceSeconds={lastInferenceSeconds}
            />
          </section>
        )}

        {phase === "DECIDE" && passport && (
          <ResultView
            run={agentRun}
            passport={passport}
            actual={actualResult}
            whatIf={whatIfResult}
            ownsHome={applicant.ownsHome ?? null}
            headingRef={focusTargetRef}
            onOpenGovernance={() => openGovernance("SAFETY")}
          />
        )}
      </main>

      <dialog
        ref={drawerRef}
        className="drawer"
        aria-labelledby="drawer-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeGovernance();
        }}
      >
        <div className="drawer-inner">
          <header className="drawer-head">
            <div>
              <h2 id="drawer-title">技術與治理</h2>
              <p className="en-companion" lang="en">Technical &amp; Governance</p>
            </div>
            <button className="icon-button" type="button" onClick={closeGovernance} aria-label="關閉技術與治理">×</button>
          </header>

          <GovernanceTabs current={governanceTab} onChange={setGovernanceTab}/>

          <div className="drawer-body" role="tabpanel" id={`gov-panel-${governanceTab}`} aria-labelledby={`gov-tab-${governanceTab}`} tabIndex={0}>
            {governanceTab === "SAFETY" && (
              <SafetyPanel
                currentRole={currentRole}
                onRoleChange={changeRole}
                visibleProfile={visibleProfile}
                conflictResult={conflictResult}
                onRunConflict={runConflictTest}
              />
            )}
            {governanceTab === "AUDIT" && (
              <AuditPanel
                events={displayedAuditTrail}
                debug={{status: agentRun.status, currentStep: agentRun.currentStep, lastToolCall: agentRun.lastToolCall, providerError, plan: agentRun.plan, decision: agentRun.lastDecision, centralEvaluation, auditTrail: displayedAuditTrail}}
                running={agentRunning}
                onRunGolden={runGoldenFromControls}
              />
            )}
            {governanceTab === "RUNTIME" && (
              <RuntimePanel
                metrics={runtimeMetrics}
                providerInfo={providerInfo}
                inference={runtimeInference}
                storageUnavailable={runtimeStorageUnavailable}
              />
            )}
            {governanceTab === "EVAL" && <EvaluationPanel deterministic={benchmarkResult}/>}
          </div>
        </div>
      </dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow progress (sticky header)
// ---------------------------------------------------------------------------

function workflowIndex(status: AgentStatus, running: boolean): number {
  if (running) return 1;
  switch (status) {
    case "IDLE": return 0;
    case "WAITING_FOR_HUMAN":
    case "HUMAN_REVIEW_REQUIRED":
    case "NOT_COVERED": return 2;
    case "COMPLETED": return 4;
    default: return 1;
  }
}

function WorkflowProgress({status, running}: {status: AgentStatus; running: boolean}) {
  const current = workflowIndex(status, running);
  const failed = (status === "FAILED" || status === "NOT_COVERED") && !running;
  const allDone = status === "COMPLETED";
  return (
    <nav className="progress" aria-label="分析進度">
      <ol>
        {workflowSteps.map((step, index) => {
          const done = index < current || (allDone && index <= current);
          const isCurrent = index === current && !allDone;
          const state = failed && index === current ? "blocked" : done ? "done" : isCurrent ? "current" : "todo";
          return (
            <li key={step.key} className={"progress-step is-" + state} aria-current={isCurrent || (allDone && index === current) ? "step" : undefined}>
              <span className="progress-num" aria-hidden="true">{done ? "✓" : String(index + 1).padStart(2, "0")}</span>
              <span className="progress-text">
                <span className="progress-zh">{step.zh}</span>
                <span className="progress-en" lang="en">{step.en}</span>
              </span>
              <span className="visually-hidden">{state === "done" ? "（已完成）" : state === "current" ? "（目前步驟）" : state === "blocked" ? "（未完成）" : ""}</span>
            </li>
          );
        })}
      </ol>
      <p className="progress-compact" aria-hidden="true">
        <strong>{String(current + 1).padStart(2, "0")}</strong>/05 · {workflowSteps[current].zh}
      </p>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — START
// ---------------------------------------------------------------------------

function StartView({
  userGoal,
  onGoalChange,
  onSelectPreset,
  draft,
  caseEdits,
  onFieldEdit,
  onResetEdits,
  isCustomExpanded,
  onToggleExpand,
  onSubmit,
  running,
  providerKind,
  providerInfo,
  providerError,
}: {
  userGoal: string;
  onGoalChange: (value: string) => void;
  onSelectPreset: (preset: CasePreset) => void;
  draft: CaseDraft;
  caseEdits: CaseEditsByDomain;
  onFieldEdit: (field: CaseEditField, value: string) => void;
  onResetEdits: () => void;
  isCustomExpanded: boolean;
  onToggleExpand: (open: boolean) => void;
  onSubmit: () => void;
  running: boolean;
  providerKind: string;
  providerInfo: ProviderInfo;
  providerError: string | null;
}) {
  const personaChips = useMemo(
    () => buildPersonaChips(draft.domain, draft.applicant, draft.actualScenario),
    [draft.domain, draft.applicant, draft.actualScenario]
  );
  const domainEdits = caseEdits[draft.domain] ?? {};
  const hasEdits = Object.keys(domainEdits).length > 0;

  return (
    <div className="start phase-enter">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">GovAid Atlas</h1>
          <p className="hero-tagline"><span>把複雜補助條件，</span><span>變成可驗證的下一步。</span></p>
          <p className="hero-en" lang="en">From complex policies to verifiable next steps.</p>
          <p className="hero-pillars" lang="en">Agent Planning · Deterministic Rules · Official Evidence · Human Review</p>
        </div>
        <ProviderBadge kind={providerKind} info={providerInfo} error={providerError}/>
      </section>

      <div className="start-grid">
        <form
          className="goal-card"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          aria-labelledby="goal-title"
        >
          <div className="card-head">
            <h2 id="goal-title"><label htmlFor="agent-goal">你想確認什麼補助？</label></h2>
            <span className="en-companion" lang="en">What would you like to check?</span>
          </div>

          <div className="segmented" role="group" aria-label="快速切換示範領域與情境">
            {CASE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={userGoal === preset.goal ? "is-active" : ""}
                disabled={running}
                onClick={() => onSelectPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <textarea
            id="agent-goal"
            rows={3}
            value={userGoal}
            onChange={(event) => onGoalChange(event.target.value)}
            disabled={running}
            required
            aria-describedby="persona-summary"
          />

          <details
            className="custom-case-panel"
            open={isCustomExpanded}
            onToggle={(e) => onToggleExpand(e.currentTarget.open)}
          >
            <summary className="custom-case-toggle">
              <span>編輯申請人條件（自訂案例條件）</span>
              <small className="muted">
                {draft.domain === "CHILDCARE" ? "育兒條件 · 6 項" : "租屋條件 · 9 項"}
              </small>
            </summary>
            <div className="custom-case-body">
              {draft.domain === "HOUSING" && (
                <fieldset className="scenario-city-picker">
                  <legend>人工確認：雙情境目標縣市</legend>
                  <div className="scenario-city-grid">
                    <label className="scenario-city-card" htmlFor="scenario-actual-city">
                      <span>情境一 · 目前租屋</span>
                      <select
                        id="scenario-actual-city"
                        value={draft.actualScenario.city ?? ""}
                        onChange={(e) => onFieldEdit("city", e.target.value)}
                        disabled={running}
                      >
                        <option value="">尚未指定</option>
                        {SELECTABLE_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                      </select>
                      {draft.errors.city && <span className="custom-case-error">{draft.errors.city}</span>}
                    </label>
                    <label className="scenario-city-card" htmlFor="scenario-what-if-city">
                      <span>情境二 · 目標搬遷</span>
                      <select
                        id="scenario-what-if-city"
                        value={draft.whatIfScenario.city ?? ""}
                        onChange={(e) => onFieldEdit("whatIfCity", e.target.value)}
                        disabled={running}
                      >
                        <option value="">尚未指定</option>
                        {SELECTABLE_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                      </select>
                      {draft.errors.whatIfCity && <span className="custom-case-error">{draft.errors.whatIfCity}</span>}
                    </label>
                  </div>
                </fieldset>
              )}
              <div className="custom-case-grid">
                {draft.fields.filter((field) => field !== "city").map((field) => {
                  const spec = FIELD_SPECS[field];
                  const val = draft.values[field];
                  const source = draft.sources[field];
                  const error = draft.errors[field];
                  const currentEdit = domainEdits[field] ?? toInputString(val);

                  const sourceLabel =
                    source === "edited"
                      ? "自訂"
                      : source === "extracted"
                        ? "對話擷取"
                        : source === "preset"
                          ? "示範預設"
                          : "待確認";

                  return (
                    <div className="custom-case-field" key={field}>
                      <label className="custom-case-label" htmlFor={`custom-field-${field}`}>
                        <span>{spec.label}</span>
                        <span className="custom-case-tag">{sourceLabel}</span>
                      </label>
                      {spec.kind === "city" ? (
                        <select
                          id={`custom-field-${field}`}
                          value={currentEdit}
                          onChange={(e) => onFieldEdit(field, e.target.value)}
                          disabled={running}
                        >
                          <option value="">-- 請選擇 --</option>
                          {SELECTABLE_CITIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : spec.kind === "boolean" ? (
                        <select
                          id={`custom-field-${field}`}
                          value={currentEdit}
                          onChange={(e) => onFieldEdit(field, e.target.value)}
                          disabled={running}
                        >
                          <option value="">-- 未指定（由 Agent 詢問） --</option>
                          {(spec.booleanOptions ?? [
                            { value: true, label: "是" },
                            { value: false, label: "否" },
                          ]).map((opt) => (
                            <option key={String(opt.value)} value={String(opt.value)}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`custom-field-${field}`}
                          type="number"
                          min={spec.min ?? 0}
                          max={spec.max}
                          step={spec.kind === "integer" ? "1" : "any"}
                          placeholder={spec.placeholder}
                          value={currentEdit}
                          onChange={(e) => onFieldEdit(field, e.target.value)}
                          disabled={running}
                        />
                      )}
                      {error && <span className="custom-case-error">{error}</span>}
                    </div>
                  );
                })}
              </div>
              {hasEdits && (
                <div className="custom-case-footer">
                  <button
                    type="button"
                    className="custom-case-reset"
                    onClick={onResetEdits}
                    disabled={running}
                  >
                    重設為預設條件
                  </button>
                </div>
              )}
            </div>
          </details>

          <div className="persona" id="persona-summary">
            <span className="persona-label">
              {draft.preset ? "合成示範身分" : "評估身分條件"}
            </span>
            <ul className="chips" aria-label="身分條件資料">
              {personaChips.map((chip) => (
                <li key={chip.key} className={"chip" + (chip.pending ? " chip-pending" : "")}>
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="goal-footer">
            <p className="fine-print">合成資料示範 · 結果僅為預審導航，不代表主管機關核准。</p>
            <button className="primary cta" type="submit" disabled={running || !userGoal.trim() || !draft.valid}>
              開始分析
              <span className="cta-en" lang="en">Start Analysis</span>
            </button>
          </div>
        </form>

        <aside className="howto" aria-labelledby="howto-title">
          <h2 id="howto-title">輸入需求後，GovAid Atlas 會：</h2>
          <ol className="howto-list">
            <li><span className="howto-num" aria-hidden="true">1</span>理解你的情境</li>
            <li><span className="howto-num" aria-hidden="true">2</span>檢查政策條件</li>
            <li className="howto-key"><span className="howto-num" aria-hidden="true">3</span><span>不確定時，暫停並向你確認<small>Agent 不會自行猜測</small></span></li>
            <li><span className="howto-num" aria-hidden="true">4</span>比較不同地址方案</li>
            <li><span className="howto-num" aria-hidden="true">5</span>產出可追溯的下一步</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

function ProviderBadge({kind, info, error}: {kind: string; info: ProviderInfo; error: string | null}) {
  const state = info.providerStatus;
  const label = state === "AVAILABLE" ? "AVAILABLE" : state === "UNAVAILABLE" ? "UNAVAILABLE" : "CHECKING";
  return (
    <aside className={"provider provider-" + state.toLowerCase()} aria-label={`模型狀態：${info.model}，${statusCopy[state]?.zh ?? ""}`}>
      <span className="provider-kind" lang="en">{kind}</span>
      <strong className="provider-model">{info.model}</strong>
      <span className="provider-state"><span className="dot" aria-hidden="true"/><span lang="en">{label}</span></span>
      {error && <span className="provider-note">模型連線異常，規則檢查仍可執行</span>}
    </aside>
  );
}

function shortPlace(scenario: {city?: string; district?: string}): string {
  return `${(scenario.city ?? "").replace("市", "")}${(scenario.district ?? "").replace("區", "")}`;
}

// ---------------------------------------------------------------------------
// Stage 2 — ANALYZE
// ---------------------------------------------------------------------------

export type StepState = "PENDING" | "ACTIVE" | "DONE" | "BLOCKED";

export type JourneyStep = {
  key: string;
  zh: string;
  en: string;
  state: StepState;
};

function toolCompleted(run: AgentRun, toolName: string): boolean {
  return run.auditTrail.some((event) =>
    event.action === "AGENT_TOOL_COMPLETED"
    && typeof event.input === "object"
    && event.input !== null
    && (event.input as {toolName?: unknown}).toolName === toolName);
}

// Presentation-only view of the agent run; it reads status and audit events and never changes them.
export function buildJourney(run: AgentRun, running: boolean): JourneyStep[] {
  const domain = run.domain ?? run.state?.domain ?? detectBenefitDomain(run.goal);
  const status = run.status;
  const planned = run.auditTrail.some((event) => event.action === "AGENT_PLAN_CREATED");
  const resumed = run.auditTrail.some((event) => event.action === "AGENT_RESUMED");
  const waiting = status === "WAITING_FOR_HUMAN" || status === "HUMAN_REVIEW_REQUIRED";

  if (domain === "CHILDCARE") {
    const childcareStatus =
      run.state?.childcareStatus ??
      (run.toolResult?.status as EligibilityStatus) ??
      run.state?.overallEligibilityStatus;
    const isFail = childcareStatus === "FAIL" || run.state?.overallEligibilityStatus === "FAIL";
    const isPass = childcareStatus === "PASS" || run.state?.overallEligibilityStatus === "PASS";
    const isCompleted = status === "COMPLETED";
    const rulesEvaluated = toolCompleted(run, "evaluate_childcare_rules");
    const passportGenerated = toolCompleted(run, "generate_childcare_passport");

    const steps: JourneyStep[] = [
      {
        key: "understand",
        zh: "需求辨識",
        en: "Understand",
        state: running && status === "IDLE" ? "ACTIVE" : status !== "IDLE" ? "DONE" : "PENDING",
      },
      {
        key: "collect",
        zh: "蒐集必要條件",
        en: "Collect",
        state: planned || rulesEvaluated || isCompleted ? "DONE" : status === "PLANNING" ? "ACTIVE" : "PENDING",
      },
      {
        key: "rules",
        zh: "檢查未滿2歲育兒津貼資格",
        en: "Check rules",
        state: rulesEvaluated
          ? "DONE"
          : status === "RUNNING_TOOL" && run.lastToolCall === "evaluate_childcare_rules"
            ? "ACTIVE"
            : "PENDING",
      },
      {
        key: "human",
        zh: "補充缺漏資料 / Human Gate",
        en: "Human Gate",
        state: waiting
          ? "ACTIVE"
          : resumed || (!isFail && isCompleted)
            ? "DONE"
            : "PENDING",
      },
      {
        key: "amount",
        zh: "計算補助金額",
        en: "Benefit amount",
        state: isPass && (rulesEvaluated || isCompleted)
          ? "DONE"
          : !isFail && status === "RUNNING_TOOL" && run.lastToolCall === "evaluate_childcare_rules"
            ? "ACTIVE"
            : "PENDING",
      },
      {
        key: "passport",
        zh: "產生育兒 Decision Passport",
        en: "Decision",
        state: isPass && (passportGenerated || isCompleted)
          ? "DONE"
          : !isFail && status === "RUNNING_TOOL" && run.lastToolCall === "generate_childcare_passport"
            ? "ACTIVE"
            : "PENDING",
      },
      {
        key: "navigation",
        zh: "申辦導航完成",
        en: "Navigation",
        state: isPass && isCompleted ? "DONE" : "PENDING",
      },
    ];

    if (status === "FAILED" || status === "NOT_COVERED" || isFail) {
      const blocked = steps.find((step) => step.state !== "DONE");
      if (blocked) {
        blocked.state = "BLOCKED";
      }
    }

    return steps;
  }

  const steps: JourneyStep[] = [
    {key: "understand", zh: "理解需求", en: "Understand", state: running ? "ACTIVE" : status !== "IDLE" ? "DONE" : "PENDING"},
    {key: "plan", zh: "建立計畫", en: "Plan", state: planned ? "DONE" : status === "PLANNING" && !running ? "ACTIVE" : "PENDING"},
    {
      key: "central",
      zh: "檢查中央條件",
      en: "Check rules",
      state: toolCompleted(run, "evaluate_central_rules")
        ? "DONE"
        : status === "RUNNING_TOOL" && run.lastToolCall === "evaluate_central_rules" ? "ACTIVE" : "PENDING",
    },
    {key: "human", zh: "人工確認", en: "Human Gate", state: waiting ? "ACTIVE" : resumed || status === "COMPLETED" ? "DONE" : "PENDING"},
    {
      key: "compare",
      zh: "比較情境",
      en: "Compare",
      state: toolCompleted(run, "evaluate_actual_scenario") && toolCompleted(run, "evaluate_what_if_scenario")
        ? "DONE"
        : status === "RESUMING" ? "ACTIVE" : "PENDING",
    },
    {key: "passport", zh: "決策護照", en: "Decision", state: toolCompleted(run, "generate_decision_passport") ? "DONE" : "PENDING"},
  ];

  if (status === "FAILED" || status === "NOT_COVERED") {
    const blocked = steps.find((step) => step.state !== "DONE");
    if (blocked) {
      blocked.state = "BLOCKED";
    }
  }

  return steps;
}

const stepStateText: Record<StepState, string> = {
  PENDING: "尚未開始",
  ACTIVE: "進行中",
  DONE: "已完成",
  BLOCKED: "未完成",
};

function JourneyStepper({run, running}: {run: AgentRun; running: boolean}) {
  const steps = buildJourney(run, running);
  return (
    <nav className="journey dim-when-gated" aria-labelledby="journey-title">
      <div className="col-head">
        <h2 id="journey-title">Agent 執行步驟</h2>
        <span className="en-companion" lang="en">Agent Journey</span>
      </div>
      <ol className="vstepper">
        {steps.map((step) => (
          <li key={step.key} className={"vstep is-" + step.state.toLowerCase()} aria-current={step.state === "ACTIVE" ? "step" : undefined}>
            <span className="vstep-marker" aria-hidden="true">
              {step.state === "DONE" ? "✓" : step.state === "BLOCKED" ? "!" : ""}
            </span>
            <span className="vstep-text">
              <span className="vstep-zh">{step.zh}</span>
              <span className="vstep-en" lang="en">{step.en}</span>
            </span>
            <span className="visually-hidden">（{stepStateText[step.state]}）</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function HumanGateControls({
  run,
  gateError,
  onAnswer,
  onReset,
}: {
  run: AgentRun;
  gateError: string | null;
  onAnswer: (answer: boolean | number | string) => void;
  onReset: () => void;
}) {
  const field = run.missingField;
  const control = getGateControl(field);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    setCustomInput("");
  }, [field]);

  if (!control) {
    return (
      <div className="gate-actions">
        <button className="secondary" type="button" onClick={onReset}>重新開始</button>
      </div>
    );
  }

  const isOwnsHome = field === "ownsHome" || run.humanInputRequired === OWNS_HOME_QUESTION;

  if (control.kind === "boolean") {
    if (isOwnsHome) {
      return (
        <div className="gate-actions" role="group" aria-label="回答：本人是否持有住宅">
          <button className="gate-button" type="button" onClick={() => onAnswer(false)}>沒有自有住宅</button>
          <button className="gate-button" type="button" onClick={() => onAnswer(true)}>有自有住宅</button>
        </div>
      );
    }
    const options = control.booleanOptions ?? [
      { value: true, label: "是／已完成" },
      { value: false, label: "否／未完成" },
    ];
    return (
      <div className="gate-actions" role="group" aria-label={`回答：${control.label}`}>
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            className="gate-button"
            type="button"
            onClick={() => onAnswer(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (control.kind === "integer" || control.kind === "number") {
    return (
      <div className="gate-numeric-section">
        {field === "birthOrder" && (
          <div className="gate-actions" role="group" aria-label="回答：兒童出生胎次">
            <button className="gate-button" type="button" onClick={() => onAnswer(1)}>第 1 名子女（5,000元/月）</button>
            <button className="gate-button" type="button" onClick={() => onAnswer(2)}>第 2 名子女（6,000元/月）</button>
            <button className="gate-button" type="button" onClick={() => onAnswer(3)}>第 3 名以上（7,000元/月）</button>
          </div>
        )}
        <form
          className="gate-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (customInput.trim() !== "") {
              onAnswer(customInput.trim());
            }
          }}
        >
          <label htmlFor="gate-number-input" className="gate-input-label">
            {field === "birthOrder" ? "或自訂輸入胎次數值：" : `請輸入${control.label}：`}
          </label>
          <div className="gate-input-row">
            <input
              id="gate-number-input"
              type="number"
              min={control.min ?? 0}
              max={control.max}
              step={control.kind === "integer" ? "1" : "any"}
              placeholder={control.placeholder ?? "請輸入數值"}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              required
              autoFocus
            />
            {control.unit && <span className="gate-unit">{control.unit}</span>}
            <button className="primary gate-submit" type="submit">確認送出</button>
          </div>
          {gateError && (
            <p className="gate-error-message" role="alert">
              <span className="badge-glyph" aria-hidden="true">✕</span> {gateError}
            </p>
          )}
        </form>
      </div>
    );
  }

  // City selector
  return (
    <form
      className="gate-input-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (customInput.trim() !== "") {
          onAnswer(customInput.trim());
        }
      }}
    >
      <label htmlFor="gate-city-select" className="gate-input-label">請選擇{control.label}：</label>
      <div className="gate-input-row">
        <select
          id="gate-city-select"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          required
          autoFocus
        >
          <option value="">-- 請選擇縣市 --</option>
          {SELECTABLE_CITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button className="primary gate-submit" type="submit" disabled={!customInput.trim()}>
          確認縣市
        </button>
      </div>
      {gateError && (
        <p className="gate-error-message" role="alert">
          <span className="badge-glyph" aria-hidden="true">✕</span> {gateError}
        </p>
      )}
    </form>
  );
}

function CurrentAction({
  run,
  running,
  elapsedSeconds,
  providerInfo,
  headingRef,
  gateError,
  onAnswer,
  onReset,
}: {
  run: AgentRun;
  running: boolean;
  elapsedSeconds: number;
  providerInfo: ProviderInfo;
  headingRef: React.Ref<HTMLHeadingElement>;
  gateError: string | null;
  onAnswer: (answer: boolean | number | string) => void;
  onReset: () => void;
}) {
  const status = run.status;

  if (running) {
    const cloud = providerInfo.provider === "OPENAI";
    return (
      <article className="action-card is-thinking" aria-labelledby="action-title" aria-busy="true">
        <p className="action-eyebrow"><span className="pulse" aria-hidden="true"/>目前動作 <span lang="en">Current Action</span></p>
        <h2 id="action-title" ref={headingRef} tabIndex={-1}>{cloud ? "雲端模型" : "本機模型"}正在理解需求、規劃下一步</h2>
        <div className="activity" aria-hidden="true"><span/></div>
        <p className="elapsed" role="timer" aria-live="off">
          已執行 <strong>{elapsedSeconds.toFixed(1)}</strong> 秒
        </p>
        {/* Two deliberate lines so CJK copy never leaves a one-character orphan. */}
        <p className="action-detail">
          {elapsedSeconds >= 15 ? (
            <><span>{cloud ? "雲端" : "本機"}推論可能需要一分鐘以上。</span><span>畫面沒有卡住，模型回覆後會自動繼續。</span></>
          ) : (
            <><span>規劃完成後，Agent 只能從允許清單呼叫政策工具。</span><span>資格一律由規則引擎判斷。</span></>
          )}
        </p>
        <dl className="action-facts">
          <div><dt>模型</dt><dd><code>{providerInfo.model}</code></dd></div>
          <div><dt>下一個工具</dt><dd><code>{run.domain === "CHILDCARE" ? "evaluate_childcare_rules" : "evaluate_central_rules"}</code></dd></div>
        </dl>
      </article>
    );
  }

  if (status === "WAITING_FOR_HUMAN") {
    const isOwnsHome = run.humanInputRequired === OWNS_HOME_QUESTION || run.missingField === "ownsHome";

    return (
      <article className="action-card gate" aria-labelledby="action-title" aria-describedby="gate-why">
        <p className="gate-eyebrow">需要你的確認 <span lang="en">Human Gate</span></p>
        <h2 id="action-title" ref={headingRef} tabIndex={-1} className="gate-question">{run.humanInputRequired}</h2>
        {isOwnsHome && <p className="gate-en" lang="en">Do you own a home?</p>}
        <p className="gate-why" id="gate-why">這項資料會影響資格判斷，Agent 不會自行猜測。</p>
        <HumanGateControls
          run={run}
          gateError={gateError}
          onAnswer={onAnswer}
          onReset={onReset}
        />
        <p className="gate-foot">Agent 已暫停 · 必要條件目前為「待確認」 · 回答後會重新執行規則檢查</p>
      </article>
    );
  }

  if (status === "HUMAN_REVIEW_REQUIRED") {
    return (
      <article className="action-card gate" aria-labelledby="action-title">
        <p className="gate-eyebrow">需要人工審查 <span lang="en">Human Review</span></p>
        <h2 id="action-title" ref={headingRef} tabIndex={-1} className="gate-question">{run.humanInputRequired ?? "政策資料需要人工查核"}</h2>
        <p className="gate-why">政策資料互相矛盾時，Agent 會停止確定式判斷，不會自行挑選答案。</p>
        <div className="gate-actions"><button className="secondary" type="button" onClick={onReset}>重新開始</button></div>
      </article>
    );
  }

  if (status === "NOT_COVERED") {
    const referrals = run.coverage?.officialReferrals ?? [];
    return (
      <article className="action-card gate not-covered-card" aria-labelledby="action-title">
        <p className="gate-eyebrow">涵蓋範圍邊界 <span lang="en">Coverage Boundary</span></p>
        <h2 id="action-title" ref={headingRef} tabIndex={-1} className="gate-question">
          {run.coverage?.message ?? "目前版本尚未完整涵蓋此類補助，因此無法作成完整資格判定。"}
        </h2>
        <p className="gate-why">系統不會在缺少政策規則時猜測或宣稱符合資格，亦不代表您無法申請。請以主管機關官方公告為準。</p>

        {referrals.length > 0 && (
          <div className="coverage-referrals" style={{marginTop: "1.25rem"}}>
            <h3 className="referral-heading" style={{fontSize: "1rem", fontWeight: 600, marginBottom: "0.6rem", display: "flex", alignItems: "center", gap: "0.5rem"}}>
              <span>官方申辦與查閱管道</span>
              <span className="en-companion" lang="en" style={{fontSize: "0.8rem", opacity: 0.75, fontWeight: 400}}>Official Referrals</span>
            </h3>
            <ul className="referral-list" style={{listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem"}}>
              {referrals.map((ref, idx) => (
                <li key={idx} className="referral-item" style={{padding: "0.75rem 1rem", background: "rgba(255, 255, 255, 0.04)", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)"}}>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem"}}>
                    <div style={{display: "flex", flexDirection: "column", gap: "0.2rem"}}>
                      <span className="referral-label" style={{fontWeight: 600}}>{ref.label}</span>
                      {ref.agency && <span className="referral-agency" style={{fontSize: "0.82rem", opacity: 0.8}}>主管機關：{ref.agency}</span>}
                    </div>
                    {ref.url && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="referral-link"
                        style={{display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.4rem 0.8rem", background: "#2563eb", color: "#ffffff", borderRadius: "4px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500}}
                      >
                        前往官方網站 ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="gate-actions" style={{marginTop: "1.25rem"}}><button className="secondary" type="button" onClick={onReset}>重新開始</button></div>
      </article>
    );
  }

  if (status === "FAILED") {
    return (
      <article className="action-card is-failed" aria-labelledby="action-title">
        <p className="action-eyebrow">目前動作 <span lang="en">Current Action</span></p>
        <h2 id="action-title" ref={headingRef} tabIndex={-1}>這次分析未能完成</h2>
        <p className="action-detail">Agent 已達步數上限並安全停止。可在「技術與治理 → 執行紀錄」查看細節。</p>
        <div className="gate-actions"><button className="primary" type="button" onClick={onReset}>重新開始</button></div>
      </article>
    );
  }

  const tool = run.lastToolCall;
  return (
    <article className="action-card" aria-labelledby="action-title">
      <p className="action-eyebrow"><span className="pulse" aria-hidden="true"/>目前動作 <span lang="en">Current Action</span></p>
      <h2 id="action-title" ref={headingRef} tabIndex={-1}>
        {status === "RESUMING" ? "已收到確認，繼續分析" : status === "COMPLETED" ? "分析完成" : tool ? `正在${toolCopy[tool]?.zh ?? "執行政策工具"}` : "正在規劃"}
      </h2>
      {tool && <dl className="action-facts"><div><dt>工具</dt><dd><code>{tool}</code></dd></div></dl>}
    </article>
  );
}

function ContextPanel({
  run,
  running,
  applicant,
  providerInfo,
  providerKind,
  providerReady,
  providerError,
  lastInferenceSeconds,
}: {
  run: AgentRun;
  running: boolean;
  applicant: ApplicantProfile;
  providerInfo: ProviderInfo;
  providerKind: string;
  providerReady: boolean;
  providerError: string | null;
  lastInferenceSeconds: number | null;
}) {
  const llmEvent = run.auditTrail.find((event) => event.action === "AGENT_LLM_CALL_COMPLETED" || event.action === "AGENT_LLM_CALL_FAILED");
  const llmSummary = llmEvent?.action === "AGENT_LLM_CALL_COMPLETED"
    ? (llmEvent.output as {decision?: {reasoningSummary?: string}} | undefined)?.decision?.reasoningSummary
    : undefined;
  const allowed = listAllowedTools();
  const personaChips = buildPersonaChips(run.domain ?? "HOUSING", applicant, run.state?.actualScenario);

  return (
    <aside className="context dim-when-gated" aria-labelledby="context-title">
      <div className="col-head">
        <h2 id="context-title">案件摘要</h2>
      </div>

      <p className="context-goal">{run.goal}</p>

      <ul className="chips chips-sm" aria-label="申請人資料">
        {personaChips.map((chip) => (
          <li key={chip.key} className={"chip" + (chip.pending ? " chip-pending" : "")}>
            {chip.label}
          </li>
        ))}
      </ul>

      <dl className="context-facts">
        <div>
          <dt>模型</dt>
          <dd><code>{providerInfo.model}</code> <span className="muted" lang="en">{providerKind}</span></dd>
        </div>
        {!running && lastInferenceSeconds !== null && (
          <div><dt>規劃耗時</dt><dd>{lastInferenceSeconds.toFixed(1)} 秒</dd></div>
        )}
        {(!providerReady || providerError) && !running && (
          <div><dt>模型狀態</dt><dd>無法使用，已改用規則式規劃</dd></div>
        )}
      </dl>

      {llmSummary && (
        <figure className="model-note">
          <figcaption>模型規劃摘要 <span lang="en">Model note</span></figcaption>
          <blockquote lang="en">{llmSummary}</blockquote>
        </figure>
      )}

      <details className="tools-allowlist">
        <summary>Agent 可用工具 · {allowed.length}</summary>
        <ul>
          {allowed.map((tool) => (
            <li key={tool}>{toolCopy[tool]?.zh ?? tool} <code>{tool}</code></li>
          ))}
        </ul>
      </details>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — DECIDE
// ---------------------------------------------------------------------------

const policyLabels: Record<string, {name: string; short: string; detail: string}> = {
  CENTRAL_RENT_115: {name: "中央租屋補助", short: "中央方案", detail: "中央擴大租金補貼（115年度）"},
  NEW_TAIPEI_RENT_115: {name: "新北地方方案", short: "新北方案", detail: "新北市青年租金補貼（115年度）"},
  TAIPEI_RENT_115: {name: "臺北地方方案", short: "臺北方案", detail: "臺北幸福租－租金加碼補貼（115年度）"},
  TAOYUAN_CENTRAL_RENT_115: {name: "桃園市受理方案", short: "桃園受理", detail: "300億元中央擴大租金補貼（桃園市政府住宅發展處協辦受理）"},
  CHILDCARE_ALLOWANCE_UNDER_2_115: {name: "未滿2歲育兒津貼", short: "育兒津貼", detail: "衛生福利部育有未滿2歲兒童育兒津貼（115年度）"},
  LOCAL_COVERAGE_BOUNDARY: {name: "地方方案涵蓋範圍", short: "地方方案", detail: "地方租屋補助涵蓋邊界檢查"},
};

const fieldLabels: Record<string, string> = {
  age: "年齡",
  maritalStatus: "婚姻狀態",
  childrenCount: "子女數",
  registeredCity: "戶籍",
  monthlyIncome: "月收入",
  ownsHome: "本人是否持有住宅",
  receivesOtherHousingAid: "是否領有其他住宅補貼",
  centralRentApproved: "中央租金補貼是否已核准",
  newTaipeiResidenceStudyWork: "新北市設籍、就學或就業條件",
  childAgeMonths: "兒童年齡（月齡）",
  childHasBirthOrInitialHouseholdRegistration: "出生登記或初設戶籍登記",
  receivesPublicOrQuasiPublicChildcare: "是否接受公共化或準公共托育服務",
  isGovernmentPlaced: "是否經政府公費安置收容",
  birthOrder: "兒童出生排序（胎次）",
};

function policyName(policyId: string): string {
  return policyLabels[policyId]?.name ?? policyId;
}

// Summarizes failed rules or surfaces the first unresolved rule for display.
function describeGap(evaluations: RuleEvaluation[]): string | null {
  const failures = summarizeFailReasons(evaluations);
  if (failures) {
    return failures;
  }
  const gap = evaluations.find((evaluation) => evaluation.status === "UNCERTAIN")
    ?? undefined;
  if (!gap) {
    return null;
  }
  const field = gap.reason.match(/缺少必要資料：(.+)/)?.[1] ?? gap.reason.split(" ")[0];
  return fieldLabels[field] ?? field;
}

type ProgramVerdict = {
  policyId: string;
  status: ResultStatus;
  scope: string;
  gap: string | null;
};

// Groups the passport's per-scenario programs into one verdict per program (and per status if they differ).
const NEW_TAIPEI_STUDENT_PENDING_GAP =
  "新北市就業條件（已偵測戶籍桃園、就讀臺北市學校；若無新北就業事實則不適用新北地方補貼，建議直接申請中央補貼）";

function hasTaipeiStudyWithTaoyuanRegistration(passport: DecisionPassport, goal: string): boolean {
  const applicant = passport.applicantSnapshot;
  return applicant.registeredCity === "桃園市"
    && (applicant.newTaipeiResidenceStudyWork === null || applicant.newTaipeiResidenceStudyWork === undefined)
    && extractFactsFromGoal(goal, "HOUSING").studyCity === "臺北市";
}

function buildVerdicts(passport: DecisionPassport, newTaipeiStudentHint = false): ProgramVerdict[] {
  const scenarios = [
    {label: `目前住址 · ${shortPlace(passport.actual)}`, data: passport.actual},
    {label: `搬遷假設 · ${shortPlace(passport.whatIf)}`, data: passport.whatIf},
  ];
  const order: string[] = [];
  const byPolicy = new Map<string, {label: string; status: ResultStatus; gap: string | null}[]>();
  for (const scenario of scenarios) {
    for (const program of scenario.data.programs) {
      if (!byPolicy.has(program.policyId)) {
        byPolicy.set(program.policyId, []);
        order.push(program.policyId);
      }
      byPolicy.get(program.policyId)!.push({
        label: scenario.label,
        status: program.status,
        gap: newTaipeiStudentHint && program.policyId === "NEW_TAIPEI_RENT_115" && program.status === "UNCERTAIN"
          ? NEW_TAIPEI_STUDENT_PENDING_GAP
          : describeGap(program.ruleResults) ?? program.coverageNote ?? null,
      });
    }
  }

  return order.flatMap((policyId) => {
    const entries = byPolicy.get(policyId)!;
    const sameStatus = entries.every((entry) => entry.status === entries[0].status);
    if (sameStatus) {
      return [{
        policyId,
        status: entries[0].status,
        scope: entries.length > 1 ? "兩個地址皆適用" : entries[0].label,
        gap: entries.find((entry) => entry.gap)?.gap ?? null,
      }];
    }
    return entries.map((entry) => ({policyId, status: entry.status, scope: entry.label, gap: entry.gap}));
  });
}

const statusGlyph: Record<ResultStatus, string> = {
  PASS: "✓",
  PARTIAL_CHECK: "◐",
  UNCERTAIN: "?",
  NOT_COVERED: "—",
  FAIL: "✕",
};

// Status is carried by glyph + word, never by color alone.
function ResultBadge({status, size = "md", showEn = false}: {status: ResultStatus; size?: "md" | "lg"; showEn?: boolean}) {
  const copy = resultCopy[status];
  return (
    <span className={`badge badge-${status.toLowerCase()} badge-${size}`}>
      <span className="badge-glyph" aria-hidden="true">{statusGlyph[status]}</span>
      {copy.zh}
      {showEn && <span className="badge-en" lang="en">{copy.en}</span>}
    </span>
  );
}

function ResultView({
  run,
  passport,
  actual,
  whatIf,
  ownsHome,
  headingRef,
  onOpenGovernance,
}: {
  run: AgentRun;
  passport: DecisionPassport;
  actual: ScenarioResult | null;
  whatIf: ScenarioResult | null;
  ownsHome: boolean | null;
  headingRef: React.Ref<HTMLHeadingElement>;
  onOpenGovernance: () => void;
}) {
  const dualCityComparison = passport.domain !== "CHILDCARE"
    && extractFactsFromGoal(run.goal, "HOUSING").dualCityComparison === true;
  const newTaipeiStudentHint = hasTaipeiStudyWithTaoyuanRegistration(passport, run.goal);
  const verdicts = buildVerdicts(passport, newTaipeiStudentHint);
  const certain = verdicts.filter((verdict) => verdict.status === "PASS" || verdict.status === "FAIL");
  const pending = verdicts.filter((verdict) => verdict.status !== "PASS" && verdict.status !== "FAIL");
  const resumeIndex = run.auditTrail.findIndex((event) => event.action === "AGENT_RESUMED");
  const toolsAfterResume = run.auditTrail
    .slice(Math.max(resumeIndex, 0))
    .filter((event) => event.action === "AGENT_TOOL_COMPLETED").length;
  const evidence = [...passport.actual.programs, ...passport.whatIf.programs]
    .flatMap((program) => program.evidence)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.sourceId === item.sourceId) === index)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en", {numeric: true}));
  const generatedAt = new Date(passport.generatedAt).toLocaleString("zh-TW", {hour12: false});
  const guides = passport.applicationGuides ?? [];

  return (
    <div className="result phase-enter">
      {/* 1 — Verdict summary */}
      <section className="summary" aria-labelledby="result-title">
        <header className="summary-head">
          <p className="eyebrow">分析完成 <span lang="en">Decision Result</span></p>
          <h1 id="result-title" ref={headingRef} tabIndex={-1}>你的補助決策摘要</h1>
          <p className="trace">
            {resumeIndex >= 0 && ownsHome !== null && passport.domain !== "CHILDCARE" && <>已依你的確認（{ownsHome ? "有" : "沒有"}自有住宅）繼續分析 · </>}
            執行 {toolsAfterResume} 個政策工具
            {passport.childcare?.estimatedMonthlyBenefitNtd && (
              <> · 預估每月津貼 <strong>NT${passport.childcare.estimatedMonthlyBenefitNtd.toLocaleString()}</strong></>
            )}
          </p>
        </header>

        <ul className="verdict-band" aria-label="各方案結果">
          {verdicts.map((verdict) => (
            <li key={verdict.policyId + verdict.scope} className={"verdict verdict-" + verdict.status.toLowerCase()}>
              <span className="verdict-name">{policyLabels[verdict.policyId]?.short ?? policyName(verdict.policyId)}</span>
              <ResultBadge status={verdict.status} size="lg" showEn/>
              <span className="verdict-scope">{verdict.scope}</span>
            </li>
          ))}
        </ul>

        <div className="verdict-split">
          <div className="split-col split-certain">
            <h2>目前可以確定</h2>
            {certain.length ? (
              <ul>
                {certain.map((verdict) => (
                  <li key={verdict.policyId + verdict.scope}>
                    <strong>{policyName(verdict.policyId)}</strong>
                    {verdict.status === "PASS"
                      ? `：${verdict.scope === "兩個地址皆適用" ? "依目前條件" : verdict.scope}在目前資料下通過條件檢查${
                          passport.childcare?.benefitTierLabel ? `（${passport.childcare.benefitTierLabel}）` : ""
                        }`
                      : `：不符合（${verdict.gap ?? "條件不符"}）`}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">目前沒有可確定的方案。</p>}
          </div>
          <div className="split-col split-pending">
            <h2>目前仍需確認</h2>
            {pending.length ? (
              <ul>
                {pending.map((verdict) => (
                  <li key={verdict.policyId + verdict.scope}>
                    <strong>{policyName(verdict.policyId)}</strong>：{verdict.gap ?? "缺少必要資料"}
                    <span className="split-scope">{verdict.scope}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">沒有待確認的項目。</p>}
          </div>
        </div>
      </section>

      {/* 2 — Actual vs What-if (Housing only) */}
      {actual && whatIf && passport.domain !== "CHILDCARE" && (
        <section className="compare" aria-labelledby="compare-title">
          <div className="section-head">
            <h2 id="compare-title">{dualCityComparison ? "候選租屋比較" : "目前住址 vs 搬遷假設"}</h2>
            <span className="en-companion" lang="en">
              {dualCityComparison ? "OPTION A VS OPTION B" : "ACTUAL VS WHAT-IF"}
            </span>
          </div>
          <CompareTable
            actual={actual}
            whatIf={whatIf}
            dualCityComparison={dualCityComparison}
            registeredCity={passport.applicantSnapshot.registeredCity}
            newTaipeiStudentHint={newTaipeiStudentHint}
          />
        </section>
      )}

      {/* 3 — Decision Passport (the take-away document) */}
      <article className="passport-doc" aria-labelledby="passport-title">
        <header className="doc-head">
          <div>
            <p className="eyebrow-en" lang="en">Decision Passport</p>
            <h2 id="passport-title">申辦決策護照</h2>
          </div>
          <dl className="doc-meta">
            <div><dt>案件編號</dt><dd><code>{passport.caseId}</code></dd></div>
            <div><dt>產出時間</dt><dd>{generatedAt}</dd></div>
            <div><dt>官方依據</dt><dd>{evidence.length} 份文件</dd></div>
          </dl>
        </header>

        <section className="doc-section" aria-labelledby="ps-missing">
          <h3 id="ps-missing"><span className="doc-num" aria-hidden="true">01</span>需要補充的資料</h3>
          {passport.missingItems.length
            ? <ul className="checklist">{passport.missingItems.map((item) => <li key={item}>{item}</li>)}</ul>
            : <p className="muted">無</p>}
        </section>

        <section className="doc-section" aria-labelledby="ps-next">
          <h3 id="ps-next"><span className="doc-num" aria-hidden="true">02</span>建議下一步</h3>
          <ol className="steps">{passport.nextSteps.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>

        {guides.length > 0 && (
          <section className="doc-section" aria-labelledby="ps-navigation">
            <h3 id="ps-navigation"><span className="doc-num" aria-hidden="true">03</span>申辦導航（應備文件、受理機關與申請連結）</h3>
            <div className="panel-stack">
              {guides.map((guide) => {
                const programs = [...passport.actual.programs, ...passport.whatIf.programs]
                  .filter((program) => program.policyId === guide.policyId);
                const verdict = programs.find((program) => program.status === "FAIL")
                  ?? programs.find((program) => program.status === "UNCERTAIN")
                  ?? programs.find((program) => program.status === "PARTIAL_CHECK")
                  ?? programs[0];
                const failReason = summarizeFailReasons(programs.flatMap((program) => program.ruleResults));
                const ineligible = verdict?.status === "FAIL";
                return (
                  <details className="gov-card" key={guide.policyId} open={!ineligible}>
                    <summary className="card-head">
                      <h4>{guide.programTitle}</h4>
                      <span className="guide-summary-status">
                        {ineligible ? (
                          <>
                            <span className="guide-ineligible">資格不符（暫不建議申辦）</span>
                            {failReason && <span className="guide-fail-reason">{failReason}</span>}
                          </>
                        ) : (
                          <span className="en-companion">
                            {guide.applicationStatus === "OPEN"
                              ? "受理中（OPEN）"
                              : guide.applicationStatus === "ROLLING"
                                ? "全年常態受理（ROLLING）"
                                : "已截止（CLOSED）"}
                          </span>
                        )}
                      </span>
                    </summary>
                    <dl className="kv">
                      <div><dt>主管／受理機關</dt><dd>{guide.administeringAgency}</dd></div>
                      <div><dt>受理期間</dt><dd>{guide.applicationPeriod}</dd></div>
                      <div><dt>政策有效期間</dt><dd>{guide.validFrom} 至 {guide.validTo}</dd></div>
                      {guide.benefitAmountFormula && (
                        <div><dt>補助金額基準</dt><dd>{guide.benefitAmountFormula}</dd></div>
                      )}
                      <div><dt>臨櫃／郵寄資訊</dt><dd>{guide.officeInformation}</dd></div>
                      <div><dt>諮詢電話</dt><dd>{guide.contactInformation}</dd></div>
                      {guide.onlineApplicationUrl && (
                        <div>
                          <dt>官方線上申辦</dt>
                          <dd>
                            <a href={guide.onlineApplicationUrl} target="_blank" rel="noreferrer">
                              {guide.onlineApplicationUrl} ↗
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <p><strong>應備文件清單：</strong></p>
                    <ul className="checklist">
                      {guide.requiredDocuments.map((doc) => (
                        <li key={doc.documentId}>
                          {doc.title}
                          {!doc.required && doc.conditionNote ? `（選備：${doc.conditionNote}）` : ""}
                        </li>
                      ))}
                    </ul>
                    <p><strong>申請方式：</strong></p>
                    <ul className="steps">
                      {guide.applicationMethods.map((method) => (
                        <li key={method}>{method}</li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </section>
        )}

        <section className="doc-section" aria-labelledby="ps-risks">
          <h3 id="ps-risks"><span className="doc-num" aria-hidden="true">04</span>風險提醒與排除條件</h3>
          <ul className="risks">{passport.risks.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <section className="doc-section" aria-labelledby="evidence-title">
          <h3 id="evidence-title"><span className="doc-num" aria-hidden="true">05</span>官方依據</h3>
          <ul className="evidence-list">
            {evidence.map((item) => (
              <li key={item.sourceId}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  <span className="evidence-main">
                    <strong className="evidence-agency">{item.agency}</strong>
                    <span className="evidence-title">{item.policyName}</span>
                  </span>
                  <span className="evidence-meta">
                    <span className="evidence-id">{item.sourceId}</span>
                    <span>查核 {item.lastVerifiedAt}</span>
                    <span className="evidence-open" aria-hidden="true">開啟 ↗</span>
                  </span>
                  <span className="visually-hidden">（另開新視窗）</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <footer className="doc-foot">{passport.disclaimer}</footer>
      </article>

      <div className="governance-cta">
        <div>
          <strong>這個答案如何被控制？</strong>
          <span className="muted">權限、衝突偵測、稽核紀錄、模型資訊與安全性評測</span>
        </div>
        <button className="secondary" type="button" onClick={onOpenGovernance} aria-haspopup="dialog">查看系統如何控制風險</button>
      </div>
    </div>
  );
}

type PolicyKind = "central" | "local";

function policyKind(policyId: string): PolicyKind {
  return policyId === "CENTRAL_RENT_115" ? "central" : "local";
}

function CompareCell({
  result,
  kind,
  newTaipeiStudentHint,
}: {
  result: ScenarioResult;
  kind: PolicyKind;
  newTaipeiStudentHint: boolean;
}) {
  const policy = result.policyResults.find((candidate) => policyKind(candidate.policyId) === kind);
  if (!policy) {
    return <span role="cell" className="ct-cell muted">—</span>;
  }
  const status = policy.eligibilityStatus;
  const gap = status === "PASS"
    ? null
    : status === "PARTIAL_CHECK"
      ? "僅完成已編碼條件預審；所得、年齡、家戶等條件待核對"
      : status === "NOT_COVERED"
        ? (policy.coverageNote ?? "目前版本尚未完整涵蓋")
        : newTaipeiStudentHint && policy.policyId === "NEW_TAIPEI_RENT_115" && status === "UNCERTAIN"
          ? NEW_TAIPEI_STUDENT_PENDING_GAP
        : (describeGap(policy.evaluations) ?? policy.coverageNote ?? null);
  const prefix = status === "FAIL"
    ? "不符合："
    : status === "NOT_COVERED"
      ? "尚未涵蓋："
      : "待確認：";
  return (
    <span role="cell" className="ct-cell">
      <span className="ct-policy">
        {kind === "local" && <span className="ct-policy-name">{policyLabels[policy.policyId]?.short ?? policy.policyId}</span>}
        <ResultBadge status={status}/>
      </span>
      {gap && <small className="ct-gap">{prefix}{gap}</small>}
    </span>
  );
}

function formatNtdRange(minNtd: number, maxNtd: number): string {
  const min = `NT$${minNtd.toLocaleString()}`;
  return minNtd === maxNtd ? min : `${min}–NT$${maxNtd.toLocaleString()}`;
}

function comparisonEstimate(result: ScenarioResult, registeredCity?: string) {
  const city = result.scenario.city;
  const metadata = city === "臺北市" || city === "新北市"
    ? RENTAL_SUBSIDY_COMPARISON_METADATA[city]
    : undefined;
  if (!metadata) {
    return {
      maxSubsidy: "目前無可用級距估算",
      outOfPocket: "—",
      note: "請以當地主管機關公告為準。",
    };
  }

  const maxSubsidy = metadata.options
    .map((option) => `${option.description}最高 ${formatNtdRange(option.minNtd, option.maxNtd)} / 月`)
    .join("；");
  const rent = result.scenario.monthlyRent;
  const outOfPocket = rent > 0
    ? (() => {
        const ranges = metadata.options.map((option) => ({
          min: Math.max(0, rent - option.maxNtd),
          max: Math.max(0, rent - option.minNtd),
        }));
        const min = Math.min(...ranges.map((range) => range.min));
        const max = Math.max(...ranges.map((range) => range.max));
        return `約 ${formatNtdRange(min, max)} / 月起`;
      })()
    : "填入月租後估算";
  const note = city === "臺北市" && registeredCity === "臺北市"
    ? "此估算僅列中央 R1，未估算須依資格核定的北市 R6 加碼。"
    : metadata.note;

  return {
    maxSubsidy: `${maxSubsidy}；${note}`,
    outOfPocket,
    note: "依月租扣除最高補助試算；實際金額以主管機關核定級距為準。",
  };
}

function ComparisonEstimateCell({
  result,
  registeredCity,
  field,
}: {
  result: ScenarioResult;
  registeredCity?: string;
  field: "maxSubsidy" | "outOfPocket";
}) {
  const estimate = comparisonEstimate(result, registeredCity);
  return (
    <span role="cell" className="ct-cell ct-estimate-cell">
      <strong>{estimate[field]}</strong>
      <small className="ct-estimate-note">{field === "outOfPocket" ? estimate.note : "級距參考，不代表已符合申請資格。"}</small>
    </span>
  );
}

// Aligned comparison: the same question on each row, so the eye only moves left ↔ right.
function CompareTable({
  actual,
  whatIf,
  dualCityComparison,
  registeredCity,
  newTaipeiStudentHint,
}: {
  actual: ScenarioResult;
  whatIf: ScenarioResult;
  dualCityComparison: boolean;
  registeredCity?: string;
  newTaipeiStudentHint: boolean;
}) {
  const delta = whatIf.scenario.monthlyRent - actual.scenario.monthlyRent;
  const scenarios = [
    {key: "actual", label: dualCityComparison ? "方案 A" : "目前住址", en: dualCityComparison ? "Option A" : "Actual", result: actual},
    {key: "whatif", label: dualCityComparison ? "方案 B" : "搬遷假設", en: dualCityComparison ? "Option B" : "What-if", result: whatIf},
  ];
  return (
    <div className="compare-wrap">
      <div
        className="compare-table"
        role="table"
        aria-label={dualCityComparison ? "候選租屋方案 A 與方案 B 比較" : "目前住址與搬遷假設比較"}
      >
        <div className="ct-row ct-head" role="row">
          <span role="columnheader" className="ct-label"><span className="visually-hidden">項目</span></span>
          {scenarios.map((scenario) => (
            <span role="columnheader" key={scenario.key} className={"ct-col ct-col-" + scenario.key}>
              <span className="ct-kind">
                {dualCityComparison
                  ? `${scenario.label} · ${shortPlace(scenario.result.scenario)}`
                  : scenario.label}
                <span lang="en">{scenario.en}</span>
              </span>
              {!dualCityComparison && <strong className="ct-place">{shortPlace(scenario.result.scenario)}</strong>}
            </span>
          ))}
        </div>
        <div className="ct-row" role="row">
          <span role="rowheader" className="ct-label">月租</span>
          <span role="cell" className="ct-cell ct-rent">NT${actual.scenario.monthlyRent.toLocaleString()}<small> / 月</small></span>
          <span role="cell" className="ct-cell ct-rent">
            NT${whatIf.scenario.monthlyRent.toLocaleString()}<small> / 月</small>
            {delta !== 0 && <span className="ct-delta">{delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString()}</span>}
          </span>
        </div>
        <div className="ct-row" role="row">
          <span role="rowheader" className="ct-label">中央方案</span>
          <CompareCell result={actual} kind="central" newTaipeiStudentHint={newTaipeiStudentHint}/>
          <CompareCell result={whatIf} kind="central" newTaipeiStudentHint={newTaipeiStudentHint}/>
        </div>
        <div className="ct-row" role="row">
          <span role="rowheader" className="ct-label">地方方案</span>
          <CompareCell result={actual} kind="local" newTaipeiStudentHint={newTaipeiStudentHint}/>
          <CompareCell result={whatIf} kind="local" newTaipeiStudentHint={newTaipeiStudentHint}/>
        </div>
        <div className="ct-row" role="row">
          <span role="rowheader" className="ct-label ct-label-estimate">預估最高補助</span>
          <ComparisonEstimateCell result={actual} registeredCity={registeredCity} field="maxSubsidy"/>
          <ComparisonEstimateCell result={whatIf} registeredCity={registeredCity} field="maxSubsidy"/>
        </div>
        <div className="ct-row" role="row">
          <span role="rowheader" className="ct-label ct-label-estimate">預估實質自付</span>
          <ComparisonEstimateCell result={actual} registeredCity={registeredCity} field="outOfPocket"/>
          <ComparisonEstimateCell result={whatIf} registeredCity={registeredCity} field="outOfPocket"/>
        </div>
      </div>

      <details className="rule-details">
        <summary>查看規則細節</summary>
        <div className="rule-details-grid">
          {scenarios.map((scenario) => (
            <div key={scenario.key}>
              <p className="rule-scenario">{scenario.label} · {shortPlace(scenario.result.scenario)}</p>
              {scenario.result.policyResults.map((policy) => (
                <div className="rule-group" key={policy.policyId}>
                  <p className="rule-group-title">{policyLabels[policy.policyId]?.detail ?? policy.policyId}</p>
                  {policy.evaluations.map((evaluation) => (
                    <div className="rule-row" key={evaluation.ruleId}>
                      <code>{evaluation.ruleId}</code>
                      <span className="rule-reason">{evaluation.reason} · {evaluation.sourceId}</span>
                      <ResultBadge status={evaluation.status}/>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technical & Governance drawer
// ---------------------------------------------------------------------------

const governanceTabs: {id: GovernanceTab; zh: string; en: string}[] = [
  {id: "SAFETY", zh: "安全治理", en: "Safety"},
  {id: "AUDIT", zh: "執行紀錄", en: "Audit"},
  {id: "RUNTIME", zh: "模型資訊", en: "Runtime"},
  {id: "EVAL", zh: "評測", en: "Evaluation"},
];

function GovernanceTabs({current, onChange}: {current: GovernanceTab; onChange: (tab: GovernanceTab) => void}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = governanceTabs.findIndex((tab) => tab.id === current);
    const next = governanceTabs[(index + (event.key === "ArrowRight" ? 1 : governanceTabs.length - 1)) % governanceTabs.length];
    onChange(next.id);
    (event.currentTarget.querySelector(`#gov-tab-${next.id}`) as HTMLButtonElement | null)?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label="技術與治理分類" onKeyDown={onKeyDown}>
      {governanceTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`gov-tab-${tab.id}`}
          aria-selected={current === tab.id}
          aria-controls={`gov-panel-${tab.id}`}
          tabIndex={current === tab.id ? 0 : -1}
          className={"tab" + (current === tab.id ? " is-active" : "")}
          onClick={() => onChange(tab.id)}
        >
          {tab.zh}<span className="tab-en" lang="en">{tab.en}</span>
        </button>
      ))}
    </div>
  );
}

function SafetyPanel({
  currentRole,
  onRoleChange,
  visibleProfile,
  conflictResult,
  onRunConflict,
}: {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  visibleProfile: ReturnType<typeof getVisibleProfile>;
  conflictResult: ConflictCheckResult | null;
  onRunConflict: () => void;
}) {
  return (
    <div className="panel-stack">
      <section className="gov-card" aria-labelledby="perm-title">
        <div className="card-head">
          <h3 id="perm-title">權限控制</h3>
          <span className="en-companion" lang="en">Permission Control</span>
        </div>
        <p className="muted">使用合成個資，驗證角色權限、敏感資料遮罩與拒絕存取。</p>
        <div className="segmented" role="group" aria-label="切換角色">
          {(["APPLICANT", "REVIEWER", "POLICY_ADMIN"] as UserRole[]).map((role) => (
            <button
              key={role}
              type="button"
              className={currentRole === role ? "is-active" : ""}
              aria-pressed={currentRole === role}
              onClick={() => onRoleChange(role)}
            >
              {roleCopy[role].zh}
            </button>
          ))}
        </div>
        {visibleProfile.profile ? (
          <dl className="kv">
            <div><dt>姓名</dt><dd>{visibleProfile.profile.name}</dd></div>
            <div><dt>身分證</dt><dd>{visibleProfile.profile.nationalId}</dd></div>
            <div><dt>電話</dt><dd>{visibleProfile.profile.phone}</dd></div>
            <div><dt>月收入</dt><dd>{visibleProfile.profile.monthlyIncome}</dd></div>
          </dl>
        ) : (
          <p className="callout callout-fail"><strong>拒絕存取</strong> 此角色無權存取申請人敏感資料。</p>
        )}
        <p className="muted small">{visibleProfile.permission.reason}</p>
      </section>

      <section className="gov-card" aria-labelledby="conflict-title">
        <div className="card-head">
          <h3 id="conflict-title">政策衝突偵測</h3>
          <span className="en-companion" lang="en">Policy Conflict</span>
        </div>
        <p className="muted">使用合成規則，只驗證衝突偵測機制，不代表任何真實政府政策互相矛盾。</p>
        <button className="secondary" type="button" onClick={onRunConflict}>執行合成衝突測試</button>
        {conflictResult && (
          <div className="conflict-result">
            <dl className="kv">
              <div><dt>衝突狀態</dt><dd>{statusCopy[conflictResult.status]?.zh ?? conflictResult.status}</dd></div>
              <div><dt>系統動作</dt><dd>{statusCopy[conflictResult.resolution]?.zh ?? conflictResult.resolution}</dd></div>
            </dl>
            {conflictResult.conflicts.map((conflict) => (
              <div className="conflict-box" key={conflict.semanticKey}>
                <code>{conflict.semanticKey}</code>
                {conflict.claims.map((claim) => (
                  <div className="kv-row" key={claim.claimId}>
                    <span>{claim.sourceLabel} · {claim.version}</span>
                    <strong>{String(claim.value)}</strong>
                  </div>
                ))}
              </div>
            ))}
            {conflictResult.status === "CONFLICT" && (
              <p className="callout callout-warn"><strong>需要人工審查</strong> GovAid Atlas 不會自行選擇其中一個答案，而是停止確定式判斷並要求人工查核。</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function AuditPanel({
  events,
  debug,
  running,
  onRunGolden,
}: {
  events: AuditEvent[];
  debug: unknown;
  running: boolean;
  onRunGolden: () => void;
}) {
  return (
    <div className="panel-stack">
      <section className="gov-card" aria-labelledby="audit-title">
        <div className="card-head">
          <h3 id="audit-title">稽核紀錄 · {events.length}</h3>
          <span className="en-companion" lang="en">Audit Trail</span>
        </div>
        {events.length === 0 ? (
          <p className="muted">尚無執行紀錄。開始分析後，每一次模型呼叫、工具呼叫與人工確認都會記錄在這裡。</p>
        ) : (
          <ol className="audit-list">
            {events.map((event, index) => (
              <li className="audit-row" key={event.timestamp + index}>
                <span className="audit-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="audit-actor">{actorCopy[event.actor]?.zh ?? event.actor}</span>
                <span className="audit-action">{auditCopy[event.action]?.zh ?? "執行事件"}</span>
                <code className="audit-policy">{event.action}</code>
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="gov-card debug">
        <summary>除錯資訊 <span lang="en">Debug details</span></summary>
        <pre>{JSON.stringify(debug, null, 2)}</pre>
      </details>

      <section className="gov-card" aria-labelledby="demo-controls-title">
        <div className="card-head">
          <h3 id="demo-controls-title">示範控制</h3>
          <span className="en-companion" lang="en">Demo Controls</span>
        </div>
        <p className="muted">不呼叫模型，直接以規則式規劃跑到人工確認。適合模型離線時備援。</p>
        <button className="secondary" type="button" disabled={running} onClick={onRunGolden}>執行規則示範案例</button>
      </section>
    </div>
  );
}

function RuntimePanel({
  metrics,
  providerInfo,
  inference,
  storageUnavailable,
}: {
  metrics: RuntimeMetrics;
  providerInfo: ProviderInfo;
  inference: RuntimeInference | null;
  storageUnavailable: boolean;
}) {
  const cost = metrics.estimatedCostUsd === null
    ? null
    : metrics.estimatedCostUsd === 0 ? "$0" : `$${metrics.estimatedCostUsd.toFixed(2)}`;
  return (
    <div className="panel-stack">
      <section className="gov-card" aria-labelledby="runtime-title">
        <div className="card-head">
          <h3 id="runtime-title">模型資訊</h3>
          <span className="en-companion" lang="en">Runtime</span>
        </div>
        <h4 className="runtime-subtitle">目前環境狀態</h4>
        <div className="metric-grid">
          <Metric label="Provider" value={providerDisplayName(providerInfo.provider)}/>
          <Metric label="Model" value={providerInfo.model}/>
          <Metric
            label="Connection"
            value={providerInfo.providerStatus === "UNKNOWN" ? "檢查中" : providerInfo.available ? "可用" : "未連線"}
          />
          <Metric label="Runtime Mode" value={runtimeModeLabel(providerInfo.mode)}/>
          <Metric label="Configured Mode" value={providerInfo.providerMode ?? null}/>
        </div>
        <h4 className="runtime-subtitle">最近案件推論</h4>
        {inference ? (
          <>
            <div className="metric-grid">
              <Metric label="Provider" value={providerDisplayName(inference.provider)}/>
              <Metric label="Model" value={inference.model}/>
              <Metric label="Connection" value={inference.available ? "可用" : "未連線"}/>
              <Metric label="Runtime Mode" value={runtimeModeLabel(inference.mode)}/>
              <Metric label="Planner latency" value={inference.latencyMs === null ? null : `${inference.latencyMs.toFixed(0)} ms`}/>
              <Metric label="Rule-based Fallback" value={inference.ruleFallbackUsed ? "已使用" : "未使用"}/>
              <Metric label="Provider failovers" value={inference.providerFallbackCount}/>
            </div>
            {inference.lastLlmFailureReason && (
              <p className="runtime-error-reason" role="status">
                最近模型失敗原因：{inference.lastLlmFailureReason}
              </p>
            )}
          </>
        ) : (
          <p className="muted">尚無已保存的案件推論紀錄；完成一次分析後會顯示最近的 Provider、模型、連線、延遲與規則式 Fallback 狀態。</p>
        )}
        {storageUnavailable && (
          <p className="runtime-storage-warning" role="status">
            瀏覽器儲存空間不可用；最近案件推論無法跨重新整理保存。
          </p>
        )}
        <h4 className="runtime-subtitle">累計執行指標</h4>
        <div className="metric-grid">
          <Metric label="LLM Calls" value={metrics.llmCalls}/>
          <Metric label="Input Tokens" value={metrics.inputTokens}/>
          <Metric label="Output Tokens" value={metrics.outputTokens}/>
          <Metric label="Cloud API Cost" value={cost}/>
          <Metric label="Provider failovers" value={metrics.fallbackCount}/>
        </div>
        <p className="muted">LLM 負責規劃與工具調度；資格結果一律由規則引擎判斷。</p>
      </section>

      <details className="gov-card">
        <summary>本機工具計數與延遲 <span lang="en">Local tool counters</span></summary>
        <div className="metric-grid">
          <Metric label="Rules Engine Calls" value={metrics.rulesEngineCalls}/>
          <Metric label="Scenario Evaluations" value={metrics.scenarioEvaluations}/>
          <Metric label="Conflict Checks" value={metrics.conflictChecks}/>
          <Metric label="Permission Checks" value={metrics.permissionChecks}/>
          <Metric label="Passport Generations" value={metrics.passportGenerations}/>
          <Metric label="Measured Operations" value={metrics.measuredOperations}/>
          <Metric label="Avg Local Latency" value={metrics.measuredOperations ? `${(metrics.totalLatencyMs / metrics.measuredOperations).toFixed(2)} ms` : null}/>
          <Metric label="Last Local Latency" value={metrics.lastLatencyMs !== null ? `${metrics.lastLatencyMs.toFixed(2)} ms` : null}/>
        </div>
        <p className="muted small">延遲只測量瀏覽器內的規則工具，不含網路或政府資料來源延遲。</p>
      </details>
    </div>
  );
}

function Metric({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <div className="metric">
      <span className="metric-label" lang="en">{label}</span>
      <strong className="metric-value">{value ?? "N/A"}</strong>
    </div>
  );
}

const headlineMetrics = ["statusAccuracy", "unsupportedClaim", "unsafeCertainty"] as const;

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function EvaluationPanel({deterministic}: {deterministic: ReturnType<typeof runBenchmark>}) {
  const metrics = finalBenchmark.metrics;
  const headline = headlineMetrics.map((key) => metrics.find((metric) => metric.key === key)!);
  const coverage = metrics.find((metric) => metric.key === "evidenceCoverage");
  const sides = [
    {key: "llmContext" as const, title: "LLM + Context", sub: "一般 LLM ＋ 政策文件"},
    {key: "govaidAtlas" as const, title: "GovAid Atlas", sub: "Agent ＋ 規則引擎 ＋ 人工確認"},
  ];
  return (
    <div className="panel-stack">
      <section className="gov-card" aria-labelledby="eval-title">
        <div className="card-head">
          <h3 id="eval-title">安全性驗證</h3>
          <span className="en-companion" lang="en">Safety Evaluation</span>
        </div>
        <div className="eval-grid">
          {sides.map((side) => (
            <article key={side.key} className={"eval-card eval-" + side.key}>
              <header>
                <h4 lang="en">{side.title}</h4>
                <span className="muted small">{side.sub}</span>
              </header>
              <dl>
                {headline.map((metric) => (
                  <div key={metric.key}>
                    <dt>
                      <span lang="en">{metric.label}</span>
                      <small>{benchmarkCopy[metric.key].zh} · {metric.higherIsBetter ? "越高越好" : "越低越好"}</small>
                    </dt>
                    <dd>
                      {formatPercent(metric[side.key].percent)}
                      <small>{metric[side.key].numerator}/{metric[side.key].denominator}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
        {coverage && (
          <p className="eval-secondary">
            <span lang="en">Evidence Coverage</span> {formatPercent(coverage.llmContext.percent)} → {formatPercent(coverage.govaidAtlas.percent)}
            <span className="muted small"> （{coverage.govaidAtlas.denominator} 個需引用官方來源的案例）</span>
          </p>
        )}
        <p className="eval-note" lang="en">{finalBenchmark.caseCount} synthetic policy-navigation cases; not a real-world accuracy claim.</p>
        <p className="muted small">
          過度確定率只計算 5 個安全關鍵案例。GovAid Atlas 數據來自規則引擎評估，不含完整 Agent 流程耗時。
          人工基準測試：<strong>{finalBenchmark.manualBaseline === "PENDING" ? "進行中 (Manual Pending)" : finalBenchmark.manualBaseline}</strong>
        </p>
      </section>

      <details className="gov-card">
        <summary>規則引擎回歸測試 · {deterministic.summary.passedCases}/{deterministic.summary.totalCases} <span lang="en">Deterministic regression</span></summary>
        <div className="regression">
          {deterministic.results.map((result) => (
            <div className="regression-row" key={result.id}>
              <div className="regression-case min-w-[180px] shrink-0">
                <code>{result.id}</code>
                <span>{result.name}</span>
              </div>
              <span className="regression-status min-w-0 flex-1 break-words [overflow-wrap:anywhere] muted small">
                預期 {statusCopy[result.expected]?.zh ?? result.expected} · 實際 {statusCopy[result.actual]?.zh ?? result.actual}
              </span>
              <strong className={result.passed ? "ok" : "bad"}>{result.passed ? "通過" : "未通過"}</strong>
            </div>
          ))}
        </div>
        <p className="muted small">
          證據覆蓋率 {deterministic.summary.evidenceCoveragePercent}% · 過度確定 {deterministic.summary.unsafeCertaintyCount} ·
          衝突 {deterministic.summary.conflictCasesPassed}/{deterministic.summary.conflictCases} ·
          恢復 {deterministic.summary.recoveryCasesPassed}/{deterministic.summary.recoveryCases}
        </p>
      </details>
    </div>
  );
}

export default App;
