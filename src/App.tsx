import React, {useEffect, useMemo, useRef, useState} from "react";

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
  recordLlmCall,
  recordRuntimeCall,
  recordRuntimeOperation,
  type RuntimeCounterKey,
  type RuntimeMetrics,
} from "./metrics";

import {
  runBenchmark,
} from "./benchmark";
import {finalBenchmark} from "./benchmark-final";

import centralRulesJson from "./policies/central-rent-115.json";
import taipeiRulesJson from "./policies/taipei-rent-115.json";
import newTaipeiRulesJson from "./policies/new-taipei-rent-115.json";

import type {
  AddressScenario,
  ApplicantProfile,
  AuditEvent,
  PolicyRule,
  RuleEvaluation,
} from "./types";

import {
  evaluateRules,
  getOverallStatus,
} from "./rules";

import {
  evaluateScenario,
  type ScenarioResult,
} from "./scenario";

import {
  buildDecisionPassport,
  type DecisionPassport,
} from "./passport";

import {
  createAgentRun,
  resumeAgentRun,
  runAgenticGoldenCase,
} from "./agent/orchestrator";

import type { AgentRun } from "./agent/types";
import type { ProviderName, ProviderPlannerResult, ProviderUsage } from "./agent/providers/types";

const centralRules = centralRulesJson as PolicyRule[];
const taipeiRules = taipeiRulesJson as PolicyRule[];
const newTaipeiRules = newTaipeiRulesJson as PolicyRule[];

const initialApplicant: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",

  ownsHome: null,
  receivesOtherHousingAid: false,
  monthlyIncome: null,

  centralRentApproved: null,
  newTaipeiResidenceStudyWork: null,
};

const actualScenario: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfScenario: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

const agentGoal = "我目前住在新北市永和區，每月租金 13,500 元。如果搬到臺北市文山區、租金 15,500 元，我有哪些租屋補助可以考慮？還缺什麼資料？";

type ProviderInfo = {
  provider: ProviderName;
  providerStatus: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  model: string;
};

type AgentPlanResponse = {
  provider: ProviderName;
  providerStatus: "AVAILABLE" | "UNAVAILABLE";
  model: string;
  decision?: ProviderPlannerResult["decision"];
  metadata?: {
    usage?: ProviderUsage | null;
    error?: string | null;
    llmCallAttempted?: boolean;
    llmCallSucceeded?: boolean;
  };
};

const sensitiveProfile:
  SensitiveProfile = {
  name: "陳同學",
  nationalId: "A123456789",
  phone: "0912345678",
  monthlyIncome: 32000,
};

type DemoStage =
  | "IDLE"
  | "UNCERTAIN"
  | "CONFIRMED"
  | "COMPARED"
  | "PASSPORT";

