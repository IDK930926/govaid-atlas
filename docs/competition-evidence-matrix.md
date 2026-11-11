# NAPAI 2026 Competition Evidence Matrix

## 1. Overview

This document maps each of the six official **NAPAI 2026 judging categories** (totaling 100%) to concrete, verifiable files, automated tests, and exported traces in the GovAid Atlas repository, while transparently identifying any remaining gaps and next actions.

> **Scoring Integrity Note:** No official judge scores are invented. Confidence ratings (`HIGH`, `MEDIUM`, `LOW — PENDING HUMAN DATA`) reflect the completeness of repository evidence as of Wave 3.

---

## 2. Category-by-Category Evidence Mapping

### Category 1 — 任務完成度與穩定性 (Task Completion & Stability) — **25%**

- **Current Evidence:**
  - **Deterministic Rule Engine & Status Priority (`FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`):** Prevents false-positive eligibility approvals when only a partial subset of rules is encoded (`PARTIAL_CHECK`) or when a city/benefit domain is out of scope (`NOT_COVERED`).
  - **Automated Regression & End-to-End Evaluation:**
    - `46 / 46` automated tests passing across 5 test suites (`npm test`), plus zero TypeScript errors (`npx tsc --noEmit`) and clean production build (`vite build`).
    - `8 / 8` (**100%**) technical task completion across core Agent categories `CAT-A`..`CAT-H` (`benchmark/results-wave2-agent.csv`), with `40 / 40` (**100%**) repeatability across 5 repeated runs per category (`src/wave3-agent-eval.ts`).
    - `12 / 12` (**100%**) pass rate on the deterministic regression suite (`src/benchmark.ts`).
  - **Live LLM Stability & Fallback Proofs:**
    - `5 / 5` consecutive Golden Path completions on local Ollama CPU (`qwen3.5:4b`, median planner latency `63.8 s`, post-gate resume `≤ 0.34 s`, `docs/demo-reliability-wave3.md`).
    - `5 / 5` Golden Path completions on OpenAI Cloud (`gpt-5.4-mini`, median planner latency `5.1 s`, `docs/openai-live-validation.md`).
    - Verified graceful degradation when LLM provider is offline or times out (`TRACE-F`, `CAT-G`, `docs/demo-reliability-wave3.md` §3).
- **Missing Evidence:**
  - Live multi-turn latency benchmarks across all 8 Wave 2 categories (`CAT-A`..`CAT-H`) against live cloud/local LLM endpoints (current `CAT-A`..`CAT-H` batch uses deterministic/scripted provider responses for fast, reproducible CI verification).
  - Expanded statutory rules beyond the 2-rule P0 subset per program (`R1`, `R6`, `R7`).
- **Relevant Files / Traces / Tests:**
  - `src/rules.ts`, `src/scenario.ts`, `src/status.ts`, `src/coverage.ts`, `src/passport.ts`
  - `src/correctness-boundary.test.ts`, `src/agent/wave3-evaluation.test.ts`, `src/wave3-agent-eval.ts`
  - `benchmark/results-wave2-agent.csv`, `docs/napai-evaluation-report.md`, `docs/demo-reliability-wave3.md`, `docs/openai-live-validation.md`
  - `artifacts/traces/trace-a-valid-proposal.json`, `artifacts/traces/trace-f-provider-unavailable.json`
- **Current Confidence:** **`HIGH`** (for P0 scope & technical stability)
- **Next Action:** Run optional live Ollama/OpenAI timing pass on `CAT-A`..`CAT-H` if judges request live model timings beyond the Golden Path.

---

### Category 2 — 場域成效與使用者驗證 (Field Impact & User Validation) — **20%**

- **Current Evidence:**
  - **Rigorous Crossover Study Design Ready:** `docs/field-validation-protocol.md` defines a counterbalanced 5–8 participant crossover study comparing `Task A` (Official Government Websites/PDFs) vs. `Task B` (GovAid Atlas) on synthetic personas (`S1`, `S2`), measuring completion rate, time, error count, confidence (`1–5`), and SUS (`0–100`).
  - **Blank Audit-Ready Recording Templates:** `docs/field-validation-results-template.md`, `benchmark/manual-test-packet.md`, `benchmark/manual-results.csv`, and `benchmark/manual-scoring-sheet.csv`.
  - **Independent Domain Review Package:** `docs/gold-standard-review-status.md` and `docs/gold-standard-independent-review-template.md` provide a complete case-by-case review packet (`B01`–`B10`) for an external social worker or housing policy reviewer.
