# Final Demo Lock — Reliability & Release Checks (Wave 3)

Date: 2026-11-10 · Branch: `feat/demo-ux-redesign-v2` · Model: `qwen3.5:4b` via local Ollama
(`ollama ps`: 100% CPU, context 4096). All numbers below were measured in this session; none are estimated.

## 1. Golden Path reliability — 5 consecutive real runs

Method: production build served by `npm start` at `http://127.0.0.1:8787`, driven in Chrome at
1366×768. Each run loads a fresh page (runtime counters reset), clicks 開始分析, waits for the
Human Gate, clicks 沒有自有住宅, waits for the Decision Passport, then reads the Runtime tab and
Audit trail. Run 1 started with the model unloaded (`ollama ps` empty), i.e. a true cold start.

| Run | Start (UTC) | Planner latency | Click → Human Gate | Confirm → Completed | Final | LLM call | Tokens in/out | UI issue |
|---|---|---|---|---|---|---|---|---|
| 1 (cold) | 07:38:49 | **94.7 s** | 94.9 s | 0.34 s | COMPLETED | completed | 204 / 322 | none |
| 2 | 07:40:28 | 73.5 s | 73.5 s | 0.20 s | COMPLETED | completed | 204 / 322 | none |
| 3 | 07:41:45 | 63.8 s | 63.9 s | 0.22 s | COMPLETED | completed | 204 / 322 | none |
| 4 | 07:42:52 | 61.0 s | 61.1 s | 0.20 s | COMPLETED | completed | 204 / 322 | none |
| 5 | 07:43:58 | 62.2 s | 62.2 s | 0.20 s | COMPLETED | completed | 204 / 322 | none |

"Confirm → Completed" is measured with a 200 ms poll, so values are upper bounds; the resume path
is synchronous rule evaluation. "UI issue" = horizontal overflow, raw agent enum on the main
surface, or a local file path in page text — none observed at the gate or the result in any run.
Every run produced the same verdicts: 中央方案 通過 · 新北方案 待確認 · 臺北方案 待確認.

### Summary

| Metric | Value |
|---|---|
| Success | **5 / 5** |
| Median planner latency (all 5) | **63.8 s** |
| Slowest planner latency | **94.7 s** (run 1, cold) |
| Cold-start latency | **94.7 s** |
| Warm-run latency (runs 2–5) | 61.0–73.5 s, median 63.0 s; steady state (runs 3–5) 61.0–63.8 s |
| Confirm → Completed | ≤ 0.34 s every run |

### Warm-up experiment (basis for the runbook)

1. Unload the model (`keep_alive: 0`) → `ollama ps` empty.
2. Warm-up call (runbook command) → **11.0 s**; `ollama ps` shows *59 minutes from now*.
3. First real planner call via `POST /api/agent/plan` after warm-up → **70.8 s**, succeeded,
   204/322 tokens. The resident window stayed at 59 minutes after this app call.

Conclusion: the warm-up removes the ~24 s cold penalty; one rehearsal run then brings the stage run
to the ~62 s steady state. Planning time is generation-bound on CPU (322 output tokens ≈ 60 s).

## 2. Runtime truthfulness

* Values come from live state: Ollama's `prompt_eval_count` / `eval_count` → `recordLlmCall`.
* Golden goal is identical every run and the provider uses `temperature: 0`, so 204/322 tokens
  repeat by design. A different goal (「我住在新北市永和區，想知道有哪些租屋補助。」) reported
  **165 / 117 tokens and 30.3 s** — the display follows provider-reported usage.
* With no run yet, or when the model call fails: LLM Calls `0`, tokens / latency / cost `N/A`.
* **Fixed in this wave:** after a failed model call the UI showed 「規劃耗時 0.0 秒 / Planner latency
  0.0 s」. Planner latency is now recorded only when the model returned a plan, otherwise `N/A`.

## 3. Provider failure drill

A second instance (`PORT=8788`, `OLLAMA_BASE_URL` pointed at a closed port) simulated Ollama being
down; the real Ollama and the 8787 instance were not touched. Instance stopped afterwards; 8787
`/api/health` → `AVAILABLE`.

| Check | Result |
|---|---|
| `/api/health` | `ok:false`, `providerStatus: UNAVAILABLE` |
| START screen | LOCAL AGENT · `UNAVAILABLE` · 「模型連線異常，規則檢查仍可執行」 |
| UI crash | none |
| Deterministic fallback | reached Human Gate in 0.2 s, completed to Decision Passport |
| Context panel | 「模型狀態：無法使用，已改用規則式規劃」, no model note |
| No fake live success | LLM Calls 0; Execution, tokens, latency, cost `N/A`; audit `AGENT_LLM_CALL_FAILED` |

