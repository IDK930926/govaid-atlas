# NAPAI 2026 Competition Submission Readiness Matrix

## 1. Status Legend (Strict Allowed Values Only)

- **`READY`**: Complete, verified in repository with concrete evidence, and ready for submission.
- **`PARTIAL`**: Implemented or documented in repository, but requires external human sign-off, redeploy, or packaging step before final submission.
- **`MISSING`**: Not yet present in this branch or not yet executed by human participants.
- **`BLOCKED`**: Blocked by an external dependency or repository-ownership rule (e.g., no tag/push/deploy without owner action).
- **`UNKNOWN`**: External deliverable outside repository scope whose current completion state is unknown from the codebase.

---

## 2. Submission Readiness Table

| Item | Status | Evidence Path | Owner / Action Required | Blocker | Ready for Submission? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Prototype** | `READY` | `src/App.tsx`, `src/server.ts`, `src/agent/orchestrator.ts`, `src/childcare.ts`, `src/navigation.ts`, `dist/` | None for code; builds and passes 92/92 automated tests across 9 test suites (`npm test`, `npx tsc --noEmit`, `npm run build`) | None | **YES** |
| **Source code package** | `PARTIAL` | Working tree on branch `docs/napai-final-evidence-sync` | Export clean `.zip` archive via `git archive` (excluding `.git/` history) before uploading to competition portal | Git commit metadata in `.git/` contains author identities | **AFTER CLEAN ARCHIVE EXPORT** |
| **README** | `READY` | `README.md` | Fully aligned with `HOUSING` (Taipei, New Taipei, Taoyuan) + `CHILDCARE` (Under-2 Allowance), arbitrary-case scenario builder, 14-field Human Gate, `ApplicationGuide`, `PARTIAL_CHECK`, and `NOT_COVERED` with official referrals | None | **YES** |
| **Architecture** | `READY` | `README.md` (§Architecture), `src/agent/orchestrator.ts`, `src/agent/tools.ts`, `src/status.ts`, `src/coverage.ts` | None; bounded Agent + deterministic policy engine architecture with cross-domain tool isolation and 3-tier provider cascade (`AGENT_PROVIDER=auto`) is implemented and tested | None | **YES** |
| **Policy data** | `READY` | `src/policies/central-rent-115.json`, `src/policies/taipei-rent-115.json`, `src/policies/new-taipei-rent-115.json`, `src/policies/taoyuan-rent-115.json`, `src/policies/childcare-allowance-115.json`, `src/evidence.ts`, `docs/wave4-policy-evidence.md` | Complete national under-2 childcare rules (`R8` -> `PASS`/`FAIL`/`UNCERTAIN`) and partial rental rules for Central (`R1`), Taipei (`R6`), New Taipei (`R7`), and Taoyuan (`R9` -> `PARTIAL_CHECK`/`FAIL`/`UNCERTAIN`); out-of-scope programs return `NOT_COVERED` | Rental rules encode partial conditions (`PARTIAL_CHECK`); explicitly disclosed | **YES (WITH SCOPE DISCLOSURE)** |
| **Benchmark** | `PARTIAL` | `benchmark/cases.json`, `benchmark/results.csv`, `benchmark/results-wave2-agent.csv`, `docs/gold-standard-review-status.md`, `docs/gold-standard-independent-review-template.md`, `docs/benchmark-methodology.md` | Technical regression (`12/12` & `8/8` Wave 2 Agent) and `LLM_CONTEXT` (`10/10`) are complete; `B01`–`B10` Gold Standard awaits external domain reviewer sign-off (`PENDING_INDEPENDENT_REVIEW`) and `MANUAL` baseline rows are blank (`NOT_MEASURED`) | No independent external reviewer has signed `docs/gold-standard-independent-review-template.md` yet | **YES (AS TECHNICAL REGRESSION + PENDING INDEPENDENT REVIEW)** |
| **Evaluation report** | `READY` | `docs/napai-evaluation-report.md`, `src/wave3-agent-eval.ts`, `src/agent/wave3-evaluation.test.ts`, `src/agent/wave4-product.test.ts`, `src/agent/wave4-demo-ux.test.ts` | None; reports real measured metrics, 92/92 automated regression status, repeatability, latency, cost, reliability, adversarial safety, and `NOT_MEASURED` items truthfully | None | **YES** |
| **Trace evidence** | `READY` | `artifacts/traces/trace-a-valid-proposal.json` .. `trace-l-provider-offline-childcare.json`, `docs/trace-evidence-index.md`, `src/agent/trace.ts` | None; 12 representative traces exported and verified free of secrets, prompts, chain-of-thought, and PII | None | **YES** |
| **Field validation** | `MISSING` | `docs/field-validation-protocol.md`, `docs/field-validation-results-template.md`, `benchmark/manual-results.csv` | Conduct 5–8 real human crossover sessions using `docs/field-validation-protocol.md` and record real numbers in `docs/field-validation-results-template.md` | Zero real human participants have completed the study yet (`PENDING`) | **NO (PROTOCOL & TEMPLATE ONLY)** |
| **Slides** | `UNKNOWN` | Not tracked in repository (`demo/govaid-atlas-competition-showcase.html` provides web presentation deck) | Team must verify external presentation slide deck (`.pptx` / `.pdf`) matches Wave 1–4 technical claims (`PARTIAL_CHECK`, `NOT_COVERED`, `PENDING_INDEPENDENT_REVIEW`) | External slide file is not stored in git repository | **VERIFY EXTERNALLY** |
| **Demo video** | `PARTIAL` | `docs/backup-demo-video-status.md`, referenced on historical branch `feat/backup-demo-video` | Existing video is classified as **`CURRENT VIDEO: OUTDATED`** (pre-Wave-1 copy, lacks Childcare/Taoyuan/ApplicationGuide/arbitrary cases). Re-record using `docs/backup-demo-video-status.md` if stage backup video is needed. | `demo-video/` is stored on local branch `feat/backup-demo-video`, not updated to Wave 4 | **OUTDATED — RE-RECORDING CHECKLIST READY** |
| **Third-party disclosure** | `READY` | `docs/third-party-resources.md` | OpenAI Responses API endpoint documented; Qwen `qwen3.5:4b` weights and official policy citations R1–R9 documented | External license terms marked `UNKNOWN — VERIFY BEFORE SUBMISSION` | **YES** |
| **Security self-assessment** | `READY` | `docs/security-self-assessment.md` | None; covers all 14 required security/governance topics, 11 allowlisted tools, and explicitly discloses synthetic RBAC limitation | None | **YES** |
| **Demo requirements** | `READY` | `docs/demo-runbook.md`, `docs/demo-reliability-wave3.md` | Follow stage runbook (OpenAI cloud primary ~5s latency, Ollama 60-minute warm-up standby, `127.0.0.1:8787` single-origin server) | Requires local Ollama (`qwen3.5:4b`) or OpenAI API key on presentation laptop for live LLM planning | **YES** |
| **Anonymized package** | `PARTIAL` | `docs/anonymization-audit.md`, `docs/final-anonymity-audit.md` | Export repository via `git archive` (stripping `.git/` logs) and optionally redact `govaid.torchark.tw` in `demo/govaid-atlas-competition-showcase.html` if blind review prohibits custom domains | `.git/` commit log contains contributor names/emails/GitHub handles | **AFTER ARCHIVE EXPORT** |
| **Final version/tag** | `BLOCKED` | Local commits `956eebc` (Gate A), `10655ff` (Gate B), and Gate C commit on `docs/napai-final-evidence-sync` | Repository owner must review branch `docs/napai-final-evidence-sync`, merge if approved, and create official release/tag | Agent is strictly prohibited from creating git tags, merging, or pushing without explicit owner instruction | **BLOCKED BY REPO GOVERNANCE RULE** |
| **Production URL** | `PARTIAL` | `https://govaid.torchark.tw/` (referenced in `docs/demo-reliability-wave3.md` §7) | Tunnel host owner must redeploy from the latest verified branch if judges will access the public URL | Public tunnel currently serves an older pre-Wave-1 build; agent is prohibited from deploying | **REQUIRES OWNER REDEPLOY** |

---

## 3. Post-Gate C Status & Progression

- **Gate A (Arbitrary Cases & Boundary Hardening):** `PASS` (commit `956eebc`)
- **Gate B (Demo UX & Journey/Fallback Boundary Polish):** `PASS` (commit `10655ff`)
- **Gate C (Evidence, Trace & Demo Synchronization):** `PASS` (current branch `docs/napai-final-evidence-sync`)
- **Pending Deliverables Prior to Competition Submission:**
  1. Export clean source archive via `git archive --format=zip` (stripping git author history for double-blind judging).
  2. Optional human field validation study execution (`docs/field-validation-protocol.md`).
  3. Optional independent domain expert review sign-off (`docs/gold-standard-independent-review-template.md`).
  4. Optional re-recording of backup demo video following `docs/backup-demo-video-status.md`.
  5. Repository owner merge and release tagging (blocked by agent governance rule).
