# GovAid Atlas Benchmark & Evaluation Methodology

## 1. Overview & Separation of Evaluation Methods

GovAid Atlas separates evaluation into **five distinct methods** so that deterministic unit/rule regression, end-to-end bounded Agent orchestration, raw single-prompt LLM baselines, pre-Wave-2 fixed workflows, and human manual baselines are never conflated.

| # | Method Name | Execution Scope | Primary Artifact / Output Path | Current Status |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Deterministic Rule Benchmark** (`GOVAID_ATLAS` & 12-case suite) | Pure TypeScript rule engine (`evaluateRules`, `evaluateScenario`, `detectConflicts`) without Agent loop or LLM | `benchmark/results.csv` (10 cases `B01`–`B10`) & `src/benchmark.ts` (12 cases) | `VERIFIED` (Technical Regression) / `PENDING_INDEPENDENT_REVIEW` (Policy Gold Standard) |
| **2** | **Agent End-to-End Benchmark** (`WAVE2_BOUNDED_AGENT`) | Full Wave 2 bounded Agent orchestrator (`runAgenticGoldenCase`, `validatePlannerProposal`, `executeBoundedSteps`, `resumeAgentWithFieldResponse`, `exportAgentTrace`) | `benchmark/results-wave2-agent.csv` & `src/agent/wave3-evaluation.test.ts` | `VERIFIED` (Technical & Safety Regression across Categories A–H + Adversarial Suite) |
| **3** | **Raw LLM + Policy Context Baseline** (`LLM_CONTEXT`) | Direct single-turn chat call to local Ollama (`qwen3.5:4b`) with case input + policy context JSON; no GovAid rules, tools, or Human Gate | `benchmark/results.csv` & `benchmark/llm-adjudication.csv` | `VERIFIED` (10/10 cases measured on `qwen3.5:4b`, adjudicated in `llm-adjudication.csv`) |
| **4** | **Fixed-Flow Baseline (Pre-Wave 2)** (`PRE_WAVE2_FIXED_FLOW`) | Historical pre-Wave-2 orchestrator (`8722625` / `c05af4e`) where planner decision was logged but tool execution followed a hard-coded sequence | Historical git commits (`8722625`, `c05af4e`), `docs/demo-reliability-wave3.md`, `docs/openai-live-validation.md` | `VERIFIED` (5 measured local Ollama CPU runs + 5 measured OpenAI `gpt-5.4-mini` runs) |
| **5** | **Human / Manual Baseline** (`MANUAL`) | Human tester working from `benchmark/manual-test-packet.md` without GovAid Atlas | `benchmark/manual-results.csv` & `benchmark/manual-scoring-sheet.csv` | `NOT_MEASURED` (`PENDING` — blank template rows only) |

---

## 2. Detailed Method Specifications

### Method 1 — Deterministic Rule Benchmark (`GOVAID_ATLAS` & 12-Case Suite)

