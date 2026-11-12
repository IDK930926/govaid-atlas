# GovAid Atlas — Final Technical Evidence Manifest

This document provides a single-point-of-truth index mapping all technical claims, governance guarantees, and competition requirements to concrete, verifiable source code, automated test cases, and exported trace artifacts.

---

## 1. Task Completion & Domain Coverage

| Area | Implementation & Evidence | Verification Tests & Traces |
| :--- | :--- | :--- |
| **Housing Subsidies (Central, Taipei, New Taipei)** | Core statutory rules encoded in `src/policies/central-rent-115.json` (R1), `src/policies/taipei-rent-115.json` (R6), `src/policies/new-taipei-rent-115.json` (R7). Evaluates rent, age, income, ownership, and student/work status without false PASS (`PARTIAL_CHECK`). | `src/rules.test.ts`, `src/agent/wave2-hardening.test.ts`, `TRACE-A`, `DEMO-01` |
| **Taoyuan Central Rental Intake** | Implemented in `src/policies/taoyuan-rent-115.json` (R9), `src/coverage.ts` (`COVERED_CENTRAL_NAVIGATION_CITIES`), enforcing Taoyuan income cap (NT$50,304) and NLMA online intake navigation. | `TAO-01`, `TAO-02`, `TRACE-H`, `DEMO-02` in `src/agent/wave4-product.test.ts` & `src/agent/demo-smoke.test.ts` |
| **Childcare Under-2 Allowance** | Complete national rules in `src/policies/childcare-allowance-115.json` (R8), `src/childcare.ts`. Evaluates age (< 24 months), birth registration, placement exclusions, public childcare exclusions, and birth-order tiers (NT$5,000 / 6,000 / 7,000). | `CHILD-01`..`CHILD-05`, `TRACE-G`, `DEMO-03` |
| **Arbitrary Scenario Intake (Gate A)** | Dynamic user-specified profile parsing and scenario generation in `src/case-input.ts`, replacing fixed Golden Persona constraints. | `CUSTOM-HOUSING-01`..`03`, `CUSTOM-CHILD-01`..`02`, `TRACE-I`, `TRACE-J` in `src/agent/arbitrary-case.test.ts` |
| **Human Gate Interaction** | Active missing-field clarification in `src/agent/missing-fields.ts` across 14 supported attributes. System pauses (`WAITING_FOR_HUMAN`) and resumes only upon validated citizen input. | `CUSTOM-MISSING-01`..`02`, `HUMAN-GATE-ALL-FIELDS`, `TRACE-B`, `DEMO-04` |
| **Actionable ApplicationGuide & Passport** | Complete statutory application guide in `src/navigation.ts`, `src/passport.ts` with required document checklists, administering agency contacts, valid dates, and official URLs (`https://has.nlma.gov.tw/`, `https://twbaby.sfaa.gov.tw/`). | `NAV-01`, `NAV-02`, `TRACE-A`, `TRACE-G`, `TRACE-H` |

---

## 2. Agentic Technical Depth & Appropriateness

| Capability | Implementation & Mechanism | Verifiable Artifacts |
| :--- | :--- | :--- |
| **Bounded Stateful Tool Routing** | Planner proposals dynamically route tool execution (`executeBoundedSteps` in `src/agent/orchestrator.ts`) across 11 allowlisted tools while keeping LLMs strictly out of eligibility arithmetic. | `TRACE-A`, `TRACE-G`, `A1`–`A10`, `benchmark/results-wave2-agent.csv` |
| **Dynamic Missing-Field Detection** | Scans 14 attributes in `detectMissingFields` (`src/agent/missing-fields.ts`), generating structured questions rather than guessing unconfirmed facts. | `src/agent/missing-fields.ts`, `TRACE-B`, `CUSTOM-MISSING-01` |
| **Invalid Tool & Loop Rejection** | 3-layer validation (`validatePlannerProposal`) rejects unallowlisted tools, duplicate tool loops without state change, and premature `COMPLETE`. | `TRACE-C`, `ADV-2`, `ADV-6`, `DEMO-07` |
| **Stateful Resume Protocol** | Validates structured citizen input via `validateMissingFieldInput`, updates state transitions (`beforeState`/`afterState`), and resumes execution. | `TRACE-B`, `A3`, `A10`, `DEMO-04` |
| **3-Tier Provider Cascade & Fallback** | Automatic cascade in `src/agent/client.ts` (`AGENT_PROVIDER=auto`): OpenAI Cloud primary (`/v1/responses`, ~5 s) → Local Ollama fallback (`qwen3.5:4b`) → Deterministic safe fallback (< 0.2 s). | `TRACE-F`, `TRACE-L`, `P1`–`P12`, `DEMO-06`, `docs/openai-live-validation.md` |

