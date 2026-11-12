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
    - `92 / 92` automated tests passing across 9 test suites (`npm test`), including Wave 4 product completion (`CHILD-01`..`CHILD-05`, `TAO-01`..`TAO-02`, `NAV-01`..`NAV-02`, policy validity/expiration, and domain isolation), Gate A arbitrary cases (`ARBITRARY-RENT-01`..`03`, `ARBITRARY-CHILD-01`..`02`), and Gate B demo UX / domain fallback (`FALLBACK-HOUSING-01`, `FALLBACK-CHILD-01`, `FALLBACK-UNKNOWN-01`, `TRACE-G`..`TRACE-L`), plus zero TypeScript errors (`npx tsc --noEmit`) and clean production build (`vite build`).
    - `8 / 8` (**100%**) technical task completion across core Agent categories `CAT-A`..`CAT-H` (`benchmark/results-wave2-agent.csv`), with `40 / 40` (**100%**) repeatability across 5 repeated runs per category (`src/wave3-agent-eval.ts`).
    - `12 / 12` (**100%**) pass rate on the deterministic regression suite (`src/benchmark.ts`).
  - **Live LLM Stability & 3-Tier Fallback Proofs:**
    - `5 / 5` consecutive Golden Path completions on local Ollama CPU (`qwen3.5:4b`, steady-state planner latency `61.0–63.8 s`, post-gate resume `≤ 0.34 s`, `docs/demo-reliability-wave3.md`).
    - `5 / 5` Golden Path completions on OpenAI Cloud (`gpt-5.4-mini`, median planner latency `5.1 s`, `docs/openai-live-validation.md`).
    - Verified domain-aware graceful degradation when LLM provider is offline or times out (`TRACE-F`, `TRACE-L`, `CAT-G`, `docs/demo-reliability-wave3.md` §3).
- **Missing Evidence:**
  - Live multi-turn latency benchmarks across all 8 Wave 2 categories (`CAT-A`..`CAT-H`) against live cloud/local LLM endpoints (current `CAT-A`..`CAT-H` batch uses deterministic/scripted provider responses for fast, reproducible CI verification).
  - Expanded statutory rules beyond the implemented rule subsets per program (`R1`, `R6`, `R7`, `R8`, `R9`).
- **Relevant Files / Traces / Tests:**
  - `src/rules.ts`, `src/scenario.ts`, `src/status.ts`, `src/coverage.ts`, `src/passport.ts`, `src/childcare.ts`, `src/navigation.ts`
  - `src/correctness-boundary.test.ts`, `src/agent/wave3-evaluation.test.ts`, `src/agent/wave4-product.test.ts`, `src/agent/wave4-demo-ux.test.ts`
  - `benchmark/results-wave2-agent.csv`, `docs/napai-evaluation-report.md`, `docs/demo-reliability-wave3.md`, `docs/openai-live-validation.md`
  - `artifacts/traces/trace-a-valid-proposal.json` through `artifacts/traces/trace-l-provider-offline-childcare.json` (12 traces)
- **Current Confidence:** **`HIGH`** (for P0 scope & technical stability)
- **Next Action:** Highlight the 92/92 automated test suite and 12 exported traces during technical review.

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
  - **True Bounded Stateful Tool Routing (`executeBoundedSteps` in `src/agent/orchestrator.ts`):** Planner proposals genuinely control which allowlisted tool executes (`TRACE-A`, `TRACE-G`, `TRACE-H`), replacing the pre-Wave-2 fixed sequence while keeping the LLM strictly out of eligibility calculation.
  - **Dynamic Missing-Field Detection & 14-Field Stateful Resume (`src/agent/missing-fields.ts`):** Detects missing fields across 14 supported attributes across Housing (`city`, `ownsHome`, `receivesOtherHousingAid`, `monthlyIncome`, `age`, `centralRentApproved`, `newTaipeiResidenceStudyWork`, `registeredCity`) and Childcare (`childAgeMonths`, `childHasBirthOrInitialHouseholdRegistration`, `receivesPublicOrQuasiPublicChildcare`, `isGovernmentPlaced`, `birthOrder`), asks field-specific questions, validates user responses (`validateMissingFieldInput`), records `beforeState`/`afterState` transitions, and resumes execution (`TRACE-B`).
  - **Arbitrary Scenario Intake & Custom Case Support (Gate A):** Extends Agent evaluation beyond static Golden Personas to dynamic user-specified applicants and relocations (`TRACE-I`, `TRACE-J`).
  - **Domain-Aware Fallback Routing (Gate B):** Implements domain detection during provider outage so fallback proposals route directly to domain-appropriate tools (`evaluate_childcare_rules` for childcare vs `evaluate_central_rules` for housing; `TRACE-L`).
  - **Comparative Baseline Proof (`benchmark/results.csv`):** Demonstrates why an Agentic + Deterministic architecture is superior to raw `LLM_CONTEXT` (`qwen3.5:4b` alone had `40%` Unsafe Certainty on safety-critical cases `B06`/`B08` and `30%` Unsupported Claims on `B01`/`B07`/`B09`, compared to `0%` Unsafe Certainty for GovAid Atlas).
