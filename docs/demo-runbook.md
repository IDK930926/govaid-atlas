# GovAid Atlas — Final Live Demo Runbook (Stage Edition)

**Primary Stage Configuration:** OpenAI (`gpt-5.4-mini` via `AGENT_PROVIDER=auto` / `AGENT_PROVIDER=openai`, ~5 s planner latency).  
**Local Fallback Configuration:** Local Ollama (`qwen3.5:4b`, steady-state latency ~61–64 s on CPU) kept pre-warmed as standby.  
**Fail-Safe Mode:** Deterministic rule engine fallback (<0.5 s, zero crash risk).  
**Benchmark & Timing Reference:** `docs/openai-live-validation.md` (OpenAI 5/5 runs, 5.1 s median) & `docs/demo-reliability-wave3.md` (Ollama historical CPU baselines).

> [!IMPORTANT]
> **Live Stage Recommendation:** Always use **OpenAI Cloud primary** (`gpt-5.4-mini`) for the live stage presentation. Local CPU Ollama is supported and tested, but CPU generation latency (60–90 s) consumes too much of the strictly timed 3-minute stage window. Keep Ollama running locally in the background purely as a network-loss safety net.

---

## 1. Before Stage (T-30 min Checklist, PowerShell in repo folder)

| # | Step | Command / Action | Pass When |
|---|---|---|---|
| 1 | Power & Network | AC adapter plugged in; Windows Power Mode = Best Performance; Connect to stable stage Wi-Fi or phone hotspot | Plugged-in icon; internet reachable |
| 2 | Environment Check | Verify `.env` has valid `OPENAI_API_KEY` and `AGENT_PROVIDER=auto` | `.env` configured |
| 3 | Standby Ollama | `$ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"; & $ollama list` (if offline: `Start-Process $ollama -ArgumentList serve -WindowStyle Hidden`) | Lists `qwen3.5:4b` |
| 4 | Warm Ollama Standby | `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:11434/api/generate -ContentType 'application/json' -Body '{"model":"qwen3.5:4b","keep_alive":"60m"}'` | Weights warm in RAM for 60 min |
| 5 | Start App | `npm.cmd run build; npm.cmd start` (leave window running in background) | `listening on http://127.0.0.1:8787` |
| 6 | Health Check | `Invoke-RestMethod http://127.0.0.1:8787/api/health` | `providerStatus: AVAILABLE` |
| 7 | Browser Setup | Chrome, clean window, `http://127.0.0.1:8787` → F11 full screen, zoom 100% | START screen shows `AGENT · AVAILABLE` |
| 8 | Resolution | Projector mirrored at 1920×1080 or 1366×768 | Responsive layout, no horizontal scrollbar |
| 9 | Rehearsal Run | Quick rehearsal run: custom case → Human Gate → Decision Passport visible | Smooth execution in ~5 s (OpenAI) |
| 10 | Reset | Click top-right **重設** button | Clean START screen, timers and previous run cleared |
| 11 | Notifications Off | Windows Focus / Do Not Disturb ON; quit Teams, Discord, Line, Slack, Mail | Notification pop-ups muted |
| 12 | Backups Ready | Offline showcase (`demo/govaid-atlas-competition-showcase.html`) open in second browser tab | Ready one Alt+Tab away |

---

## 2. Live Demo Script (~3 Minutes Target)

```
0:00 - 0:30  [1] Open Product & Custom Housing Case
0:30 - 1:00  [2] Human Gate (Active Clarification)
1:00 - 1:40  [3] Decision Passport + ApplicationGuide (PARTIAL_CHECK & Navigation)
1:40 - 2:10  [4] Multi-Domain Switch: Childcare Allowance (R8 & Tiered Amount)
2:10 - 2:40  [5] Technical & Governance Trace (3-Layer Validation & Sanitization)
2:40 - 3:00  [6] Safe Boundary: NOT_COVERED & Official Referral
```

### Step-by-Step Actions:

1. **Open Product & Show Custom Housing Case (0:00–0:30)**
   - Explain: *GovAid Atlas is a bounded agentic pre-screening & navigation system that separates LLM planning from deterministic statutory rules.*
   - In the goal prompt, use the custom case or enter: 「我住在新北市永和區，想知道有哪些租屋補助，未來想搬到臺北市文山區。」
   - Click **開始分析**. Notice fast ~5 s cloud response (or warm Ollama fallback).
2. **Human Gate Interaction (0:30–1:00)**
   - System pauses at **Human Gate**: 「本人是否持有住宅？」
   - Explain: *The Agent does not guess unverified facts. It dynamically triggers a human gate to ensure zero safety violations.*
   - Click **沒有自有住宅**.
3. **Decision Passport & ApplicationGuide (1:00–1:40)**
   - Verdict banner shows **中央擴大租金補貼：初步條件通過（部分檢核）** (`PARTIAL_CHECK`).
   - Explain: *We do not overclaim full PASS because statutory income proof and family assets require official agency review.*
   - Scroll down to **申辦決策護照（Decision Passport）** and **申辦導航（ApplicationGuide）**:
     - Point out official required documents (身份證、租約、郵局存摺).
     - Official portal link (`https://has.nlma.gov.tw/subsidyOnline/`).
     - Administering agency, hotline, and validity dates (`115/01/01`–`115/12/31`).
4. **Switch to Childcare Domain (1:40–2:10)**
   - Click **重設** or enter childcare goal: 「我的小孩一歲，想申請育兒津貼」
   - Click **開始分析**.
   - Note the Childcare JourneyStepper steps (需求辨識 → 條件檢核 → 津貼試算 → 決策護照).
   - Show final verdict: **衛福部未滿2歲育兒津貼：條件符合** (`PASS`).
   - Highlight statutory birth-order calculation (第 1 胎 NT$5,000 / 第 2 胎 NT$6,000 / 第 3 胎 NT$7,000) and link to `https://twbaby.sfaa.gov.tw/`.
5. **Open Trace & Governance Evidence (2:10–2:40)**
   - Click top-right **技術與治理** drawer.
   - Show the live **Agent Trace**:
     - 3-layer validation (Schema → Allowlist → Domain/State Invariants).
     - Sanitization proof (no API keys, no bearer tokens, no prompts, no PII).
     - Explicit disclosure: *Role-based views (Applicant / Officer / Auditor) are synthetic UI mockups, not production RBAC.*
   - Press `Esc` to close drawer.
6. **Safe Boundary: Fallback / NOT_COVERED (2:40–3:00)**
   - Enter an out-of-scope query: 「我想申請托育補助」 or 「臺中市租屋補助」.
   - Result: Clear **`NOT_COVERED`** card.
   - Point out: *The system gracefully refuses unsupported programs, provides clear explanations, and displays official trusted referral URLs (`run.coverage.officialReferrals`), completely preventing hallucinated approvals.*

---

## 3. Failure & Fallback Protocol

* **If Cloud OpenAI Latency > 10 s or Network Drops:**
  - The runtime cascade automatically triggers local Ollama (`qwen3.5:4b`) or immediate deterministic fallback.
  - The UI remains fully functional and completes the run.
* **If Total Failure Occurs on Stage:**
  - **Do NOT debug terminal or edit code on stage.**
  - Switch smoothly: *「為了節省時間，我們直接展示預載的競賽 Showcase 頁面。」*
  - Press `Ctrl+Tab` or `Alt+Tab` to switch to the pre-loaded **Showcase** (`demo/govaid-atlas-competition-showcase.html`), where all interactive state flows, traces, and comparison matrices are fully browsable offline.
* **Governance Reference:** See `docs/demo-reliability-wave3.md` for historical measurements and fallback drill proof.
