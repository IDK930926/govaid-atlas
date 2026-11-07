import {useMemo, useState} from "react";

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
  recordRuntimeOperation,
  type RuntimeCounterKey,
  type RuntimeMetrics,
} from "./metrics";

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
      {status}
    </span>
  );
}

function App() {
  const [applicant, setApplicant] = useState<ApplicantProfile>(initialApplicant);
  const [stage, setStage] = useState<DemoStage>("IDLE");
  const [centralEvaluation, setCentralEvaluation] = useState<RuleEvaluation[]>([]);
  const [actualResult, setActualResult] = useState<ScenarioResult | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<ScenarioResult | null>(null);
  const [passport, setPassport] = useState<DecisionPassport | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([]);

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

  function confirmNoHome() {
    const updatedApplicant = {...applicant, ownsHome: false};
    setApplicant(updatedApplicant);
    audit("USER", "FIELD_CONFIRMED", {field: "ownsHome", value: false});

    const measured =
      measureSync(() =>
        evaluateRules(
          centralRules,
          updatedApplicant
        )
      );

    const evaluation =
      measured.result;

    recordMetric(
      "rulesEngineCalls",
      measured.latencyMs
    );
    setCentralEvaluation(evaluation);
    audit("RULE_ENGINE", "RE_EVALUATION", updatedApplicant, {
      evaluations: evaluation,
      overallStatus: getOverallStatus(evaluation),
    });
    setStage("CONFIRMED");
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

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Agentic AI · Housing Decision</p>
          <h1>GovAid Atlas</h1>
          <p className="subtitle">育兒／租屋補助導航與合規申辦 AI Agent</p>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={resetDemo}>Reset Demo</button>
          <button className="primary" onClick={startGoldenCase}>Start Golden Case</button>
        </div>
      </header>

      <section className="notice">
        <strong>Synthetic Persona</strong>
        <span>本 Demo 全部使用合成資料；結果僅為預審導航，不代表主管機關核准。</span>
      </section>

      <section className="grid-two">
        <article className="card">
          <div className="card-header">
            <h2>Case Profile</h2>
            <StatusBadge status={stage === "IDLE" ? "READY" : stage}/>
          </div>
          <dl className="profile">
            <div><dt>年齡</dt><dd>{applicant.age}</dd></div>
            <div><dt>婚姻</dt><dd>單身</dd></div>
            <div><dt>戶籍</dt><dd>{applicant.registeredCity}</dd></div>
            <div><dt>住宅持有</dt><dd>{applicant.ownsHome === null ? "待確認" : applicant.ownsHome ? "有" : "無"}</dd></div>
          </dl>
          {stage === "UNCERTAIN" && (
            <div className="warning-box">
              <strong>需要人工確認</strong>
              <p>缺少必要資料：本人是否持有住宅。Agent 暫停資格推論，不自行猜測。</p>
              <button className="primary" onClick={confirmNoHome}>確認本人無自有住宅</button>
            </div>
          )}
        </article>

        <article className="card">
          <h2>Agent Plan</h2>
          <ol className="plan">
            <li className="done">建立 Applicant Profile</li>
            <li className={stage !== "IDLE" ? "done" : ""}>執行中央規則</li>
            <li className={stage === "CONFIRMED" || stage === "COMPARED" || stage === "PASSPORT" ? "done" : ""}>Human Confirmation</li>
            <li className={stage === "COMPARED" || stage === "PASSPORT" ? "done" : ""}>Actual / What-if Policy Routing</li>
            <li className={stage === "PASSPORT" ? "done" : ""}>Decision Passport</li>
          </ol>
          {currentCentralStatus && (
            <div className="result-line">
              <span>Central Rules</span>
              <StatusBadge status={currentCentralStatus}/>
            </div>
          )}
          {stage === "CONFIRMED" && (
            <button className="primary full" onClick={compareAddresses}>Compare Addresses</button>
          )}
        </article>
      </section>

      {actualResult && whatIfResult && (
        <section className="scenario-grid">
          <ScenarioCard result={actualResult} title="ACTUAL"/>
          <ScenarioCard result={whatIfResult} title="WHAT-IF"/>
        </section>
      )}

      {stage === "COMPARED" && (
        <div className="center-action">
          <button className="primary" onClick={generatePassport}>Generate Decision Passport</button>
        </div>
      )}

      {passport && (
        <section className="card passport">
          <div className="card-header">
            <div>
              <p className="eyebrow">CASE-P0-001</p>
              <h2>申辦決策護照</h2>
            </div>
            <StatusBadge status="UNCERTAIN"/>
          </div>
          <div className="passport-grid">
            <div>
              <h3>待確認事項</h3>
              <ul>{passport.missingItems.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h3>風險</h3>
              <ul>{passport.risks.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h3>下一步</h3>
              <ol>{passport.nextSteps.map(item => <li key={item}>{item}</li>)}</ol>
            </div>
            <div>
              <h3>Evidence</h3>
              <div className="evidence-list">
                {[...passport.actual.programs, ...passport.whatIf.programs]
                  .flatMap(program => program.evidence)
                  .filter((item, index, array) => array.findIndex(candidate => candidate.sourceId === item.sourceId) === index)
                  .map(item => (
                    <a key={item.sourceId} href={item.url} target="_blank" rel="noreferrer">
                      <strong>{item.sourceId}</strong>
                      <span>{item.agency}</span>
                    </a>
                  ))}
              </div>
            </div>
          </div>
          <p className="disclaimer">{passport.disclaimer}</p>
        </section>
      )}

        <section className="card">
    <div className="card-header">
      <div>
        <p className="eyebrow">
          GOVERNANCE TEST
        </p>

        <h2>
          Rule Conflict
        </h2>
      </div>

      <button
        className="secondary"
        onClick={runConflictTest}
      >
        Run Synthetic Conflict Test
      </button>
    </div>

    <p className="conflict-note">
      此測試使用合成規則，
      僅驗證衝突偵測與風險控制機制，
      不代表任何真實政府政策互相矛盾。
    </p>

    {conflictResult && (
      <>
        <div className="result-line">
          <span>
            Conflict Status
          </span>

          <StatusBadge
            status={
              conflictResult.status
            }
          />
        </div>

        <div className="result-line">
          <span>
            System Action
          </span>

          <strong>
            {
              conflictResult.resolution
            }
          </strong>
        </div>

        {conflictResult.conflicts.map(
          (conflict) => (
            <div
              className="conflict-box"
              key={
                conflict.semanticKey
              }
            >
              <strong>
                {
                  conflict.semanticKey
                }
              </strong>

              {conflict.claims.map(
                (claim) => (
                  <div
                    className="rule-row"
                    key={claim.claimId}
                  >
                    <span>
                      {claim.sourceLabel}
                      {" · "}
                      {claim.version}
                    </span>

                    <strong>
                      {String(
                        claim.value
                      )}
                    </strong>
                  </div>
                )
              )}
            </div>
          )
        )}

        <div className="warning-box">
          <strong>
            Human Review Required
          </strong>

          <p>
            偵測到相互矛盾的規則結果。
            GovAid Atlas 不會自行選擇其中一個答案，
            而是停止確定式資格判斷並要求人工查核。
          </p>
        </div>
      </>
    )}
  </section>
      
      <section className="card">
  <div className="card-header">
    <div>
      <p className="eyebrow">
        GOVERNANCE
      </p>

      <h2>
        Permission Control
      </h2>
    </div>

    <div className="role-switcher">
      {(
        [
          "APPLICANT",
          "REVIEWER",
          "POLICY_ADMIN",
        ] as UserRole[]
      ).map((role) => (
        <button
          key={role}
          className={
            currentRole === role
              ? "primary"
              : "secondary"
          }
          onClick={() =>
            changeRole(role)
          }
        >
          {role}
        </button>
      ))}
    </div>
  </div>

  <p className="conflict-note">
    此區塊使用合成個資，
    僅驗證角色權限、
    敏感資料遮罩與拒絕存取。
  </p>

  <div className="permission-grid">
    <div>
      <span>Current Role</span>
      <strong>
        {currentRole}
      </strong>
    </div>

    <div>
      <span>Access</span>
      <strong>
        {
          visibleProfile
            .permission.allowed
            ? "ALLOWED"
            : "ACCESS_DENIED"
        }
      </strong>
    </div>
  </div>

  {visibleProfile.profile ? (
    <div className="sensitive-card">
      <p>
        姓名：
        {
          visibleProfile.profile
            .name
        }
      </p>

      <p>
        身分證：
        {
          visibleProfile.profile
            .nationalId
        }
      </p>

      <p>
        電話：
        {
          visibleProfile.profile
            .phone
        }
      </p>

      <p>
        月收入：
        {
          visibleProfile.profile
            .monthlyIncome
        }
      </p>
    </div>
  ) : (
    <div className="warning-box">
      <strong>
        Access Denied
      </strong>

      <p>
        此角色無權存取申請人敏感資料。
      </p>
    </div>
  )}

  <p className="disclaimer">
    {
      visibleProfile
        .permission.reason
    }
  </p>
</section>

      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">
              OBSERVABILITY
            </p>

            <h2>
              Runtime Metrics
            </h2>
          </div>
        </div>

        <p className="conflict-note">
          以下為目前 P0 在瀏覽器本機實際量測的執行指標。
          P0 尚未連接 LLM，因此 Token 與模型成本不填入假設數字。
        </p>

        <div className="metrics-grid">
          <MetricItem
            label="Rules Engine Calls"
            value={runtimeMetrics.rulesEngineCalls}
          />

          <MetricItem
            label="Scenario Evaluations"
            value={runtimeMetrics.scenarioEvaluations}
          />

          <MetricItem
            label="Conflict Checks"
            value={runtimeMetrics.conflictChecks}
          />

          <MetricItem
            label="Permission Checks"
            value={runtimeMetrics.permissionChecks}
          />

          <MetricItem
            label="Passport Generations"
            value={runtimeMetrics.passportGenerations}
          />

          <MetricItem
            label="Measured Operations"
            value={runtimeMetrics.measuredOperations}
          />

          <MetricItem
            label="Average Local Latency"
            value={
              runtimeMetrics.measuredOperations
                ? `${(
                    runtimeMetrics.totalLatencyMs /
                    runtimeMetrics.measuredOperations
                  ).toFixed(2)} ms`
                : "N/A"
            }
          />

          <MetricItem
            label="Last Local Latency"
            value={
              runtimeMetrics.lastLatencyMs !== null
                ? `${runtimeMetrics.lastLatencyMs.toFixed(2)} ms`
                : "N/A"
            }
          />

          <MetricItem
            label="LLM Calls"
            value="0 · not connected"
          />

          <MetricItem
            label="Input / Output Tokens"
            value="N/A"
          />

          <MetricItem
            label="Estimated Model Cost"
            value="N/A"
          />
        </div>

        <p className="disclaimer">
          Local latency 僅代表目前瀏覽器內 deterministic tools
          的本機執行時間，不代表正式部署後的網路或政府資料來源延遲。
        </p>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Audit Trail</h2>
          <span className="counter">{auditTrail.length} events</span>
        </div>
        {auditTrail.length === 0 ? (
          <p className="empty">尚未建立 Case。</p>
        ) : (
          <div className="audit-list">
            {auditTrail.map((event, index) => (
              <div className="audit-row" key={event.timestamp + index}>
                <span className="audit-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="audit-actor">{event.actor}</span>
                <strong>{event.action}</strong>
                <span className="audit-policy">{event.policyVersion}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
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

function ScenarioCard({title, result}: {title: string; result: ScenarioResult}) {
  return (
    <article className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{result.scenario.city}{result.scenario.district}</h2>
        </div>
        <span className="rent">NT${result.scenario.monthlyRent.toLocaleString()}/月</span>
      </div>
      <div className="policy-list">
        {result.policyResults.map((policy) => (
          <div className="policy" key={policy.policyId}>
            <div className="policy-title">
              <strong>{policy.policyId}</strong>
              <StatusBadge status={policy.overallStatus}/>
            </div>
            {policy.evaluations.map((evaluation) => (
              <div className="rule-row" key={evaluation.ruleId}>
                <span>{evaluation.ruleId}</span>
                <StatusBadge status={evaluation.status}/>
              </div>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

export default App;
