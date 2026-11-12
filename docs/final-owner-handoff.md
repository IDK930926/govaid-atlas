# GovAid Atlas — Final Repository Owner Handoff Document

> [!IMPORTANT]
> **OWNER ACTION REQUIRED:**  
> The AI Agent operates under strict non-destructive governance constraints: it cannot merge into `main`, cannot create git tags, cannot push to remote remotes, and cannot deploy to external servers. This document provides the repository owner with the complete commit history, release candidate status, submission archive, and step-by-step instructions for final sign-off, merge, and tagging.

---

## 1. Final Release Candidate Identity

- **Final RC Branch:** `release/napai-final-rc`
- **Base Commit (from Gate C):** `223a147`
- **Gate D Final RC Commit:** Target commit on `release/napai-final-rc` (verify via `git log -1`)
- **Clean Submission Archive:** `artifacts/submission/govaid-atlas-final-source.zip` (verified 100% reproducible)
- **Regression Baseline:** **99 / 99 automated tests PASS** across 10 test suites, 0 TypeScript errors, clean build

---

## 2. Commit Chain: Wave 1 → Gate D

The complete progression of verified milestone commits leading to the Final RC:

| Milestone | Commit | Branch / Source | Description |
| :--- | :--- | :--- | :--- |
| **Wave 1** | `c05af4e` | `fix/napai-correctness-boundary` | Hardened legal truthfulness; changed unconditional rental PASS to `PARTIAL_CHECK`. |
| **Wave 2** | `be8da70` | `feat/napai-agent-hardening` | Bounded dynamic tool routing, dynamic missing fields, and 3-layer validation gate. |
| **Wave 3** | `94a9a97` | `fix/napai-openai-provider-integration` | 3-tier provider cascade with OpenAI `gpt-5.4-mini` Responses API and auto fallback. |
| **Wave 4** | `effa37f` | `feat/napai-product-completion` | Multi-domain expansion: Childcare Under-2 Allowance (R8), Taoyuan central rent (R9), and `ApplicationGuide`. |
| **Gate A** | `956eebc` | `fix/napai-arbitrary-case-ui` | Arbitrary custom applicant scenario builder and 14-field Human Gate. |
| **Gate B** | `10655ff` | `fix/napai-demo-ux` | Childcare JourneyStepper polish, `NOT_COVERED` official referrals, domain-aware fallback. |
| **Gate C** | `223a147` | `docs/napai-final-evidence-sync` | Documentation, 12 exported traces (`TRACE-A`..`TRACE-L`), and demo runbook synchronization. |
| **Gate D** | *(This Commit)* | `release/napai-final-rc` | Final Release Candidate, submission source archive, demo smoke harness (`DEMO-01`..`07`). |

---

## 3. Recommended PR & Merge Order for Owner

To merge into `main` cleanly without conflict:

```bash
# 1. Inspect the branch on your local workstation
git fetch origin
git checkout release/napai-final-rc

# 2. Run full regression suite
npm test
npx tsc --noEmit
npm run build

# 3. Create Pull Request from release/napai-final-rc into main
# (Title: "release: GovAid Atlas NAPAI 2026 Final Release Candidate")

# 4. Fast-forward or squash merge into main
git checkout main
git merge --ff-only release/napai-final-rc

# 5. Tag official release
git tag -a v1.0.0-rc-final -m "GovAid Atlas NAPAI 2026 Final Release Candidate"
git push origin main --tags
```

---

## 4. Production Deployment Target

For updating the public demo instance at `https://govaid.torchark.tw/`:

Follow the step-by-step instructions in [docs/final-production-deploy-checklist.md](file:///C:/Projects/govaid-atlas/docs/final-production-deploy-checklist.md).
- Target commit: Head of `release/napai-final-rc`
- Environment: `AGENT_PROVIDER=auto`, `OPENAI_MODEL=gpt-5.4-mini`, local Ollama standby
- Restart server: `PORT=8787`

---

## 5. Remaining Human-Only Blockers for Official Submission

The following items are outside the authority of any AI agent and require human action before uploading to the competition portal:

1. **Human Participant Field Validation Study (`MISSING` / `PENDING`):**
   - Conduct 5–8 participant crossover evaluation using `docs/field-validation-protocol.md`.
   - Record actual completion times, error counts, and SUS ratings into `docs/field-validation-results-template.md`.
2. **Domain Expert Independent Review (`PARTIAL` / `PENDING_INDEPENDENT_REVIEW`):**
   - Obtain formal signature on `docs/gold-standard-independent-review-template.md` from an independent social worker or housing policy specialist.
3. **Stage Backup Video Re-Recording (`PARTIAL` / `OUTDATED`):**
   - The historical MP4 is classified as `OUTDATED` (pre-Wave-1 copy).
   - Re-record using the exact script and screen setup in `docs/backup-demo-video-status.md` if stage backup video is required.
4. **Anonymized Submission Archive Upload:**
   - Use the verified clean archive: `artifacts/submission/govaid-atlas-final-source.zip`.