---

## 3. Safety, Controllability & Governance

| Protection | Implementation & Safeguard | Verifiable Proof |
| :--- | :--- | :--- |
| **False `PASS` Prevention** | Strict status precedence (`FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`) in `src/status.ts`. Rental rules output `PARTIAL_CHECK` (never full `PASS`). | `CASE A`..`CASE F` in `src/correctness-boundary.test.ts`, `TRACE-D`, `TRACE-E` |
| **Policy Validity & Expiration** | Enforces `validFrom` and `validTo` date windows in `src/rules.ts` (`evaluatePolicyValidity`). Expired policies return `FAIL` and mark guides `CLOSED`. | `Policy Validity & Expiration` in `src/agent/wave4-product.test.ts` |
| **Cross-Domain Tool Isolation** | Enforces domain separation: housing tools cannot run on childcare queries; childcare tools cannot run on housing queries (`src/agent/orchestrator.ts`). | `Domain Isolation` in `src/agent/wave4-product.test.ts`, `DOMAIN-ISOLATION` |
| **API & Server Hardening** | `src/server.ts`: 16 KB body limit (`HTTP 413`), 800-character goal limit (`HTTP 400`), rate limiting 20 req/60s (`HTTP 429`), 15s provider timeout. | `API Hardening` suite in `src/agent/wave3-evaluation.test.ts` |
| **Sanitized Trace Export** | `sanitizeForTrace` (`src/agent/trace.ts`) strips API keys, Bearer tokens, system prompts, chain-of-thought, and PII before serialization. | `artifacts/traces/trace-a..l.json` (12 traces), `ADV-5`, `docs/trace-evidence-index.md` |
| **Boundary Protection & Referrals** | Unsupported queries (e.g., 托育補助, 臺中市) return `NOT_COVERED` with official agency referral links (`run.coverage.officialReferrals`). | `REFERRAL-01`..`03`, `TRACE-K`, `DEMO-05` |

---

## 4. Evaluation & Verification

| Evaluation Suite | Results & Metrics | Documentation & Data |
| :--- | :--- | :--- |
| **Automated Regression Suite** | **99 / 99 automated tests PASS** across 10 test suites (`npm test`, `npx tsc --noEmit`, `npm run build`). | `src/**/*.test.ts`, `docs/napai-evaluation-report.md` |
| **Adversarial Safety Suite** | **6 / 6 (100%)** prompt-injection and adversarial attacks blocked (`ADV-1`..`ADV-6`). | `benchmark/results-wave2-agent.csv`, `src/agent/wave3-evaluation.test.ts` |
| **Exported Trace Suite** | **12 / 12** sanitized traces (`TRACE-A` through `TRACE-L`) covering normal, edge-case, adversarial, and fallback execution. | `artifacts/traces/*.json`, `docs/trace-evidence-index.md` |
| **Benchmark Gold Standard** | `benchmark/cases.json` (`B01`–`B10`) status is **`PENDING_INDEPENDENT_REVIEW`**. Unchanged from `main`. | `benchmark/cases.json`, `docs/gold-standard-review-status.md` |
| **Comparative Baseline Proof** | GovAid Atlas achieves **0% Unsafe Certainty** compared to **40% Unsafe Certainty** on raw `LLM_CONTEXT` (`qwen3.5:4b`). | `benchmark/results.csv`, `docs/benchmark-methodology.md` |

---

## 5. Field Validation Status

- **Empirical Human Study Status:** **`PENDING`** (Zero human participant test sessions have been conducted).
- **Experimental Protocol:** Complete and audit-ready in `docs/field-validation-protocol.md` (counterbalanced crossover study comparing official PDF/web vs. GovAid Atlas on personas S1/S2).
- **Recording Templates:** Prepared and audit-ready in `docs/field-validation-results-template.md`, `benchmark/manual-results.csv`, and `benchmark/manual-scoring-sheet.csv`.
- **Integrity Rule:** No empirical human participant scores, completion times, or SUS ratings are fabricated.
