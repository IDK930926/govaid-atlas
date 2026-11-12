# NAPAI 2026 Competition Submission Readiness Matrix

## 1. Status Legend (Strict Allowed Values Only)

- **`READY`**: Complete, verified in repository with concrete evidence, and ready for submission.
- **`PARTIAL`**: Implemented or documented in repository, but requires external human sign-off, redeploy, or packaging step before final submission.
- **`MISSING`**: Not yet present in this branch or not yet executed by human participants.
- **`BLOCKED`**: Blocked by an external dependency or repository-ownership rule (e.g., no tag/push/deploy without owner action).

---

## 2. Final Submission Readiness Table (Gate D Release Candidate)

| # | Item | Status | Evidence Path | Owner / Action Required | Blocker | Ready for Submission? |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Prototype** | `READY` | `src/App.tsx`, `src/server.ts`, `src/agent/orchestrator.ts`, `src/childcare.ts`, `src/navigation.ts`, `dist/` | Verified passing 99/99 automated tests across 10 test suites (`npm test`, `npx tsc --noEmit`, `npm run build`) | None | **YES** |
| 2 | **Source code archive** | `READY` | `artifacts/submission/govaid-atlas-final-source.zip` | Exported cleanly via `git archive` from `release/napai-final-rc`; verified 100% reproducible via clean `npm ci`, test, tsc, and build | None | **YES** |
| 3 | **README** | `README` / `READY` | `README.md` | Fully aligned with multi-domain coverage (Housing + Childcare), Taoyuan intake, arbitrary-case scenario builder, 14-field Human Gate, ApplicationGuide, and honest scope boundaries | None | **YES** |
| 4 | **Architecture** | `READY` | `README.md` (§Architecture), `src/agent/orchestrator.ts`, `src/agent/tools.ts`, `src/status.ts`, `src/coverage.ts` | Bounded Agent + deterministic policy engine architecture with cross-domain tool isolation and 3-tier provider cascade (`AGENT_PROVIDER=auto`) verified | None | **YES** |
| 5 | **Policy evidence** | `READY` | `src/policies/*.json`, `src/evidence.ts`, `docs/wave4-policy-evidence.md`, `docs/final-evidence-manifest.md` | Complete national under-2 childcare rules (`R8` -> `PASS`/`FAIL`/`UNCERTAIN`) and partial rental rules (`R1`, `R6`, `R7`, `R9` -> `PARTIAL_CHECK`); out-of-scope queries return `NOT_COVERED` with official referrals | None | **YES (WITH SCOPE DISCLOSURE)** |
| 6 | **Agent evaluation** | `READY` | `docs/napai-evaluation-report.md`, `src/wave3-agent-eval.ts`, `src/agent/wave3-evaluation.test.ts`, `src/agent/demo-smoke.test.ts` | 99/99 automated tests, 6/6 adversarial attacks blocked, 40/40 repeatability runs, real measured latency/cost documented | None | **YES** |
| 7 | **Trace evidence** | `READY` | `artifacts/traces/trace-a-valid-proposal.json` .. `trace-l-provider-offline-childcare.json`, `docs/trace-evidence-index.md`, `src/agent/trace.ts` | 12 representative traces exported, verified free of secrets, prompts, chain-of-thought, and personal identifiable information | None | **YES** |
| 8 | **Security disclosure** | `READY` | `docs/security-self-assessment.md` | Comprehensive 14-topic security assessment covering 11 allowlisted tools, prompt injection defenses, API hardening, and synthetic RBAC limitation | None | **YES** |
| 9 | **Third-party disclosure** | `READY` | `docs/third-party-resources.md` | OpenAI Responses API endpoint documented; local Ollama `qwen3.5:4b` weights and official policy citations R1–R9 documented | None | **YES** |
| 10 | **Demo runbook** | `READY` | `docs/demo-runbook.md`, `docs/demo-reliability-wave3.md` | Stage live runbook prioritizing OpenAI cloud primary (~5s latency), Ollama 60-min warm standby on local CPU, and deterministic fallback (<0.2s) | Requires OpenAI API key or local Ollama on presentation laptop | **YES** |
| 11 | **Showcase** | `READY` | `demo/govaid-atlas-competition-showcase.html` | Interactive zero-dependency HTML presentation deck aligned with Wave 4 & Gates A–C (Housing, Taoyuan, Childcare, `PARTIAL_CHECK`, and `NOT_COVERED`) | None | **YES** |
| 12 | **Backup video** | `PARTIAL` | `docs/backup-demo-video-status.md`, referenced on historical branch `feat/backup-demo-video` | Historical recording `GovAidAtlas_Final_Backup_Demo.mp4` is classified as **`CURRENT VIDEO: OUTDATED`** (pre-Wave-1 copy). Complete re-recording runbook is prepared in `docs/backup-demo-video-status.md`. | Re-recording requires physical presenter setup | **OUTDATED — RUNBOOK READY** |
| 13 | **Field validation** | `MISSING` | `docs/field-validation-protocol.md`, `docs/field-validation-results-template.md`, `benchmark/manual-results.csv` | Empirical human crossover study status is **`PENDING`** (0 human participant sessions completed). Experimental protocol and recording templates are prepared. | Requires 5–8 human participants | **NO (PROTOCOL & TEMPLATE ONLY)** |
| 14 | **Independent review** | `PARTIAL` | `docs/gold-standard-review-status.md`, `docs/gold-standard-independent-review-template.md`, `benchmark/cases.json` | Benchmark cases B01–B10 status is **`PENDING_INDEPENDENT_REVIEW`**. Review packet is prepared; awaiting external social worker or housing policy reviewer sign-off. | Requires external domain reviewer signature | **YES (AS PENDING INDEPENDENT REVIEW)** |
| 15 | **Production URL** | `PARTIAL` | `https://govaid.torchark.tw/` (referenced in `docs/final-production-deploy-checklist.md`) | Public tunnel currently serves an older pre-Wave-1 build; host operator must deploy `release/napai-final-rc` following `docs/final-production-deploy-checklist.md`. | Requires production server operator action | **REQUIRES OPERATOR REDEPLOY** |
| 16 | **Release/tag** | `BLOCKED` | Commits `956eebc` (Gate A), `10655ff` (Gate B), `223a147` (Gate C), and Gate D on `release/napai-final-rc` | Repository owner must review `release/napai-final-rc` branch, merge to `main`, and create official release tag following `docs/final-owner-handoff.md`. | Blocked by agent governance rule (no tag/push/merge without owner) | **BLOCKED BY REPO GOVERNANCE RULE** |
| 17 | **Slides** | `PARTIAL` | `demo/govaid-atlas-competition-showcase.html` (web deck); external presentation slide deck (`.pptx` / `.pdf`) | Team must confirm external slide file matches verified technical claims (`PARTIAL_CHECK`, `NOT_COVERED`, `PENDING_INDEPENDENT_REVIEW`) prior to presentation. | External slide file is maintained outside git repo | **VERIFY EXTERNALLY** |

