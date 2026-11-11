# GovAid Atlas

GovAid Atlas 是租屋補助資格預審與申辦導航的概念 Prototype（NAPAI 2026 決賽作品）。目前完成的範圍聚焦於 **115 年度中央擴大租金補貼（R1）、臺北市住宅租金加碼補貼（R6）、新北市青年租金補貼（R7）** 之有限規則子集，以 deterministic Rules Engine 執行明確的資格條件檢核，並結合受邊界約束（bounded）的 Agent tool-routing、動態缺漏欄位詢問（Human Gate）與可匯出的去識別化執行軌跡（Agent Trace）。

---

## Current Implemented Scope (Wave 1 – Wave 3)

- **Deterministic Eligibility & Coverage Statuses (`src/status.ts`, `src/coverage.ts`)**：
  - 狀態優先序：`FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`
  - `PARTIAL_CHECK`（初步條件通過／部分檢核）：因目前僅實作各方案之核心規則子集（未涵蓋完整家庭所得門檻、家庭成員財產清冊、租約備查等全部法定條件），當已實作規則通過時，系統明確標示為 `PARTIAL_CHECK`，不宣稱完整核准（`PASS`）。
  - `NOT_COVERED`（尚未涵蓋）：針對尚未實作之縣市（如桃園市、臺中市等）或尚未實作之補助類別（如育兒津貼、托育補助、生育獎勵），系統明確回傳 `NOT_COVERED`，不會誤套用租屋規則或產生假陽性 `PASS`。
  - `FAIL`（明確不符）：任一必要條件違反（如 `ownsHome = true` 持有自有住宅）即判定為 `FAIL`，且不可被 LLM planner 覆寫。
  - `UNCERTAIN`（資料待確認）：缺少必要欄位時保持 `UNCERTAIN` 並進入 `WAITING_FOR_HUMAN`。
- **Bounded Stateful Agent Tool Routing (`src/agent/orchestrator.ts`)**：
  - LLM Planner（支援本機 Ollama `qwen3.5:4b` 或選配 OpenAI API）提出下一步動作提案（`AgentDecision`），並真正影響允許工具（allowlisted tools）的呼叫順序。
  - **三層提案驗證（`validatePlannerProposal`）**：依序檢查 Schema 結構、Tool Allowlist（9 項允許工具）與狀態安全不變量（阻擋未完成評估即提前 `COMPLETE`、阻擋無狀態改變之重複工具呼叫、阻擋任何透過 `toolArguments` 竄改申請人資料或覆寫資格狀態的行為）。
  - **Safe Deterministic Fallback**：當模型離線、逾時或提出無效工具提案時，系統記錄拒絕原因（`proposalRejected = true`）並自動切換至 deterministic fallback（`fallbackUsed = true`），確保服務不中斷且不產生假 `PASS`。
- **Dynamic Missing-Field Handling & Stateful Resume (`src/agent/missing-fields.ts`)**：
  - 支援 `city`、`ownsHome`、`receivesOtherHousingAid`、`monthlyIncome`、`age`、`centralRentApproved`、`newTaipeiResidenceStudyWork`、`registeredCity` 等動態缺漏欄位偵測與專屬提問。
  - 使用者回覆後先執行型別與數值範圍驗證（如拒絕非數字或負數月所得），驗證通過後更新結構化狀態並接續原 Agent run。
- **Sanitized Trace Export (`src/agent/trace.ts`, `artifacts/traces/`)**：
  - 每個步驟均記錄結構化 `AgentTraceEvent`（含 `runId`、`plannerProposal`、`validationResult`、`proposalRejected`、`rejectionReason`、`selectedTool`、`humanGate` 前後狀態轉換、`fallbackUsed`、`latencyMs`）。
  - 匯出時自動清除 API keys、Bearer tokens、system prompts、chain-of-thought 與敏感個資欄位。
- **API Hardening (`src/server.ts`, `src/agent/client.ts`)**：
  - Request body 上限 `16 KB`（超過回傳 HTTP `413 PAYLOAD_TOO_LARGE`）。
  - User goal 長度上限 `800` 字元（超過回傳 HTTP `400 GOAL_TOO_LONG`）。
  - 單一 IP 速率限制預設 `20 requests / 60s`（超過回傳 HTTP `429 RATE_LIMIT_EXCEEDED` 與 `Retry-After`）。
  - Provider 呼叫逾時保護預設 `15,000 ms`（逾時回傳受控之 `AGENT_PROVIDER_TIMEOUT` fallback）。

---

## Golden Case (Synthetic Persona)

- **20 歲、單身**
- **戶籍：** 臺北市
- **目前住址（ACTUAL）：** 新北市永和區（合成測試地址，月租 NT$13,500）
- **搬遷假設（WHAT_IF）：** 臺北市文山區（合成測試地址，月租 NT$15,500）
- **資料性質：** 全部使用合成資料（Synthetic Persona），非真實個人或家庭個案。

---

## Architecture