function StatusBadge({status}: {status: string}) {
  return (
    <span className={"status status-" + status.toLowerCase()}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

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

function App() {
  const [applicant, setApplicant] = useState<ApplicantProfile>(initialApplicant);
  const [userGoal, setUserGoal] = useState(agentGoal);
  const [agentRunning, setAgentRunning] = useState(false);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo>({
    provider: "OLLAMA",
    providerStatus: "UNKNOWN",
    model: "qwen3.5:4b",
  });
  const [llmRuntimeActive, setLlmRuntimeActive] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [stage, setStage] = useState<DemoStage>("IDLE");
  const [centralEvaluation, setCentralEvaluation] = useState<RuleEvaluation[]>([]);
  const [actualResult, setActualResult] = useState<ScenarioResult | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<ScenarioResult | null>(null);
  const [passport, setPassport] = useState<DecisionPassport | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun>(() => createAgentRun(agentGoal));

  const benchmarkResult =
    useMemo(
      () => runBenchmark(),
      []
    );

  const [
    currentRole,
    setCurrentRole,
  ] = useState<UserRole>("APPLICANT");

  const [
    conflictResult,
    setConflictResult,
  ] = useState<ConflictCheckResult | null>(null);

  const visibleProfile =
  getVisibleProfile(
    currentRole,
    sensitiveProfile
  );

  const currentCentralStatus = useMemo(
    () => centralEvaluation.length ? getOverallStatus(centralEvaluation) : null,
    [centralEvaluation]
  );

  const [
    runtimeMetrics,
    setRuntimeMetrics,
  ] =
    useState<RuntimeMetrics>(
      createRuntimeMetrics()
    );

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
          error?: string | null;
        }>;
      })
      .then((health) => {
        setProviderInfo({
          provider: health.provider ?? "UNAVAILABLE",
          providerStatus: health.providerStatus ?? "UNAVAILABLE",
          model: health.model ?? "N/A",
        });
        setProviderError(health.error ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setProviderInfo((current) => ({...current, providerStatus: "UNAVAILABLE"}));
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

  function recordMetric(
    counter: RuntimeCounterKey,
    latencyMs: number
  ) {
    setRuntimeMetrics(
      (current) =>
        recordRuntimeOperation(
          current,
          counter,
          latencyMs
        )
    );
  }

  function changeRole(role: UserRole) {
    if (role === currentRole) {
      return;
    }

    setCurrentRole(role);

    audit(
      "SYSTEM",
      "ROLE_CHANGED",
      {role},
      undefined,
      "RBAC-V1"
    );

    const measured =
      measureSync(() =>
        getVisibleProfile(
          role,
          sensitiveProfile
        )
      );

    const result =
      measured.result;

    recordMetric(
      "permissionChecks",
      measured.latencyMs
    );

    if (!result.permission.allowed) {
      audit(
        "SYSTEM",
        "ACCESS_DENIED",
        {
          role,
          resource: "SENSITIVE_PROFILE",
        },
        {
          reason:
            result.permission.reason,
        },
        "RBAC-V1"
      );

      return;
    }

    if (result.permission.masked) {
      audit(
        "SYSTEM",
        "MASKED_PROFILE_ACCESSED",
        {
          role,
          resource: "SENSITIVE_PROFILE",
        },
        {
          masked: true,
        },
        "RBAC-V1"
      );

      return;
    }

    audit(
      "SYSTEM",
      "SENSITIVE_PROFILE_ACCESSED",
      {
        role,
        resource: "SENSITIVE_PROFILE",
      },
      {
        masked: false,
      },
      "RBAC-V1"
    );
  }
  function startGoldenCase() {
    const freshApplicant = {...initialApplicant};
    setApplicant(freshApplicant);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setConflictResult(null);
    setAuditTrail([]);

    const newRun = runAgenticGoldenCase(agentGoal, freshApplicant, actualScenario, whatIfScenario);
    setAgentRun(newRun);

    const measured =
      measureSync(() =>
        evaluateRules(
          centralRules,
          freshApplicant
        )
    );

    const evaluation =
      measured.result;

    recordMetric(
      "rulesEngineCalls",
      measured.latencyMs
    );
    setCentralEvaluation(evaluation);
    setStage("UNCERTAIN");

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
      if (toolName === "evaluate_central_rules") {
        return recordRuntimeCall(metrics, "rulesEngineCalls");
      }
      if (toolName === "evaluate_actual_scenario" || toolName === "evaluate_what_if_scenario") {
        return recordRuntimeCall(metrics, "scenarioEvaluations");
      }
      if (toolName === "generate_decision_passport") {
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

    const freshApplicant = {...initialApplicant};
    setAgentRunning(true);
    setProviderError(null);
    setLlmRuntimeActive(false);
    setApplicant(freshApplicant);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setCentralEvaluation([]);
    setStage("IDLE");
    setAgentRun({...createAgentRun(goal), status: "PLANNING"});
    setAuditTrail([{
      timestamp: new Date().toISOString(),
      actor: "USER",
      action: "CASE_CREATED",
      input: freshApplicant,
      policyVersion: "CENTRAL-RENT-115",
    }]);

    let plannerResult: ProviderPlannerResult;
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
      const succeeded = payload.metadata?.llmCallSucceeded === true;
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
      });
      setProviderError(payload.metadata?.error ?? null);
      setLlmRuntimeActive(succeeded);
      if (plannerResult.callAttempted) {
        setRuntimeMetrics((current) => recordLlmCall(current, usage ?? null, payload.provider === "OLLAMA"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent planner request failed.";
      setProviderInfo((current) => ({...current, providerStatus: "UNAVAILABLE"}));
      setProviderError(message);
      plannerResult = {
        provider: "UNAVAILABLE",
        providerStatus: "UNAVAILABLE",
        model: providerInfo.model,
        error: message,
      };
    }

    const run = runAgenticGoldenCase(goal, freshApplicant, actualScenario, whatIfScenario, plannerResult);
    setAgentRun(run);
    recordAgentToolMetrics(run);
    const centralResult = getCompletedToolResult<{evaluations?: RuleEvaluation[]}>(run, "evaluate_central_rules");
    setCentralEvaluation(centralResult?.evaluations ?? []);
    if (run.status === "WAITING_FOR_HUMAN") {
      setStage("UNCERTAIN");
    }
    setAgentRunning(false);
  }

  function respondToHuman(ownsHome: boolean) {
    if (agentRun.status !== "WAITING_FOR_HUMAN" || agentRunning) {
      return;
    }
    const updatedApplicant = {...applicant, ownsHome};
    const existingAuditCount = agentRun.auditTrail.length;
    setApplicant(updatedApplicant);
    audit("USER", "FIELD_CONFIRMED", {field: "ownsHome", value: ownsHome});
    const resumed = resumeAgentRun(agentRun, updatedApplicant, actualScenario, whatIfScenario);
    setAgentRun(resumed);
    recordAgentToolMetrics(resumed, existingAuditCount);

    const centralResult = getCompletedToolResult<{evaluations?: RuleEvaluation[]}>(resumed, "evaluate_central_rules");
    setCentralEvaluation(centralResult?.evaluations ?? []);
    const actual = getCompletedToolResult<ScenarioResult>(resumed, "evaluate_actual_scenario");
    const whatIf = getCompletedToolResult<ScenarioResult>(resumed, "evaluate_what_if_scenario");
    const completedPassport = getCompletedToolResult<DecisionPassport>(resumed, "generate_decision_passport");
    if (actual && whatIf && completedPassport) {
      setActualResult(actual);
      setWhatIfResult(whatIf);
      setPassport(completedPassport);
      setStage("PASSPORT");
    } else {
      setStage("UNCERTAIN");
    }
  }

  function compareAddresses() {
    const measuredActual =
      measureSync(() =>
        evaluateScenario(
          actualScenario,
          applicant,
          {
            central: centralRules,
            taipei: taipeiRules,
            newTaipei:
              newTaipeiRules,
          }
        )
      );

    const actual =
      measuredActual.result;

    recordMetric(
      "scenarioEvaluations",
      measuredActual.latencyMs
    );

    const measuredWhatIf =
      measureSync(() =>
        evaluateScenario(
          whatIfScenario,
          applicant,
          {
            central: centralRules,
            taipei: taipeiRules,
            newTaipei:
              newTaipeiRules,
          }
        )
      );

    const whatIf =
      measuredWhatIf.result;

    recordMetric(
      "scenarioEvaluations",
      measuredWhatIf.latencyMs
    );

    setActualResult(actual);
    setWhatIfResult(whatIf);

    audit("SYSTEM", "ACTUAL_SCENARIO_EVALUATED", actualScenario, actual, "CENTRAL-RENT-115 + NEW-TAIPEI-RENT-115");
    audit("SYSTEM", "WHAT_IF_SCENARIO_EVALUATED", whatIfScenario, whatIf, "CENTRAL-RENT-115 + TAIPEI-RENT-115");
    setStage("COMPARED");
  }

  function generatePassport() {
    if (!actualResult || !whatIfResult) return;
    const measured =
      measureSync(() =>
        buildDecisionPassport(
          "CASE-P0-001",
          applicant,
          actualResult,
          whatIfResult
        )
      );

    const result =
      measured.result;

    recordMetric(
      "passportGenerations",
      measured.latencyMs
    );
    setPassport(result);
    audit("SYSTEM", "DECISION_PASSPORT_GENERATED", {caseId: "CASE-P0-001"}, result, "MULTI-POLICY");
    setStage("PASSPORT");
  }

  function resetDemo() {
    setApplicant({...initialApplicant});
    setStage("IDLE");
    setCentralEvaluation([]);
    setActualResult(null);
    setWhatIfResult(null);
    setPassport(null);
    setAuditTrail([]);
    setConflictResult(null);
    setCurrentRole("APPLICANT");
    setRuntimeMetrics(createRuntimeMetrics());
    setAgentRun(createAgentRun(agentGoal));
    setUserGoal(agentGoal);
    setLlmRuntimeActive(false);
    setProviderError(null);
  }

  function runConflictTest() {
  const measured =
    measureSync(() =>
      detectConflicts(
        syntheticConflictClaims
      )
    );

  const result =
    measured.result;

  recordMetric(
    "conflictChecks",
    measured.latencyMs
  );

  setConflictResult(result);

  audit(
    "SYSTEM",
    "POLICY_CONFLICT_CHECK",
    syntheticConflictClaims,
    result,
    "SYNTHETIC-CONFLICT-TEST"
  );

  if (result.status === "CONFLICT") {
    audit(
      "AGENT",
      "HUMAN_REVIEW_REQUIRED",
      {
        reason: "POLICY_CONFLICT",
      },
      result,
      "SYNTHETIC-CONFLICT-TEST"
    );
  }
}

  const displayedAuditTrail = [...auditTrail, ...agentRun.auditTrail]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>("BENCHMARK");
  const journeyRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (agentRun.status === "WAITING_FOR_HUMAN") {
      journeyRef.current?.scrollIntoView({behavior: scrollBehavior(), block: "start"});
    }
  }, [agentRun.status]);

  useEffect(() => {
    if (passport) {
      resultsRef.current?.scrollIntoView({behavior: scrollBehavior(), block: "start"});
    }
  }, [passport]);

  const journey = buildJourney(agentRun);
  const providerLabel = providerInfo.provider === "OLLAMA" ? "LOCAL AGENT" : providerInfo.provider === "OPENAI" ? "CLOUD AGENT" : "AGENT";
  const llmRuntimeLabel = providerInfo.providerStatus === "UNKNOWN"
    ? "CHECKING"
    : providerInfo.providerStatus === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : llmRuntimeActive
        ? "ACTIVE"
        : "READY";
  const showOwnsHomeGate = agentRun.status === "WAITING_FOR_HUMAN" && agentRun.humanInputRequired === "本人是否持有住宅？";

  return (
    <main className="app">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-top">
          <div className="hero-copy">
            <h1 id="hero-title">GovAid Atlas</h1>
            <p className="hero-tagline">可追溯、可暫停、可人工確認的政府補助 AI Agent</p>
            <p className="hero-sub">Agent planning × Deterministic rules × Official evidence × Human-in-the-loop</p>
          </div>
          <div className="hero-actions">
            <button className="secondary" onClick={resetDemo}>Reset Demo</button>
            <button className="primary" onClick={startGoldenCase}>Start Golden Case</button>
          </div>
        </div>

        <div className="composer">
          <form className="goal-form" onSubmit={(event) => {
            event.preventDefault();
            void runCustomGoal();
          }}>
            <label htmlFor="agent-goal">User Goal</label>
            <textarea
              id="agent-goal"
              rows={3}
              value={userGoal}
              onChange={(event) => setUserGoal(event.target.value)}
              disabled={agentRunning}
              required
            />
            <div className="goal-form-footer">
              <p className="synthetic-note">
                <strong>Synthetic Persona</strong> · 全部使用合成資料；結果僅為預審導航，不代表主管機關核准。
              </p>
              <button className="primary run-button" type="submit" disabled={agentRunning || !userGoal.trim()}>
                {agentRunning ? "Running…" : "Run Agent"}
              </button>
            </div>
          </form>

          <aside className={"provider-card provider-" + providerInfo.providerStatus.toLowerCase()} aria-label="Agent provider">
            <span className="provider-kind">{providerLabel}</span>
            <strong className="provider-model">{providerInfo.model}</strong>
            <span className="provider-status">
              <span className="dot" aria-hidden="true"/>
              {providerInfo.providerStatus}
            </span>
            <span className="provider-runtime">LLM runtime · {llmRuntimeLabel}</span>
            {providerError && <p className="provider-error" role="status">{providerError}</p>}
          </aside>
        </div>
      </section>

      <section className="section journey" ref={journeyRef} aria-labelledby="journey-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Agent Journey</p>
            <h2 id="journey-title">Agent 規劃與調度，規則引擎判斷，人工把關不確定性</h2>
          </div>
          <StatusBadge status={agentRun.status}/>
        </div>

        <ol className="stepper">
          {journey.map((step, index) => (
            <li key={step.key} className={"step step-" + step.state.toLowerCase()} aria-current={step.state === "ACTIVE" ? "step" : undefined}>
              <span className="step-index">{step.state === "DONE" ? "✓" : index + 1}</span>
              <span className="step-label">{step.label}</span>
              <span className="step-state">{step.state}</span>
            </li>
          ))}
        </ol>

        <div className={"current-panel" + (agentRun.status === "WAITING_FOR_HUMAN" ? " is-waiting" : "")}>
          <div className="current-main">
            <span className="current-label">Current Step</span>
            <strong className="current-status" key={agentRun.status}>{statusText(agentRun.status)}</strong>
            <p className="current-detail">
              {agentRun.status === "IDLE" ? "輸入目標後按 Run Agent，或按 Start Golden Case 直接示範。" : agentRun.currentStep}
            </p>
            <dl className="current-facts">
              <div>
                <dt>Last tool</dt>
                <dd><code>{agentRun.lastToolCall ?? "—"}</code></dd>
              </div>
              <div>
                <dt>Central rules</dt>
                <dd>{currentCentralStatus ? <StatusBadge status={currentCentralStatus}/> : "—"}</dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd>{agentRun.stepsTaken} / {agentRun.maximumSteps}</dd>
              </div>
            </dl>
          </div>

          <div className="case-chips" aria-label="Case profile">
            <span className="chip-title">Case Profile</span>
            <span className="chip">年齡 {applicant.age}</span>
            <span className="chip">單身</span>
            <span className="chip">戶籍 {applicant.registeredCity}</span>
            <span className={"chip" + (applicant.ownsHome === null ? " chip-pending" : "")}>
              住宅持有 {applicant.ownsHome === null ? "待確認" : applicant.ownsHome ? "有" : "無"}
            </span>
          </div>
        </div>

        {agentRun.status === "WAITING_FOR_HUMAN" && (
          <div className="human-gate" role="region" aria-labelledby="human-gate-question">
            <div className="human-gate-copy">
              <span className="gate-label">Human Gate · Agent 已暫停</span>
              <p className="gate-question" id="human-gate-question">{agentRun.humanInputRequired}</p>
              <p className="gate-reason">規則引擎回傳 UNCERTAIN：缺少必要資料。Agent 不會自行猜測，等待人工確認後才繼續。</p>
            </div>
            {showOwnsHomeGate && (
              <div className="gate-actions">
                <button className="gate-button" onClick={() => respondToHuman(false)} disabled={agentRunning}>無自有住宅</button>
                <button className="gate-button" onClick={() => respondToHuman(true)} disabled={agentRunning}>有自有住宅</button>
              </div>
            )}
          </div>
        )}

        {agentRun.status === "HUMAN_REVIEW_REQUIRED" && agentRun.humanInputRequired && (
          <div className="human-gate">
            <div className="human-gate-copy">
              <span className="gate-label">Human Review Required</span>
              <p className="gate-question">{agentRun.humanInputRequired}</p>
            </div>
          </div>
        )}

        {(agentRun.lastDecision || agentRun.plan.length > 0) && (
          <details className="quiet-details">
            <summary>Agent plan &amp; decision rationale</summary>
            <ol className="plan-list">
              {agentRun.plan.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ol>
            {agentRun.lastDecision && (
              <p className="rationale">Decision rationale: {agentRun.lastDecision.reasoningSummary}</p>
            )}
          </details>
        )}
      </section>

      {actualResult && whatIfResult && (
        <section className="section comparison reveal" aria-labelledby="comparison-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">Scenario Comparison</p>
              <h2 id="comparison-title">目前住址 vs 假設搬遷</h2>
            </div>
          </div>
          <div className="scenario-grid">
            <ScenarioColumn result={actualResult} title="ACTUAL"/>
            <ScenarioColumn result={whatIfResult} title="WHAT-IF"/>
          </div>
        </section>
      )}

      {stage === "CONFIRMED" && (
        <div className="center-action">
          <button className="primary" onClick={compareAddresses}>Compare Addresses</button>
        </div>
      )}

      {stage === "COMPARED" && (
        <div className="center-action">
          <button className="primary" onClick={generatePassport}>Generate Decision Passport</button>
        </div>
      )}

      {passport ? (
        <DecisionPassportView passport={passport} sectionRef={resultsRef}/>
      ) : agentRun.status !== "IDLE" && (
        <section className="passport-placeholder" aria-label="Decision Passport pending">
          <strong>Decision Passport</strong>
          <span>完成 Human Gate 並由規則引擎重新評估後產生。</span>
        </section>
      )}

      <section className="section advanced" aria-labelledby="advanced-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Advanced</p>
            <h2 id="advanced-title">Governance &amp; Evaluation</h2>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Governance and evaluation">
          {advancedTabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={advancedTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              className={"tab" + (advancedTab === tab.id ? " is-active" : "")}
              onClick={() => setAdvancedTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tab-panel" role="tabpanel" id={`panel-${advancedTab}`} aria-labelledby={`tab-${advancedTab}`} key={advancedTab}>
          {advancedTab === "BENCHMARK" && (
            <BenchmarkComparison deterministic={benchmarkResult}/>
          )}

          {advancedTab === "RUNTIME" && (
            <div>
              <div className="metric-strip">
                <MetricItem label="Provider" value={providerInfo.provider === "OLLAMA" ? "OLLAMA LOCAL" : providerInfo.provider}/>
                <MetricItem label="LLM Calls" value={runtimeMetrics.llmCalls}/>
                <MetricItem label="Input Tokens" value={runtimeMetrics.inputTokens ?? "N/A"}/>
                <MetricItem label="Output Tokens" value={runtimeMetrics.outputTokens ?? "N/A"}/>
                <MetricItem
                  label="Execution"
                  value={providerInfo.provider === "OLLAMA" ? "LOCAL" : providerInfo.provider === "OPENAI" ? "CLOUD" : "N/A"}
                />
                <MetricItem
                  label="Cloud API Cost"
                  value={runtimeMetrics.estimatedCostUsd === null
                    ? "N/A"
                    : runtimeMetrics.estimatedCostUsd === 0
                      ? "$0"
                      : `$${runtimeMetrics.estimatedCostUsd.toFixed(2)}`}
                />
              </div>
              <p className="lead-note">LLM 僅負責 planning 與 tool routing；資格結果由 deterministic rules 決定。</p>
              {providerInfo.providerStatus === "UNAVAILABLE" && (
                <p className="muted">LLM provider currently unavailable; deterministic safety workflow remains available。</p>
              )}
              <details className="quiet-details">
                <summary>Local tool counters &amp; latency</summary>
                <div className="counter-grid">
                  <MetricItem label="Model" value={providerInfo.model}/>
                  <MetricItem label="Rules Engine Calls" value={runtimeMetrics.rulesEngineCalls}/>
                  <MetricItem label="Scenario Evaluations" value={runtimeMetrics.scenarioEvaluations}/>
                  <MetricItem label="Conflict Checks" value={runtimeMetrics.conflictChecks}/>
                  <MetricItem label="Permission Checks" value={runtimeMetrics.permissionChecks}/>
                  <MetricItem label="Passport Generations" value={runtimeMetrics.passportGenerations}/>
                  <MetricItem label="Measured Operations" value={runtimeMetrics.measuredOperations}/>
                  <MetricItem
                    label="Average Local Latency"
                    value={runtimeMetrics.measuredOperations
                      ? `${(runtimeMetrics.totalLatencyMs / runtimeMetrics.measuredOperations).toFixed(2)} ms`
                      : "N/A"}
                  />
                  <MetricItem
                    label="Last Local Latency"
                    value={runtimeMetrics.lastLatencyMs !== null ? `${runtimeMetrics.lastLatencyMs.toFixed(2)} ms` : "N/A"}
                  />
                </div>
                <p className="muted">
                  Local latency 僅代表目前瀏覽器內 deterministic tools 的本機執行時間，不代表正式部署後的網路或政府資料來源延遲。
                </p>
              </details>
            </div>
          )}

          {advancedTab === "CONFLICT" && (
            <div>
              <div className="panel-head">
                <p className="muted">此測試使用合成規則，僅驗證衝突偵測與風險控制機制，不代表任何真實政府政策互相矛盾。</p>
                <button className="secondary" onClick={runConflictTest}>Run Synthetic Conflict Test</button>
              </div>
              {conflictResult && (
                <div className="conflict-result reveal">
                  <div className="kv-row">
                    <span>Conflict Status</span>
                    <StatusBadge status={conflictResult.status}/>
                  </div>
                  <div className="kv-row">
                    <span>System Action</span>
                    <strong>{conflictResult.resolution}</strong>
                  </div>
                  {conflictResult.conflicts.map((conflict) => (
                    <div className="conflict-box" key={conflict.semanticKey}>
                      <strong>{conflict.semanticKey}</strong>
                      {conflict.claims.map((claim) => (
                        <div className="kv-row" key={claim.claimId}>
                          <span>{claim.sourceLabel} · {claim.version}</span>
                          <strong>{String(claim.value)}</strong>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="callout callout-warn">
                    <strong>Human Review Required</strong>
                    <p>偵測到相互矛盾的規則結果。GovAid Atlas 不會自行選擇其中一個答案，而是停止確定式資格判斷並要求人工查核。</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {advancedTab === "PERMISSION" && (
            <div>
              <div className="panel-head">
                <p className="muted">此區塊使用合成個資，僅驗證角色權限、敏感資料遮罩與拒絕存取。</p>
                <div className="segmented" role="group" aria-label="Role">
                  {(["APPLICANT", "REVIEWER", "POLICY_ADMIN"] as UserRole[]).map((role) => (
                    <button
                      key={role}
                      className={currentRole === role ? "is-active" : ""}
                      aria-pressed={currentRole === role}
                      onClick={() => changeRole(role)}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              <div className="kv-row">
                <span>Current Role</span>
                <strong>{currentRole}</strong>
              </div>
              <div className="kv-row">
                <span>Access</span>
                <strong>{visibleProfile.permission.allowed ? "ALLOWED" : "ACCESS_DENIED"}</strong>
              </div>
              {visibleProfile.profile ? (
                <dl className="sensitive-card">
                  <div><dt>姓名</dt><dd>{visibleProfile.profile.name}</dd></div>
                  <div><dt>身分證</dt><dd>{visibleProfile.profile.nationalId}</dd></div>
                  <div><dt>電話</dt><dd>{visibleProfile.profile.phone}</dd></div>
                  <div><dt>月收入</dt><dd>{visibleProfile.profile.monthlyIncome}</dd></div>
                </dl>
              ) : (
                <div className="callout callout-fail">
                  <strong>Access Denied</strong>
                  <p>此角色無權存取申請人敏感資料。</p>
                </div>
              )}
              <p className="muted">{visibleProfile.permission.reason}</p>
            </div>
          )}
        </div>

        <details className="audit">
          <summary>
            <span>Audit Trail <span className="counter">· {displayedAuditTrail.length} events</span></span>
          </summary>
          {displayedAuditTrail.length === 0 ? (
            <p className="muted">尚未建立 Case。</p>
          ) : (
            <div className="audit-list">
              {displayedAuditTrail.map((event, index) => (
                <div className="audit-row" key={event.timestamp + index}>
                  <span className="audit-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="audit-actor">{event.actor}</span>
                  <strong>{event.action}</strong>
                  <span className="audit-policy">{event.policyVersion}</span>
                </div>
              ))}
            </div>
          )}
        </details>
      </section>
    </main>
  );
}

type AdvancedTab = "BENCHMARK" | "RUNTIME" | "CONFLICT" | "PERMISSION";

const advancedTabs: {id: AdvancedTab; label: string}[] = [
  {id: "BENCHMARK", label: "Benchmark"},
  {id: "RUNTIME", label: "Runtime Metrics"},
  {id: "CONFLICT", label: "Rule Conflict"},
  {id: "PERMISSION", label: "Permission Control"},
];

type StepState = "PENDING" | "ACTIVE" | "DONE" | "BLOCKED";

type JourneyStep = {
  key: string;
  label: string;
  state: StepState;
};

function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function statusText(status: AgentRun["status"]): string {
  switch (status) {
    case "IDLE":
      return "READY";
    case "RUNNING_TOOL":
      return "CALLING TOOL";
    default:
      return status.replace(/_/g, " ");
  }
}

// Presentation-only view of the agent run; it reads status and audit events and never changes them.
function buildJourney(run: AgentRun): JourneyStep[] {
  const status = run.status;
  const toolCompleted = run.auditTrail.some((event) => event.action === "AGENT_TOOL_COMPLETED");
  const resumed = run.auditTrail.some((event) => event.action === "AGENT_RESUMED");
  const started = status !== "IDLE";

  const steps: JourneyStep[] = [
    {key: "goal", label: "Goal", state: started ? "DONE" : "ACTIVE"},
    {key: "plan", label: "Plan", state: !started ? "PENDING" : status === "PLANNING" ? "ACTIVE" : "DONE"},
    {
      key: "tool",
      label: "Tool",
      state: status === "RUNNING_TOOL" ? "ACTIVE" : toolCompleted ? "DONE" : "PENDING",
    },
    {
      key: "human",
      label: "Human Gate",
      state: status === "WAITING_FOR_HUMAN" || status === "HUMAN_REVIEW_REQUIRED"
        ? "ACTIVE"
        : resumed || status === "COMPLETED"
          ? "DONE"
          : "PENDING",
    },
    {
      key: "resume",
      label: "Resume",
      state: status === "RESUMING"
        ? "ACTIVE"
        : status === "COMPLETED" || (resumed && status === "WAITING_FOR_HUMAN")
          ? "DONE"
          : "PENDING",
    },
    {key: "decision", label: "Decision", state: status === "COMPLETED" ? "DONE" : "PENDING"},
  ];

  if (status === "FAILED") {
    const blocked = steps.find((step) => step.state !== "DONE");
    if (blocked) {
      blocked.state = "BLOCKED";
    }
  }

  return steps;
}

const policyLabels: Record<string, {name: string; detail: string}> = {
  CENTRAL_RENT_115: {name: "中央租屋補助", detail: "中央擴大租金補貼（115年度）"},
  NEW_TAIPEI_RENT_115: {name: "新北地方方案", detail: "新北市青年租金補貼（115年度）"},
  TAIPEI_RENT_115: {name: "臺北地方方案", detail: "臺北幸福租－租金加碼補貼（115年度）"},
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
};

function policyName(policyId: string): string {
  return policyLabels[policyId]?.name ?? policyId;
}

// Surfaces the first unresolved rule for display; statuses come straight from the rules engine.
function describeGap(evaluations: RuleEvaluation[]): string | null {
  const gap = evaluations.find((evaluation) => evaluation.status === "UNCERTAIN")
    ?? evaluations.find((evaluation) => evaluation.status === "FAIL");
  if (!gap) {
    return null;
  }
  const field = gap.reason.match(/缺少必要資料：(.+)/)?.[1] ?? gap.reason.split(" ")[0];
  const label = fieldLabels[field] ?? field;
  return gap.status === "UNCERTAIN" ? `待確認：${label}` : `不符合：${label}`;
}

function MetricItem({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="metric-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScenarioColumn({title, result}: {title: string; result: ScenarioResult}) {
  return (
    <article className={"scenario-col" + (title === "WHAT-IF" ? " is-whatif" : "")}>
      <header className="scenario-head">
        <span className="scenario-type">{title}</span>
        <h3>{result.scenario.city}{result.scenario.district}</h3>
        <p className="scenario-rent">
          NT${result.scenario.monthlyRent.toLocaleString()}
          <span> / month</span>
        </p>
      </header>

      <div className="policy-table" role="table" aria-label={`${title} policies`}>
        <div className="policy-row policy-row-head" role="row">
          <span role="columnheader">Policy</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Missing condition</span>
        </div>
        {result.policyResults.map((policy) => (
          <div className="policy-row" role="row" key={policy.policyId}>
            <span role="cell" className="policy-name">
              <strong>{policyName(policy.policyId)}</strong>
              <small>{policyLabels[policy.policyId]?.detail}</small>
            </span>
            <span role="cell"><StatusBadge status={policy.overallStatus}/></span>
            <span role="cell" className="policy-gap">{describeGap(policy.evaluations) ?? "—"}</span>
          </div>
        ))}
      </div>

      <details className="quiet-details">
        <summary>Rule detail</summary>
        {result.policyResults.map((policy) => (
          <div className="rule-group" key={policy.policyId}>
            <span className="rule-group-title">{policy.policyId}</span>
            {policy.evaluations.map((evaluation) => (
              <div className="rule-row" key={evaluation.ruleId}>
                <code>{evaluation.ruleId}</code>
                <span className="rule-reason">{evaluation.reason} · {evaluation.sourceId}</span>
                <StatusBadge status={evaluation.status}/>
              </div>
            ))}
          </div>
        ))}
      </details>
    </article>
  );
}

function DecisionPassportView({passport, sectionRef}: {passport: DecisionPassport; sectionRef: React.Ref<HTMLElement>}) {
  const programs = [...passport.actual.programs, ...passport.whatIf.programs]
    .filter((program, index, array) => array.findIndex((candidate) => candidate.policyId === program.policyId) === index);
  const evidence = [...passport.actual.programs, ...passport.whatIf.programs]
    .flatMap((program) => program.evidence)
    .filter((item, index, array) => array.findIndex((candidate) => candidate.sourceId === item.sourceId) === index)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en", {numeric: true}));

  return (
    <section className="passport reveal" ref={sectionRef} aria-labelledby="passport-title">
      <header className="passport-head">
        <div>
          <p className="eyebrow">{passport.caseId} · 申辦決策護照</p>
          <h2 id="passport-title">Decision Passport</h2>
        </div>
        <span className="passport-stamp">Generated {new Date(passport.generatedAt).toLocaleString("zh-TW", {hour12: false})}</span>
      </header>

      <div className="passport-summary">
        {programs.map((program) => (
          <div className={"program-tile tile-" + program.status.toLowerCase()} key={program.policyId}>
            <span className="program-name">{policyName(program.policyId)}</span>
            <StatusBadge status={program.status}/>
          </div>
        ))}
      </div>

      <div className="passport-grid">
        <div className="passport-col">
          <h3>Missing Items</h3>
          {passport.missingItems.length ? (
            <ul>{passport.missingItems.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p className="muted">無</p>}
        </div>
        <div className="passport-col">
          <h3>Risks</h3>
          <ul>{passport.risks.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="passport-col">
          <h3>Next Steps</h3>
          <ol>{passport.nextSteps.map((item) => <li key={item}>{item}</li>)}</ol>
        </div>
        <div className="passport-col">
          <h3>Evidence</h3>
          <div className="evidence-list">
            {evidence.map((item) => (
              <a key={item.sourceId} href={item.url} target="_blank" rel="noreferrer">
                <span className="evidence-id">{item.sourceId}</span>
                <span className="evidence-body">
                  <strong>{item.agency}</strong>
                  <span>{item.policyName}</span>
                  <small>查核日 {item.lastVerifiedAt}</small>
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <p className="disclaimer">{passport.disclaimer}</p>
    </section>
  );
}

function BenchmarkComparison({deterministic}: {deterministic: ReturnType<typeof runBenchmark>}) {
  return (
    <div className="benchmark">
      <div className="bench-legend" aria-hidden="true">
        <span className="bench-key"><span className="swatch swatch-baseline"/>LLM + Context</span>
        <span className="bench-key"><span className="swatch swatch-atlas"/>GovAid Atlas</span>
        <span className="bench-key bench-pending">Manual baseline — Pending</span>
      </div>

      <div className="bench-table" role="table" aria-label="LLM + Context vs GovAid Atlas">
        <div className="bench-row bench-row-head" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">LLM + Context</span>
          <span role="columnheader">GovAid Atlas</span>
        </div>
        {finalBenchmark.metrics.map((metric) => (
          <div className="bench-row" role="row" key={metric.key}>
            <span role="rowheader" className="bench-metric">
              <strong>{metric.label}</strong>
              <small>{metric.higherIsBetter ? "越高越好" : "越低越好"}</small>
            </span>
            <BenchValue variant="baseline" value={metric.llmContext}/>
            <BenchValue variant="atlas" value={metric.govaidAtlas}/>
          </div>
        ))}
      </div>

      <p className="lead-note">
        {finalBenchmark.caseCount} synthetic benchmark cases；不代表真實世界整體準確率。
      </p>
      <p className="muted">
        Unsafe Certainty 僅計算 5 個 safety-critical cases；Evidence Coverage 分母為 9 個需引用官方來源的案例。GovAid Atlas 數據為 deterministic evaluation，不含完整 Agent workflow 耗時。
      </p>

      <details className="quiet-details">
        <summary>
          Existing deterministic P0 regression · {deterministic.summary.passedCases}/{deterministic.summary.totalCases}{" "}
          <StatusBadge status={deterministic.summary.failedCases === 0 ? "PASS" : "FAIL"}/>
        </summary>
        <div className="benchmark-table">
          {deterministic.results.map((result) => (
            <div className="benchmark-row" key={result.id}>
              <strong>{result.id}</strong>
              <span>{result.name}</span>
              <span>{result.expected}</span>
              <span>{result.actual}</span>
              <StatusBadge status={result.passed ? "PASS" : "FAIL"}/>
            </div>
          ))}
        </div>
        <p className="muted">
          Evidence Coverage {deterministic.summary.evidenceCoveragePercent}% · Unsafe Certainty {deterministic.summary.unsafeCertaintyCount} ·
          Conflict {deterministic.summary.conflictCasesPassed}/{deterministic.summary.conflictCases} ·
          Recovery {deterministic.summary.recoveryCasesPassed}/{deterministic.summary.recoveryCases}
        </p>
      </details>
    </div>
  );
}

function BenchValue({variant, value}: {variant: "baseline" | "atlas"; value: {percent: number; numerator: number; denominator: number}}) {
  return (
    <span role="cell" className={"bench-value bench-" + variant} title={`${value.numerator}/${value.denominator}`}>
      <span className="bench-number">
        {Number.isInteger(value.percent) ? value.percent : value.percent.toFixed(1)}%
        <small>{value.numerator}/{value.denominator}</small>
      </span>
      <span className="bench-track" aria-hidden="true">
        <span className="bench-fill" style={{width: `${value.percent}%`}}/>
      </span>
    </span>
  );
}

export default App;