**PASS** (after the planner-latency fix above).

## 4. Projector QA (exact CSS viewports, final build)

| Viewport | START | Human Gate | DECIDE |
|---|---|---|---|
| 1366×768 | 1.00 screen, CTA y=540–596 | 1.00 screen, gate y=91–481, answers y=340–407 | 2.52 screens; verdicts y=215–357, confirmed/uncertain y=377–509 |
| 1920×1080 | 1.00 screen, CTA y=655–722 | 1.00 screen, gate y=106–582 | 2.15 screens; verdicts + full comparison table in first screen |

All six states: no horizontal overflow, no raw enum, no debug text, no local path or username,
smallest rendered text 12 px, governance only behind 技術與治理.

## 5. Keyboard QA (1366×768, real run, keys only)

| Step | Result |
|---|---|
| START: goal box → Tab → Enter | focus 開始分析 (visible 2.4 px ring) → run starts, focus → Current Action heading |
| Gate: Space while focus is on the question | **does not answer**; gate stays, ownership still 待確認 |
| Gate: Tab → Enter | focus 沒有自有住宅 (visible ring) → completed |
| Result | focus lands on 「你的補助決策摘要」 |
| Shift+Tab ×2 → Enter | drawer opens, focus on close button; ← → switch tabs |
| Escape | drawer closes, focus returns to 技術與治理 |

Space on a *focused* answer button still activates it — standard button behaviour required for
keyboard accessibility. Accidental activation is prevented because focus lands on the question
heading, not on a button.

Note: from a fresh page load, focus starts at the document; press Tab ×4 (skip link → 技術與治理 →
重設 → goal box) or click the goal box, then Tab → Enter.

## 6. Benchmark integrity

Raw data unchanged vs `main` (`benchmark/`, `src/benchmark-final.ts`). Displayed snapshot:
LLM + Policy Context vs GovAid Atlas — Status Accuracy 70% → 100%, Evidence Coverage 77.8% → 100%,
Unsupported Claim 30% → 0%, Unsafe Certainty 40% → 0%, manual baseline Pending. Disclaimer restored
to the frozen wording: "10 synthetic policy-navigation cases; not a real-world accuracy claim."

## 7. Production origin & public site

| Check | Result |
|---|---|
| `npm.cmd run build` → `npm.cmd start` | listens on `127.0.0.1:8787` |
| `GET /` | 200 `text/html` |
| `GET /assets/*.js` | 200 `text/javascript` (same origin) |
| `GET /api/health` | 200, `providerStatus: AVAILABLE` |
| Ollama `11434` | bound to `127.0.0.1` only (not exposed) |
| `https://govaid.torchark.tw/` and `/api/health` | both 200, provider AVAILABLE |
| Public site build | **older bundle** than this branch — tunnel host must redeploy this branch |

No cloudflared process runs on this machine; tunnel/DNS configuration was not touched.

## 8. Conflict markers on `main`

`main` (= `origin/main` = `11ced97`, via PR #10 commit `e890454`) still contains an unresolved
`git stash pop`:

* `package.json` lines 11–17 — duplicated `build` / `start` scripts (same commands, different order).
* `src/server.ts` — six hunks: imports (1–9), `HOST` / `DIST_DIR` / MIME map (17–25), a duplicate
  `serveStatic` (31–76), static routing (222–231), `server.listen` binding (251–257).

Resolution on this branch, commit `d5f0b9b`: kept the *Updated upstream* side, which is
byte-identical to the last clean version `e292efa` (re-verified: `git diff e292efa HEAD --
src/server.ts` is empty). `main` itself was not modified; it is fixed when this branch (or
`d5f0b9b`) is merged.

## 9. Branch hygiene

* `demo/govaid-atlas-offline-demo.html` was committed here (`2a3fa87`, `3342dd2`) but is identical to
  `feat/final-html-demo` → removed from this branch; the offline demo lives on its own branch.
* `demo-video/` kit was committed here (`6d26c45`) and existed on no other branch → preserved first
  as a local commit on `feat/backup-demo-video` (not pushed), then removed from this branch.
* No history rewritten; both removals are ordinary deletions in the Wave 3 commit.

## 10. Regression

`npm.cmd test` 24/24 · `npx.cmd tsc --noEmit` pass · `npm.cmd run build` pass ·
`npx.cmd tsx src/benchmark-demo.ts` 12/12, evidence coverage 100%, unsafe certainty 0,
conflict 2/2, recovery 1/1.
