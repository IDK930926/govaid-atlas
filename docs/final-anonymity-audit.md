# Final Anonymity & Secret Audit (Wave 3)

Date: 2026-11-10 · Branch: `feat/demo-ux-redesign-v2`

Scope: everything a judge can see or download — the production build (`dist/`, `index.html`),
every UI state (START, ANALYZE, Human Gate, DECIDE, all four governance tabs, debug JSON), plus
the committed repository (`src/`, `docs/`, `benchmark/`, `README.md`) and full git history for
secrets. The identifiers searched for (team members' real names, account handles, email
addresses, the machine's Windows username) are deliberately **not** reproduced here.

## Visible demo surfaces

| Category | Method | Result |
|---|---|---|
| University name / logo | text search (Chinese + English names, abbreviations, 「大學」, "university"); no images in build | **PASS** |
| Participant names | text search for each member's name (Chinese and romanised) | **PASS** |
| Professor name | text search (「教授」, 「指導老師」, "professor", names) | **PASS** |
| GitHub username | text search for the repository owner handle | **PASS** |
| Gmail / any email address | email regex over build and repo | **PASS** |
| Cloudflare account email | email regex; no Cloudflare config in repo | **PASS** |
| Windows username / `C:\Users\...` | regex for drive paths, `/Users/`, `AppData`; runtime check of page text in every state | **PASS** |
| API keys | see secret scan | **PASS** |
| Tunnel tokens | see secret scan | **PASS** |
| Debug UI on main surface | runtime check: no raw agent enums, no "debug", `undefined`, `NaN` in main view; debug JSON only inside 技術與治理 → 執行紀錄 (collapsed) | **PASS** |
| Personal profile images | no image files tracked or bundled; no `<img>` in the app | **PASS** |

Synthetic data shown on purpose (labelled as synthetic in the UI): applicant persona (20 歲 · 單身 ·
臺北戶籍) and the RBAC demo record (陳同學, a format-only sample ID and phone number).

Public site note: the URL `govaid.torchark.tw` is the product domain and is not shown inside the UI.

## Secret scan (values never printed)

Patterns checked in HEAD, the working tree, and every commit on every branch (`git log --all -G`):

| Pattern | HEAD | History | Working tree |
|---|---|---|---|
| OpenAI-style `sk-…` key | none | none | none |
| `OPENAI_API_KEY=<value>` | none | none | none |
| Literal `Bearer <token>` | none | none | none |
| Cloudflare tunnel token (`eyJ…`) | none | none | none |
| Cloudflare credential JSON (`AccountTag`, `TunnelSecret`, `TunnelID`) | none | none | none |
| `CLOUDFLARE_API_TOKEN` / `TUNNEL_TOKEN` | none | none | none |
| Private key blocks | none | none | none |
| AWS access keys | none | none | none |

Tracked env files: only `.env.example`, whose `OPENAI_API_KEY=` is empty. `.gitignore` excludes
`.env` and `.env.*` (except the example).

## Result

**PASS — no personal identifiers, credentials or developer paths on any demo surface or in the
repository.**

Out of scope, for the team to check before recording: git commit metadata (author fields are not
part of the demo), and the OS chrome around the browser (taskbar, notifications, terminal windows)
— covered by the runbook's notification and terminal rules.