- **Missing Evidence:**
  - **Actual human participant data (`0` human sessions completed; `STATUS: PENDING`).**
  - **Completed independent reviewer sign-off on `B01`–`B10` (`STATUS: PENDING_INDEPENDENT_REVIEW`).**
- **Relevant Files / Traces / Tests:**
  - `docs/field-validation-protocol.md`
  - `docs/field-validation-results-template.md`
  - `docs/gold-standard-review-status.md`
  - `docs/gold-standard-independent-review-template.md`
  - `benchmark/manual-test-packet.md`, `benchmark/manual-results.csv`, `benchmark/manual-scoring-sheet.csv`
- **Current Confidence:** **`LOW — PENDING HUMAN DATA`** (Protocols and templates are `READY`, but empirical human numbers are `MISSING` / `PENDING` and never fabricated)
- **Next Action:** Execute 5–8 real human test sessions using `docs/field-validation-protocol.md` and obtain 1 independent reviewer sign-off on `docs/gold-standard-independent-review-template.md` prior to final presentation.

---

### Category 3 — Agentic 技術深度與適切性 (Agentic Technical Depth & Appropriateness) — **20%**

- **Current Evidence:**
  - **True Bounded Stateful Tool Routing (`executeBoundedSteps` in `src/agent/orchestrator.ts`):** Planner proposals genuinely control which allowlisted tool executes (`TRACE-A`), replacing the pre-Wave-2 fixed sequence while keeping the LLM strictly out of eligibility calculation.
  - **Dynamic Missing-Field Detection & Stateful Resume (`src/agent/missing-fields.ts`):** Detects missing fields across 8 supported attributes (`city`, `ownsHome`, `receivesOtherHousingAid`, `monthlyIncome`, `age`, `centralRentApproved`, `newTaipeiResidenceStudyWork`, `registeredCity`), asks field-specific questions, validates user responses (`validateMissingFieldInput`), records `beforeState`/`afterState` transitions, and resumes execution (`TRACE-B`).
  - **Comparative Baseline Proof (`benchmark/results.csv`):** Demonstrates why an Agentic + Deterministic architecture is superior to raw `LLM_CONTEXT` (`qwen3.5:4b` alone had `40%` Unsafe Certainty on safety-critical cases `B06`/`B08` and `30%` Unsupported Claims on `B01`/`B07`/`B09`, compared to `0%` Unsafe Certainty for GovAid Atlas).
- **Missing Evidence:**
  - Multi-step natural-language slot extraction directly from free-form user replies (current resume path validates structured field values).
- **Relevant Files / Traces / Tests:**
  - `src/agent/orchestrator.ts`, `src/agent/missing-fields.ts`, `src/agent/tools.ts`, `src/agent/types.ts`
  - `src/agent/providers/ollama.ts`, `src/agent/providers/openai.ts`, `src/agent/client.ts`
  - `artifacts/traces/trace-a-valid-proposal.json`, `artifacts/traces/trace-b-missing-field-resume.json`
  - `src/agent/wave2-hardening.test.ts`, `benchmark/results.csv`, `docs/benchmark-methodology.md`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Highlight `TRACE-A` (dynamic tool routing) and `TRACE-B` (stateful human-gate resume) during technical Q&A.

---

### Category 4 — 安全、可控性與治理 (Safety, Controllability & Governance) — **15%**

- **Current Evidence:**
  - **3-Layer Proposal Validation (`validatePlannerProposal`):** Blocks malformed JSON (`SCHEMA_VALIDATION`), unallowlisted tools (`ALLOWLIST_VALIDATION`, `TRACE-C`), premature `COMPLETE`, duplicate tool loops (`DUPLICATE_TOOL_CALL_WITHOUT_STATE_CHANGE`), and profile/status override attempts (`STATE_TRANSITION_VALIDATION`, `TRACE-E`).
  - **Prompt Injection & Adversarial Safety Suite (`ADV-1`..`ADV-6`):** `6 / 6` (**100%**) adversarial attacks blocked (`src/wave3-agent-eval.ts`, `src/agent/wave3-evaluation.test.ts`).
  - **Coverage Boundary (`NOT_COVERED`):** Blocks out-of-scope childcare queries (`育兒津貼`) and uncovered municipalities (`桃園市`) from ever producing a false `PASS` (`TRACE-D`).
  - **API Hardening (`src/server.ts`):** `16 KB` body limit (`HTTP 413`), `800-char` goal limit (`HTTP 400`), `20 req / 60s` rate limiter (`HTTP 429`), and `15s` provider timeout (`AGENT_PROVIDER_TIMEOUT`).
  - **Sanitized Trace Export (`src/agent/trace.ts`):** Redacts API keys, tokens, system prompts, chain-of-thought, and PII (`docs/trace-evidence-index.md`).
  - **Honest Security & Third-Party Disclosures:** `docs/security-self-assessment.md` (explicitly disclosing synthetic RBAC limitation) and `docs/third-party-resources.md`.