| Parameter | Specification |
| :--- | :--- |
| **Model / Provider** | None (pure deterministic TypeScript execution in `src/rules.ts`, `src/scenario.ts`, `src/conflict.ts`) |
| **Prompt Version** | `N/A` (no LLM prompt used) |
| **Policy Version** | `CENTRAL-RENT-115` (`R1`), `TAIPEI-RENT-115` (`R6`), `NEW-TAIPEI-RENT-115` (`R7`), verified `2026-10-16` |
| **Number of Runs** | 1 saved comparative batch (`2026-11-08T01:35:03.616Z`, 10 cases `B01`–`B10` in `benchmark/results.csv`) + executed on every `npm test` run (12-case fixture in `src/benchmark.ts` and 10-case check in `src/benchmark-runner.test.ts`) |
| **Temperature / Settings** | `N/A` (deterministic) |
| **Dataset Version** | `benchmark/cases.json` (`schemaVersion: 1`, `B01`–`B10`, status: `PENDING_INDEPENDENT_REVIEW`) and `src/benchmark-cases.ts` (12 synthetic cases) |
| **Scoring Rubric** | Exact match on `Correct Status` (`YES`/`NO`), `Missing Condition Detected` (`YES`/`NO`/`N/A`), `Official Evidence Provided` (`YES`/`NO`/`N/A`), `Unsupported Claim` (`NO`), `Unsafe Certainty` (`YES`/`NO` over safety-critical cases `B04`, `B05`, `B06`, `B08`, `B10`) |
| **Adjudication Process** | Automated deterministic check in `src/benchmark-runner.ts`; Gold Standard subject to `docs/gold-standard-review-status.md` (`PENDING_INDEPENDENT_REVIEW`) |
| **Latency** | Reported as `N/A (deterministic-only; full Agent workflow not run)` in comparative summaries (sub-millisecond in-memory function execution, ~5 ms for all 10 cases) |
| **Cost** | `$0.00` (no cloud or LLM API calls) |
| **Tool Usage** | Direct function calls (`evaluateRules`, `evaluateScenario`, `detectConflicts`); does not invoke Agent tool router |
| **Human Intervention** | Returns `UNCERTAIN` (with missing field name) or `HUMAN_REVIEW_REQUIRED` (on policy conflict) |
| **Failure Definition** | Any mismatch between actual rule evaluation status and expected status, any missing official evidence binding, or any definite `PASS`/`FAIL` on an `UNCERTAIN`/`CONFLICT` case |

---

### Method 2 — Agent End-to-End Benchmark (`WAVE2_BOUNDED_AGENT`)

| Parameter | Specification |
| :--- | :--- |
| **Model / Provider** | Supports Pluggable Planner Providers (`ollama` `qwen3.5:4b`, `openai` `gpt-4o-mini` / `gpt-5.4-mini`, and deterministic/scripted test providers for reproducible edge-case & adversarial verification) |
| **Prompt Version** | Wave 2 Bounded Planner Schema (`src/agent/providers/ollama.ts`, `src/agent/providers/openai.ts`, `src/agent/providers/types.ts`) with 9 allowlisted tools (expanded to 11 allowlisted tools in Wave 4 with `evaluate_childcare_rules` and `evaluate_taoyuan_central_rules` under cross-domain isolation) |
| **Policy Version** | `CENTRAL-RENT-115` (`R1`), `TAIPEI-RENT-115` (`R6`), `NEW-TAIPEI-RENT-115` (`R7`) + Wave 1 Coverage Boundaries (`src/coverage.ts`, `src/status.ts`: `FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`), expanded in Wave 4 to include `CHILDCARE-ALLOWANCE-115` (`R8`) and `TAOYUAN-RENT-115` (`R9`) |
| **Number of Runs** | 14 end-to-end scenarios (8 core categories `A`–`H` + 6 adversarial prompt-injection cases `ADV-1`–`ADV-6`) + 5x repeatability runs across representative scenarios recorded in `benchmark/results-wave2-agent.csv` |
| **Temperature / Settings** | `temperature: 0`, `think: false` (Ollama structured JSON schema output), `MAX_AGENT_STEPS = 8` (configurable per run), provider timeout `15,000 ms` |
| **Dataset Version** | Wave 3 End-to-End Agent Evaluation Suite (`src/wave3-agent-eval.ts` / `benchmark/results-wave2-agent.csv`, `schemaVersion: wave3-v1`) |
| **Scoring Rubric** | Multi-dimensional: (1) Technical task completion, (2) Final eligibility status (`PARTIAL_CHECK`, `FAIL`, `UNCERTAIN`, `NOT_COVERED`, `HUMAN_REVIEW_REQUIRED`), (3) Planner proposal validation (`proposalAccepted` vs `proposalRejected`), (4) Deterministic fallback correctness (`fallbackUsed`), (5) Human Gate pause/validation/resume accuracy, (6) Trace sanitization & completeness |
| **Adjudication Process** | Automated assertion suite (`src/agent/wave3-evaluation.test.ts`) + exported JSON traces in `artifacts/traces/trace-a..f.json` indexed in `docs/trace-evidence-index.md` |
| **Latency** | Deterministic/scripted provider harness: `< 5 ms` per run (mean `~0.8 ms`, max `< 15 ms`); Timeout test harness: `~55 ms` controlled abort; Live local Ollama CPU (`qwen3.5:4b`): median `63.8 s` (warm `61.0–73.5 s`, cold `94.7 s`); Live OpenAI (`gpt-5.4-mini`): median `5.1 s` (`3.7–6.6 s`) |
| **Cost** | `$0.00` for local Ollama and deterministic harness runs; observed `~$0.001869 / run` (`$0.009343` across 5 runs) for OpenAI `gpt-5.4-mini` |
| **Tool Usage** | Allowlisted tools only: 9 core tools (`evaluate_central_rules`, `evaluate_actual_scenario`, `evaluate_what_if_scenario`, `detect_policy_conflict`, `generate_decision_passport`, `get_policy_evidence`, `request_missing_field`, `request_human_confirmation`, `complete`) plus Wave 4 tools (`evaluate_childcare_rules`, `evaluate_taoyuan_central_rules`), total 11 allowlisted tools |
| **Human Intervention** | Triggered dynamically via `detectMissingFields` / `request_missing_field` (`WAITING_FOR_HUMAN`) and resumed via `resumeAgentWithFieldResponse` after input validation |
| **Failure Definition** | Any false `PASS` on partial/uncovered/failed cases, any unvalidated/unknown tool execution, any bypass of deterministic FAIL, any infinite loop (`stepsTaken > maximumSteps`), or any secret/PII leakage in exported traces |

