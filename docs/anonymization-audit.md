# Anonymous Submission & Secret Audit Report (Wave 3)

## 1. Audit Scope & Methodology

This audit inspected:
1. **All tracked source, configuration, benchmark, and documentation files** (`src/`, `benchmark/`, `docs/`, `artifacts/traces/`, `demo/`, `README.md`, `package.json`, `index.html`, `.env.example`).
2. **All generated Wave 2 / Wave 3 evaluation files** (`artifacts/traces/trace-a..f.json`, `benchmark/results-wave2-agent.csv`).
3. **Git repository metadata** (`.git/config` remote URLs and `git log` commit author names, email addresses, and merge commit messages).

Search categories covered:
- School / university names or logos (`大學`, `university`, `.edu.tw`)
- Professor / advisor names (`教授`, `指導老師`, `professor`, `advisor`)
- Team member full names (Chinese and romanized)
- Personal email addresses (`@gmail.com`, `@users.noreply.github.com`, etc.)
- Student IDs
- Local machine paths and Windows usernames (`C:\Users\...`, `/Users/...`, `AppData`)
- API keys, bearer tokens, and Cloudflare tunnel tokens (`sk-...`, `Bearer ...`, `eyJ...`, `OPENAI_API_KEY`)
- Custom domains / private URLs (`govaid.torchark.tw`, GitHub repo URLs)

> **Strict Git History Rule:** In accordance with Wave 3 instructions, **git history was NOT rewritten**. All remediation steps below use non-destructive packaging (`git archive`) or content redaction.

---

## 2. Findings Table

| # | Issue Description | File / Location | Severity | Recommended Action |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Git commit history & remote config contain contributor identities** (Author names, `@users.noreply.github.com` emails, and GitHub handle `IDK930926` in merge commit `911d221` and `.git/config` remote URL). | `.git/logs/`, `.git/config`, `git log` history (not in working tree files) | **HIGH (if submitting `.git` folder to blind review)** | **Do NOT rewrite git history.** When packaging source code for anonymous competition submission, export a clean working-tree archive without `.git` using: `git archive --format=zip HEAD -o govaid-atlas-submission.zip`. |
| **2** | **Custom public demo domain (`govaid.torchark.tw`) appears in showcase HTML and reliability docs.** If `torchark.tw` is publicly associated with a team member's personal portfolio or WHOIS record, it could indirectly identify the team under strict double-blind rules. | `demo/govaid-atlas-competition-showcase.html` (line 885), `docs/demo-reliability-wave3.md` (line 118), `docs/final-anonymity-audit.md` (line 30) | **LOW / MEDIUM (depends on competition blind-review policy)** | Verify whether NAPAI 2026 finals require blind domain redaction. If blind review applies, replace `govaid.torchark.tw` with `<PUBLIC_DEMO_DOMAIN>` in the exported zip copy. |
| **3** | **Synthetic dummy API keys/tokens in unit tests** (`sk-1234567890abcdef123456` and `Bearer secret-jwt-token` / `Bearer secret-token-xyz`). These are synthetic test fixtures used to verify that `sanitizeForTrace` strips secrets from traces. | `src/agent/wave2-hardening.test.ts` (lines 418–424), `src/wave3-agent-eval.ts` (lines 641–648) | **INFORMATIONAL (Safe — not real keys)** | None required. Clearly labeled as synthetic unit-test fixtures; no real credentials exist in HEAD or git history. |
| **4** | **School name, professor name, student ID, personal email, and Windows username in tracked files** | All tracked files (`src/`, `docs/`, `benchmark/`, `artifacts/traces/`, `README.md`, `index.html`) | **NONE (`0` matches in tracked files)** | None required. Verified `0` occurrences of real names, school names, professor names, student IDs, or `C:\Users\<username>` paths in all tracked files and exported JSON traces. |

---

## 3. Clean Submission Package Procedure (No History Rewrite)

To produce a 100% anonymous source code archive from `docs/napai-evaluation-submission` without modifying `.git` history:

```powershell
# 1. Create a clean zip archive of tracked files at HEAD (excludes .git/ directory entirely)
git archive --format=zip HEAD -o govaid-atlas-anonymous-submission.zip

# 2. Verify no .git directory or author metadata is inside the zip
tar -tf govaid-atlas-anonymous-submission.zip | Select-String "^\.git"
```