- **Missing Evidence:**
  - Multi-step natural-language slot extraction directly from free-form user replies (current resume path validates structured field values).
- **Relevant Files / Traces / Tests:**
  - `src/agent/orchestrator.ts`, `src/agent/missing-fields.ts`, `src/agent/tools.ts`, `src/agent/types.ts`
  - `src/agent/providers/ollama.ts`, `src/agent/providers/openai.ts`, `src/agent/client.ts`
  - `artifacts/traces/trace-a-valid-proposal.json`, `artifacts/traces/trace-b-missing-field-resume.json`, `artifacts/traces/trace-g-childcare-supported.json`, `artifacts/traces/trace-h-taoyuan-navigation.json`, `artifacts/traces/trace-i-custom-housing.json`, `artifacts/traces/trace-j-custom-childcare.json`, `artifacts/traces/trace-l-provider-offline-childcare.json`
  - `src/agent/wave2-hardening.test.ts`, `src/agent/wave4-demo-ux.test.ts`, `benchmark/results.csv`, `docs/benchmark-methodology.md`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Highlight `TRACE-A` (dynamic tool routing), `TRACE-B` (human gate resume), and `TRACE-L` (domain-aware fallback) during technical Q&A.

---

### Category 4 — 安全、可控性與治理 (Safety, Controllability & Governance) — **15%**

- **Current Evidence:**
  - **3-Layer Proposal Validation (`validatePlannerProposal`):** Blocks malformed JSON (`SCHEMA_VALIDATION`), unallowlisted tools across 11 allowlisted tools (`ALLOWLIST_VALIDATION`, `TRACE-C`), premature `COMPLETE`, duplicate tool loops (`DUPLICATE_TOOL_CALL_WITHOUT_STATE_CHANGE`), cross-domain violations, and profile/status override attempts (`STATE_TRANSITION_VALIDATION`, `TRACE-E`).
  - **Prompt Injection & Adversarial Safety Suite (`ADV-1`..`ADV-6`):** `6 / 6` (**100%**) adversarial attacks blocked (`src/wave3-agent-eval.ts`, `src/agent/wave3-evaluation.test.ts`).
  - **Coverage Boundary & Official Referral Cards (`NOT_COVERED`):** Blocks out-of-scope childcare queries (`托育補助`) and uncovered municipalities (`臺中市`) from ever producing a false `PASS` (`TRACE-D`, `TRACE-K`), displaying clear explanations and trusted official outbound links (`run.coverage.officialReferrals`).
  - **API Hardening (`src/server.ts`):** `16 KB` body limit (`HTTP 413`), `800-char` goal limit (`HTTP 400`), `20 req / 60s` rate limiter (`HTTP 429`), and `15s` provider timeout (`AGENT_PROVIDER_TIMEOUT`).
  - **Sanitized Trace Export (`src/agent/trace.ts`):** Redacts API keys, tokens, system prompts, chain-of-thought, and PII across all 12 traces (`docs/trace-evidence-index.md`).
  - **Honest Security & Third-Party Disclosures:** `docs/security-self-assessment.md` (explicitly disclosing synthetic RBAC limitation) and `docs/third-party-resources.md`.
- **Missing Evidence:**
  - Production authentication/RBAC backend (not in P0 scope; explicitly disclosed).
- **Relevant Files / Traces / Tests:**
  - `src/agent/orchestrator.ts`, `src/agent/trace.ts`, `src/server.ts`, `src/coverage.ts`, `src/status.ts`
  - `artifacts/traces/trace-c-rejected-proposal.json`, `artifacts/traces/trace-d-not-covered.json`, `artifacts/traces/trace-e-deterministic-fail.json`, `artifacts/traces/trace-k-not-covered-referral.json`
  - `docs/security-self-assessment.md`, `docs/third-party-resources.md`, `docs/gold-standard-review-status.md`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Present the 3-layer validation gate, `TRACE-C`/`TRACE-E`, and `TRACE-K` as primary governance artifacts.

---

### Category 5 — 創新與擴散價值 (Innovation & Scalability / Diffusion Value) — **10%**