- **Missing Evidence:**
  - Production authentication/RBAC backend (not in P0 scope; explicitly disclosed).
- **Relevant Files / Traces / Tests:**
  - `src/agent/orchestrator.ts`, `src/agent/trace.ts`, `src/server.ts`, `src/coverage.ts`, `src/status.ts`
  - `artifacts/traces/trace-c-rejected-proposal.json`, `artifacts/traces/trace-d-not-covered.json`, `artifacts/traces/trace-e-deterministic-fail.json`
  - `docs/security-self-assessment.md`, `docs/third-party-resources.md`, `docs/gold-standard-review-status.md`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Present the 3-layer validation gate and `TRACE-C`/`TRACE-E` as primary governance artifacts.

---

### Category 5 — 創新與擴散價值 (Innovation & Scalability / Diffusion Value) — **10%**

- **Current Evidence:**
  - **Actual vs. What-If Relocation Comparison (`src/scenario.ts`):** Allows renters to compare how moving across municipal boundaries (e.g., New Taipei Yonghe vs. Taipei Wenshan) affects combined central + local subsidy eligibility before signing a lease.
  - **Decision Passport (`src/passport.ts`):** Translates rule evaluations and official citations (`R1`, `R6`, `R7`) into an actionable citizen checklist with explicit risk/uncertainty callouts (`初步條件通過（部分檢核）`, `尚未涵蓋`).
  - **Pluggable Policy & Provider Architecture:** JSON-declarative policy rules (`src/policies/*.json`) + pluggable local/cloud LLM providers (`ollama` / `openai`) enable expansion to additional municipalities (`桃園市`, `臺中市`, etc.) and welfare domains without changing the core orchestrator.
- **Missing Evidence:**
  - Live expansion to a 4th municipality or full childcare rule pack (currently bounded by `NOT_COVERED` safety gate).
- **Relevant Files / Traces / Tests:**
  - `src/scenario.ts`, `src/passport.ts`, `src/conflict.ts`, `src/policies/*.json`
  - `demo/govaid-atlas-competition-showcase.html`
- **Current Confidence:** **`MEDIUM-HIGH`**
- **Next Action:** Emphasize how `NOT_COVERED` + JSON rule packs allow safe, incremental municipal onboarding without hallucination risk.

---

### Category 6 — 現場展示與答詢 (Live Demo & Q&A Readiness) — **10%**

- **Current Evidence:**
  - **One-Page Stage Runbook (`docs/demo-runbook.md`):** Step-by-step T-30 min checklist, Ollama 60-minute warm-up command, projector viewport verification (`1366×768` and `1920×1080`), keyboard navigation checks, and strict 85-second stage fallback rule.
  - **Offline Showcase & Trace Artifacts:** `demo/govaid-atlas-competition-showcase.html` and `artifacts/traces/trace-a..f.json` provide zero-dependency inspection if venue Wi-Fi or local hardware fails.
  - **Audit-Proof Q&A Documentation:** `docs/gold-standard-review-status.md`, `docs/napai-evaluation-report.md`, and `docs/security-self-assessment.md` prepare the team to answer tough technical/governance questions with full honesty.
- **Missing Evidence:**
  - Public tunnel (`govaid.torchark.tw`) needs owner redeploy to match the latest Wave 2/3 branch (`docs/napai-submission-readiness.md`).
- **Relevant Files / Traces / Tests:**
  - `docs/demo-runbook.md`, `docs/demo-reliability-wave3.md`, `docs/openai-live-validation.md`
  - `demo/govaid-atlas-competition-showcase.html`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Rehearse the 3-minute live flow in `docs/demo-runbook.md` and keep `artifacts/traces/` open for judge Q&A.