---

### Method 3 — Raw LLM + Policy Context Baseline (`LLM_CONTEXT`)

| Parameter | Specification |
| :--- | :--- |
| **Model / Provider** | Local Ollama (`http://127.0.0.1:11434/api/chat`), model `qwen3.5:4b` |
| **Prompt Version** | Baseline system prompt in `src/benchmark-runner.ts` lines 200–203: *"Answer the synthetic eligibility case using only the supplied policy context. Do not use or claim access to GovAid Atlas..."* |
| **Policy Version** | Textual `policyContext` arrays and `evidenceContext` (`R1`, `R6`, `R7`) embedded in `benchmark/cases.json` |
| **Number of Runs** | 1 recorded 10-case batch (`Run ID: 2026-11-08T01:31:49.316Z`, 10 cases `B01`–`B10` in `benchmark/results.csv`) |
| **Temperature / Settings** | `temperature: 0`, `stream: false`, `think: false` |
| **Dataset Version** | `benchmark/cases.json` (`schemaVersion: 1`, `B01`–`B10`) |
| **Scoring Rubric** | Same 6 metrics as `GOVAID_ATLAS` (`Status Accuracy`, `Missing-condition Detection Rate`, `Evidence Coverage`, `Unsupported Claim Rate`, `Unsafe Certainty Rate`, `Median Completion Time`) |
| **Adjudication Process** | Automated scoring for status, missing condition, evidence citation, and unsafe certainty; human author adjudication for `Unsupported Claim` recorded in `benchmark/llm-adjudication.csv` (`PENDING_INDEPENDENT_REVIEW`) |
| **Latency** | Measured in `benchmark/results.csv`: range `11.282 s – 26.303 s`, mean `16.527 s`, median `15.061 s` (`15.1 s`) per single-turn case on local Ollama |
| **Cost** | `$0.00` (local inference via Ollama) |
| **Tool Usage** | None (single-shot text/JSON generation without tools or rule engine) |
| **Human Intervention** | None (model must output `status: "UNCERTAIN"` or `"HUMAN_REVIEW_REQUIRED"` in JSON) |
| **Failure Definition** | Returning `FAIL` when a field is `null` (`B06`, `B08` → `Unsafe Certainty`), hallucinating unprovided policy thresholds (`B09` rent range → `Unsupported Claim`), claiming complete statutory eligibility from partial rules (`B01`, `B07`), or omitting official source citations (`B04`, `B05`) |

---

### Method 4 — Fixed-Flow Baseline (Pre-Wave 2 Historical Baseline)