- **Current Evidence:**
  - **Multi-Domain Expansion (`HOUSING` + `CHILDCARE` in Wave 4):** Demonstrates that the bounded Agent + deterministic policy engine architecture scales cleanly across both municipal housing subsidies (`CENTRAL_RENT_115`, `TAIPEI_RENT_115`, `NEW_TAIPEI_RENT_115`, `TAOYUAN_CENTRAL_RENT_115`) and national family welfare (`CHILDCARE_ALLOWANCE_UNDER_2_115` with birth-order benefit tiers NT$5,000 / 6,000 / 7,000) with strict cross-domain tool isolation.
  - **Arbitrary Scenario Intake (Gate A):** Extends citizen input to arbitrary housing and childcare parameters with full type-safe scenario generation.
  - **Actual vs. What-If Relocation Comparison (`src/scenario.ts`):** Allows renters to compare how moving across municipal boundaries (e.g., New Taipei Yonghe vs. Taipei Wenshan) affects combined central + local subsidy eligibility before signing a lease.
  - **Actionable Application Navigation & Decision Passport (`src/navigation.ts`, `src/passport.ts`):** Translates rule evaluations and official citations (`R1`, `R6`, `R7`, `R8`, `R9`) into a concrete citizen application guide with required documents, online portal URLs (`https://twbaby.sfaa.gov.tw/`, `https://has.nlma.gov.tw/subsidyOnline/`), administering agencies, validity/expiration checks (`validFrom`/`validTo`), and next steps.
  - **Pluggable Policy & 3-Tier Provider Architecture:** JSON-declarative policy rules (`src/policies/*.json`) + `AGENT_PROVIDER=auto` (OpenAI `gpt-5.4-mini` primary with automatic Ollama fallback and deterministic rule fallback) enable safe expansion without hallucination risk.
- **Missing Evidence:**
  - Additional municipalities beyond Taipei, New Taipei, and Taoyuan (`臺中市`, `高雄市`, etc.) or additional childcare programs (`托育補助`) remain bounded by `NOT_COVERED`.
- **Relevant Files / Traces / Tests:**
  - `src/childcare.ts`, `src/navigation.ts`, `src/scenario.ts`, `src/passport.ts`, `src/conflict.ts`, `src/policies/*.json`
  - `src/agent/wave4-product.test.ts`, `src/agent/wave4-demo-ux.test.ts`, `docs/wave4-policy-evidence.md`
  - `demo/govaid-atlas-competition-showcase.html`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Emphasize how `NOT_COVERED` + JSON rule packs allow safe, incremental municipal onboarding without hallucination risk.

---

### Category 6 — 現場展示與答詢 (Live Demo & Q&A Readiness) — **10%**

- **Current Evidence:**
  - **Stage Live Runbook (`docs/demo-runbook.md`):** Rehearsed 3-minute stage live flow prioritizing fast OpenAI Cloud primary (~5s latency), Ollama 60-minute warm standby on local CPU, and instantaneous deterministic fallback (<0.2s). Includes T-30 min checklist and projector viewport verification (`1366×768` and `1920×1080`).
  - **Childcare JourneyStepper & Domain UX Polish (Gate B):** Domain-specific stepper visualization ensures completed childcare runs cleanly reach 100% completion without housing tool mismatch.
  - **Offline Showcase & 12 Trace Artifacts:** `demo/govaid-atlas-competition-showcase.html` and `artifacts/traces/trace-a..l.json` provide zero-dependency inspection if venue Wi-Fi or local hardware fails.
  - **Clear Backup Video Classification (`docs/backup-demo-video-status.md`):** Honestly classifies historical pre-Wave-1 video as `OUTDATED` and provides a complete re-recording specification.
  - **Audit-Proof Q&A Documentation:** `docs/gold-standard-review-status.md`, `docs/napai-evaluation-report.md`, and `docs/security-self-assessment.md` prepare the team to answer tough technical/governance questions with full honesty.
- **Missing Evidence:**
  - Public tunnel (`govaid.torchark.tw`) needs owner redeploy to match the latest Wave 2/3 branch (`docs/napai-submission-readiness.md`).
- **Relevant Files / Traces / Tests:**
  - `docs/demo-runbook.md`, `docs/demo-reliability-wave3.md`, `docs/openai-live-validation.md`, `docs/backup-demo-video-status.md`
  - `demo/govaid-atlas-competition-showcase.html`, `artifacts/traces/trace-a..l.json`
- **Current Confidence:** **`HIGH`**
- **Next Action:** Rehearse the 3-minute live flow in `docs/demo-runbook.md` and keep `artifacts/traces/` open for judge Q&A.