```text
USER GOAL
  ↓
COVERAGE BOUNDARY CHECK (Covered Rental Scope vs. NOT_COVERED Childcare / Uncovered Cities)
  ↓
CURRENT STRUCTURED STATE (ApplicantProfile + Scenarios + CompletedTools)
  ↓
PLANNER PROPOSAL (Local Ollama qwen3.5:4b / OpenAI / Deterministic Planner)
  ↓
3-LAYER VALIDATION (Schema → Allowlist → State & Safety Invariants)
  ├─ [Invalid / Timeout / Unavailable] → Log Rejection + Safe Deterministic Fallback
  └─ [Valid] → Route to Allowlisted Tool
  ↓
EXECUTE ALLOWLISTED TOOL (Deterministic Rules Engine / Scenario / Conflict / Evidence / Passport)
  ↓
OBSERVATION & STATE UPDATE (FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS)
  ↓
WAITING_FOR_HUMAN (Dynamic Missing-Field Question → Input Validation → Resume)
  ↓
COMPLETED / NOT_COVERED / HUMAN_REVIEW_REQUIRED / FAILED (Sanitized JSON Trace Export)
```

---

## Policy Sources & Coverage Boundaries

目前實作的政策來源索引（各方案僅實作 2 項核心規則子集）：

- **R1**：內政部國土管理署 — 三百億元中央擴大租金補貼專案計畫作業規定（115年度）
- **R6**：臺北市政府都市發展局 — 115年度臺北幸福租－民間租屋租金加碼補貼
- **R7**：新北市政府城鄉發展局 — 115年度新北市青年租金補貼

來源連結與規則子集分別記錄於 `src/evidence.ts` 與 `src/policies/`。

### Explicit Coverage Limitations (What GovAid Atlas Does NOT Claim)
1. **不提供桃園市或其他未實作縣市之地方補助判定**：查詢桃園市等未涵蓋縣市時，系統明確回傳 `NOT_COVERED`。
2. **不提供育兒津貼／托育補助判定**：本階段僅實作租屋補助預審；查詢育兒或托育補助時，系統明確回傳 `NOT_COVERED`，不會執行租屋規則工具。
3. **不代表完整法定資格核准或政府認證**：已實作規則通過時僅代表 `PARTIAL_CHECK`（初步條件通過），實際核定仍須檢核家庭年所得、每人每月平均所得、家庭成員房產及租約規定。
4. **未串接任何政府系統或自動申辦 API**：系統僅產生申辦決策護照（Decision Passport）供民眾自行查核備件，不具備自動送件功能。
5. **Benchmark Gold Standard 與真人場域驗證狀態**：
   - `benchmark/cases.json`（`B01`–`B10`）之 Gold Answers 源自專案規則子集，目前狀態為 **`PENDING_INDEPENDENT_REVIEW`**（詳見 `docs/gold-standard-review-status.md`）。
   - 外部真人使用者場域測試（Field Validation）已完成實驗設計與空白紀錄表（`docs/field-validation-protocol.md`、`docs/field-validation-results-template.md`），目前狀態為 **`PENDING`**（尚未宣稱已完成真人受測數據）。
6. **RBAC 角色切換僅為合成展示**：介面中之角色切換（申請人／承辦員／稽核員）為前端欄位遮罩概念展示，非正式環境之身分驗證與權限控管系統（詳見 `docs/security-self-assessment.md`）。

---

## Local Setup & Commands

### 1. Environment Configuration
複製 `.env.example` 為 `.env`：

```sh
AGENT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OPENAI_API_KEY=
OPENAI_MODEL=
```

（若未啟動本機 Ollama 或未設定 `OPENAI_API_KEY`，系統仍會透過 safe deterministic fallback 完整執行規則預審流程。）

### 2. Install, Test, Typecheck & Build

```sh
npm install
npm test
npx tsc --noEmit
npm run build
```

Windows PowerShell 若遇到 `npm.ps1` 執行原則限制，可改用：

```powershell
npm.cmd install
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

### 3. Run Local Dev or Production Preview

```sh
# Development mode (API server + Vite client)
npm run dev

# Single-origin production preview on http://127.0.0.1:8787
npm run build
npm run start
```

---

## Evaluation & Submission Evidence Docs

- `docs/napai-evaluation-report.md` — Wave 3 完整量化評測、延遲、成本、穩定性與安全性報告
- `docs/benchmark-methodology.md` — 五種評測方法（Deterministic / Bounded Agent / Raw LLM / Fixed-flow / Manual）方法論
- `docs/gold-standard-review-status.md` — Gold Standard 完整性與 `PENDING_INDEPENDENT_REVIEW` 狀態聲明
- `docs/gold-standard-independent-review-template.md` — `B01`–`B10` 獨立第三方審查表單
- `docs/trace-evidence-index.md` — `artifacts/traces/trace-a..f.json` 執行軌跡索引與去識別化驗證
- `docs/field-validation-protocol.md` & `docs/field-validation-results-template.md` — 真人交叉實驗設計與空白結果表（`PENDING`）
- `docs/security-self-assessment.md` — 14 項資安、可控性與治理自我評估
- `docs/third-party-resources.md` — 第三方模型、套件、雲端服務與政策來源揭露
- `docs/anonymization-audit.md` — 匿名化提交稽核報告
- `docs/napai-submission-readiness.md` & `docs/competition-evidence-matrix.md` — 決賽提交準備度與評分項目證據矩陣
