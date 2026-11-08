# GovAid Atlas

GovAid Atlas 是育兒／租屋補助資格預審與申辦導航的概念 Demo；目前完成的 P0 範圍聚焦於租金補貼 Golden Case，以 deterministic Rules Engine 執行明確的資格條件判斷，並由本機 Ollama 提供 agent planning 與 tool routing。

## Current P0 Scope

- Golden Case workflow
- Deterministic Rules Engine
- `PASS` / `FAIL` / `UNCERTAIN` 判定
- 缺少必要資料時要求 Human Confirmation
- 使用者補資料後重新執行 Rules Engine
- Evidence Binding
- Actual / What-if 地址情境與地方政策 routing
- Decision Passport
- Audit Trail
- React / Vite demo UI
- 可編輯的 User Goal 與本機 Agent Runtime
- Human-in-the-loop 回答與 Agent resume
- Ollama 真實呼叫次數及 provider 回報的 token usage
- 可重設的 demo flow

## Golden Case

**Synthetic Persona**

- 20 歲、單身
- 戶籍臺北市
- 現址新北市永和區
- 候選地址臺北市文山區
- 全部使用合成資料

這是競賽 Demo 用 Synthetic Persona，不是真人個案；地址及其他案例資料均為合成資料。

## Architecture

```text
User Goal
→ Applicant Profile
→ Rules Engine
→ UNCERTAIN
→ Human Confirmation
→ Re-evaluation
→ Policy Routing
→ Actual / What-if
→ Evidence
→ Decision Passport
→ Audit Trail
```

Agent 以本機 Ollama 規劃並選擇 allowlisted tools；資格判斷與人工回答後的重新評估仍由 deterministic Rules Engine 執行。地方政策缺少必要資料時，結果會保持 `UNCERTAIN`。

## Policy Sources

目前示範的政策來源索引：

- R1：中央租金補貼官方資料
- R6：臺北市住宅租金加碼補貼官方資料
- R7：新北市青年租金補貼官方資料

來源連結及規則子集分別記錄於 `src/evidence.ts` 與 `src/policies/`。目前政策規則只實作決賽 P0 所需子集，不代表完整政府資格審查系統；政策可能更新，使用前應再次查核最新官方資訊。

## Agent Orchestrator

- `src/agent/` contains the bounded agent runtime, tool allowlist, and provider abstraction.
- LLM planning is server-side only; browser code never receives or stores the API key.
- The deterministic rules engine remains the source of truth for eligibility calculations.
- The agent may only call allowlisted tools (`evaluate_central_rules`, `evaluate_actual_scenario`, `evaluate_what_if_scenario`, `detect_policy_conflict`, `generate_decision_passport`, `get_policy_evidence`).
- Missing required fields trigger `WAITING_FOR_HUMAN` and block automatic qualification changes.
- If the provider is unavailable, the app fails safely and keeps the deterministic golden-case workflow working.
- Local inference uses Ollama with `AGENT_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `OLLAMA_MODEL=qwen3.5:4b`.
- Edit the User Goal in the Agent Runtime card and select **Run Agent** to submit a live planning request.
- When a run waits for home-ownership input, either answer resumes the orchestrator and reruns deterministic rules before continuing policy routing.

### Local Agent Setup

1. Install Ollama.
2. Pull the local model:
   ```sh
   ollama pull qwen3.5:4b
   ```
3. Start Ollama locally.
4. Set the environment for local inference:
   ```sh
   AGENT_PROVIDER=ollama
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   OLLAMA_MODEL=qwen3.5:4b
   ```
5. Start GovAid Atlas:
   ```sh
   npm install
   npm run dev
   ```
6. Verify the provider shows `AVAILABLE` on `/api/health`, then run an editable goal from the Agent Runtime card.

No API key is required for the local provider.

### Environment

Copy `.env.example` to a local `.env` file and set:

```sh
AGENT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OPENAI_API_KEY=
OPENAI_MODEL=
```

### Local startup

```sh
npm install
npm run dev
```

The frontend and agent API run together locally. The agent endpoint is served from `/api/agent/plan`.

### Production preview

Build and run the single-origin production preview:

```sh
npm run build
npm run start
```

By default, the service listens on `http://127.0.0.1:8787`, serving the built `dist/` site, the `/api/*` endpoints, and SPA client routes from one HTTP origin. Set `PORT` to change the port. A Cloudflare Tunnel should point to this GovAid Atlas port only; Ollama remains server-side at `http://127.0.0.1:11434`.

## Important Limitations

- GovAid Atlas 僅提供資格預審與申辦導航，不代表主管機關核准。
- 未串接任何政府系統或政府 API。
- 不使用真實個資；Demo 使用 Synthetic Persona。
- 目前只完成 P0 Golden Case。
- 尚未串接政府系統或政府 API。
- Cloud API Cost 為本機 Ollama 呼叫的 `$0`；token 欄位只呈現 provider 實際回報值，缺少 usage 時顯示 `N/A`。
- Rule Conflict、Permission / Role control 與 Benchmark 僅為合成資料 demo。
- 尚未進行真人 usability validation。
- 示範規則是有限子集，不可取代正式申請或主管機關審查。

## Run Locally

```sh
npm install
npm run dev
npm run build
```

Windows PowerShell 若遇到 `npm.ps1` 執行原則限制，可改用：

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

## Tech Stack

- React 19
- TypeScript 7
- Vite 8
- npm