---

## 3. Post-Gate D Summary & Submission Package Readiness

- **Gate A (Arbitrary Scenario Intake & Boundary Hardening):** `PASS` (commit `956eebc`)
- **Gate B (Demo UX & Journey/Fallback Boundary Polish):** `PASS` (commit `10655ff`)
- **Gate C (Evidence, Trace & Demo Synchronization):** `PASS` (commit `223a147`)
- **Gate D (Final Release Candidate & Submission Package):** `PASS` (branch `release/napai-final-rc`)
- **Submission Source Archive:** `artifacts/submission/govaid-atlas-final-source.zip` (clean archive, verified reproducible).
- **All Automated Regressions:** **99 / 99 PASS** (10 test suites).
- **Remaining Human-Only Tasks for Competition Submission:**
  1. Human Field Validation study (`docs/field-validation-protocol.md`): `PENDING`.
  2. Domain Expert Sign-Off on Gold Standard (`docs/gold-standard-independent-review-template.md`): `PENDING_INDEPENDENT_REVIEW`.
  3. Re-recording stage backup video (`docs/backup-demo-video-status.md`): `OUTDATED`.
  4. Repository owner merge, release tagging, and server redeploy (`docs/final-owner-handoff.md`, `docs/final-production-deploy-checklist.md`): `OWNER ACTION REQUIRED`.