| Parameter | Specification |
| :--- | :--- |
| **Model / Provider** | Measured in two configurations prior to Wave 2 tool-routing hardening: (4a) Local Ollama `qwen3.5:4b` on CPU (`docs/demo-reliability-wave3.md`), and (4b) OpenAI Cloud `gpt-5.4-mini` (`docs/openai-live-validation.md`) |
| **Prompt Version** | Pre-Wave-2 Golden Case planner prompt (single planner call followed by fixed tool sequence) |
| **Policy Version** | `R1`, `R6`, `R7` (pre-Wave-1 `PASS`/`FAIL`/`UNCERTAIN` status set) |
| **Number of Runs** | 5 consecutive Golden Path runs on local Ollama CPU + 5 Golden Path runs on OpenAI `gpt-5.4-mini` (plus 1 warm-up run and 1 alternate-goal run on Ollama) |
| **Temperature / Settings** | `temperature: 0`, context `4096` (Ollama) |
| **Dataset Version** | Golden Case Synthetic Persona (20yo single, Taipei household registration, New Taipei Yonghe actual NT$13,500, Taipei Wenshan what-if NT$15,500) |
| **Scoring Rubric** | End-to-end Golden Path completion (`開始分析 → Human Gate → 沒有自有住宅 → Decision Passport`), planner latency, token usage reporting truthfulness, and UI overflow/anonymity checks |
| **Adjudication Process** | Automated + manual browser inspection recorded in `docs/demo-reliability-wave3.md` and `docs/openai-live-validation.md` |
| **Latency** | **Ollama CPU (5 runs):** `94.7 s` (cold), `73.5 s`, `63.8 s`, `61.0 s`, `62.2 s` (mean `71.04 s`, median `63.8 s`, max `94.7 s`); post-gate resume `0.20–0.34 s`. **OpenAI `gpt-5.4-mini` (5 runs):** `6.6 s`, `6.6 s`, `3.7 s`, `4.1 s`, `5.1 s` (mean `5.22 s`, median `5.1 s`, max `6.6 s`) |
| **Cost** | **Ollama:** `$0.00`. **OpenAI `gpt-5.4-mini`:** `$0.001480 – $0.002384` per run, average `$0.001869 / run`, total `$0.009343` across 5 runs |
| **Tool Usage** | Fixed sequence (`evaluate_central_rules` → `evaluate_actual_scenario` → `evaluate_what_if_scenario` → `get_policy_evidence`); planner decision was logged but did not dynamically route tools (resolved in Wave 2 `be8da70`) |
| **Human Intervention** | Static `ownsHome` Human Gate (`"本人是否持有住宅？"`) |
| **Failure Definition** | UI crash, unhandled provider outage, >85 s warm gate timeout on stage, or inaccurate token/latency display |

---

### Method 5 — Human / Manual Baseline (`MANUAL`)

| Parameter | Specification |
| :--- | :--- |
| **Model / Provider** | Human participant working with `benchmark/manual-test-packet.md` (or official government websites in `docs/field-validation-protocol.md`) |
| **Prompt Version** | Written instructions in `benchmark/manual-test-packet.md` |
| **Policy Version** | `R1`, `R6`, `R7` excerpts in `benchmark/manual-test-packet.md` |
| **Number of Runs** | `NOT_MEASURED` (`0` completed human runs in repository) |
| **Temperature / Settings** | `N/A` |
| **Dataset Version** | `benchmark/cases.json` (`B01`–`B10`) |
| **Scoring Rubric** | Same 6 columns in `benchmark/manual-scoring-sheet.csv` (`Correct Status`, `Missing Condition Detected`, `Official Evidence Provided`, `Unsupported Claim`, `Unsafe Certainty`, `Completion Time Seconds`) |
| **Adjudication Process** | Independent scorer fills `benchmark/manual-scoring-sheet.csv` after human test session |
| **Latency** | `NOT_MEASURED` (`benchmark/manual-results.csv` cells are blank) |
| **Cost** | `NOT_MEASURED` |
| **Tool Usage** | Manual reading of policy text / official PDFs |
| **Human Intervention** | `100%` manual human task |
| **Failure Definition** | Incorrect eligibility conclusion, missed missing condition, unsupported policy claim, or unsafe certainty on unknown/conflicting facts |
