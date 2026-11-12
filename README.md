# GovAid Atlas

GovAid Atlas 是政府補助資格預審與申辦導航系統（NAPAI 2026 決賽作品）。目前涵蓋兩大福利領域共 5 項官方方案：**115 年度中央擴大租金補貼（R1）、桃園市受理之中央擴大租金補貼與申辦導航（R9）、臺北市住宅租金加碼補貼（R6）、新北市青年租金補貼（R7）**，以及全國適用之 **衛生福利部育有未滿2歲兒童育兒津貼（R8）**。系統以 deterministic Rules Engine 執行明確的資格條件與政策有效期間（`validFrom` / `validTo`）檢核，並結合受邊界約束（bounded）的 Agent tool-routing、跨領域隔離（`HOUSING` vs `CHILDCARE`）、動態缺漏欄位詢問（Human Gate）、完整申辦導航（`ApplicationGuide`）與可匯出的去識別化執行軌跡（Agent Trace）。

---

## Current Implemented Scope (Wave 1 – Wave 4 & Gates A–C)

- **Multi-Domain Coverage & Deterministic Eligibility Statuses (`src/status.ts`, `src/coverage.ts`, `src/childcare.ts`, `src/scenario.ts`)**：
  - 狀態優先序：`FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`
  - **育兒津貼領域（`CHILDCARE` — `CHILDCARE_ALLOWANCE_UNDER_2_115`）**：完整實作《育有未滿二歲兒童育兒津貼申領作業要點》（R8）之核心全國資格規則（未滿 24 個月、完成出生或初設戶籍登記、未經政府公費安置、未接受公共化或準公共托育服務、出生胎次排序），通過時判定為 `PASS` 並試算每月津貼金額（第 1 胎 NT$5,000、第 2 胎 NT$6,000、第 3 胎以上 NT$7,000）。查詢尚未實作之其他育兒方案（如托育補助、生育獎勵金、就學補助、育嬰留職停薪津貼）時明確回傳 `NOT_COVERED`，並附帶衛福部官方查證入口。
  - **租屋補助領域（`HOUSING` — 雙北與桃園市）**：支援中央 300 億元擴大租金補貼（`CENTRAL_RENT_115`）、新北市青年租金補貼（`NEW_TAIPEI_RENT_115`）、臺北市臺北幸福租加碼補貼（`TAIPEI_RENT_115`）及桃園市協辦受理之中央擴大租金補貼與桃園所得門檻檢核（`TAOYUAN_CENTRAL_RENT_115`，每人每月平均所得上限 NT$50,304）。因租屋方案僅編碼部分核心條件，已編碼規則通過時明確標示為 `PARTIAL_CHECK`（不宣稱完整 `PASS`）。查詢桃園市獨立通用地方租屋補助、原住民族專案租金補貼、包租代管或未涵蓋縣市（如臺中市、高雄市）時明確回傳 `NOT_COVERED`，並附帶內政部國土署或地方局處官方連結。
  - **政策有效期間強制檢核（`evaluatePolicyValidity` in `src/rules.ts`）**：所有規則均檢查 `validFrom` 與 `validTo`；過期政策絕不回傳現行 `PASS`（回傳 `FAIL` 並將 `ApplicationGuide` 標示為 `CLOSED`，或於 `allowHistorical: true` 時明確標記 `[歷史政策模式 / HISTORICAL_MODE]`）。
- **Arbitrary Scenario Intake & Custom Case Support (Gate A/B)**：
  - 支援使用者於介面自訂任意申請情境（年齡、月所得、名下房產、其他住宅補貼、戶籍與租屋縣市行政區、幼兒月齡、托育狀態、胎次等），系統動態解析並執行合規檢核，不再侷限於單一 Golden Persona。
- **Actionable Application Navigation & Upgraded Decision Passport (`src/navigation.ts`, `src/passport.ts`)**：
  - 每個支援方案均附帶結構化 `ApplicationGuide`：包含應備文件清單（對應官方來源 `R1`, `R6`, `R7`, `R8`, `R9`）、申辦方式（線上／臨櫃／郵寄）、官方線上申辦連結（`https://twbaby.sfaa.gov.tw/`、`https://has.nlma.gov.tw/subsidyOnline/` 等）、受理機關與聯絡電話、受理期間與開放狀態（`OPEN` / `ROLLING` / `CLOSED`）、排除條件、具體下一步與「最終核定以政府主管機關審查為準」免責聲明。
- **Bounded Stateful Agent Tool Routing (`src/agent/orchestrator.ts`)**：
  - LLM Planner 支援三層級串接架構（`AGENT_PROVIDER=auto`）：OpenAI `gpt-5.4-mini` 雲端主用（`/v1/responses`，約 5 秒延遲）→ 本機 Ollama `qwen3.5:4b` 離線備援 → 確定性規則引擎安全備援（< 0.2 秒）。
  - LLM 提出下一步動作提案（`AgentDecision`），並真正影響允許工具（11 項 allowlisted tools）的呼叫順序。
  - **三層提案驗證與跨領域隔離（`validatePlannerProposal`）**：依序檢查 Schema 結構、Tool Allowlist、跨領域工具隔離（育兒案件禁止呼叫租屋工具，租屋案件禁止呼叫育兒工具）與狀態安全不變量。
- **Dynamic Missing-Field Handling & 14-Field Human Gate (`src/agent/missing-fields.ts`)**：
  - 支援租屋欄位（`city`、`ownsHome`、`receivesOtherHousingAid`、`monthlyIncome`、`age`、`centralRentApproved`、`newTaipeiResidenceStudyWork`、`registeredCity`）與育兒津貼欄位（`childAgeMonths`、`childHasBirthOrInitialHouseholdRegistration`、`receivesPublicOrQuasiPublicChildcare`、`isGovernmentPlaced`、`birthOrder`）共 14 項缺漏欄位之動態提問、資料驗證、前後狀態記錄與安全接續執行。
- **Domain-Aware Fallback & NOT_COVERED Official Referrals (Gate B)**：
  - 當模型離線或遭遇非預期輸入時，fallback proposal 具備福利領域感知能力（租屋提議 `evaluate_central_rules`，育兒提議 `evaluate_childcare_rules`），絕不產生跨領域工具衝突。
  - 遭遇 `NOT_COVERED` 查詢時，介面呈現清晰之官方轉介卡片與安全外部連結（`run.coverage.officialReferrals`）。
- **Sanitized Trace Export (`src/agent/trace.ts`, `artifacts/traces/`)**：
  - 完整記錄 12 項代表性 Agent Trace（`TRACE-A` 至 `TRACE-L`），涵蓋有效提案、缺漏補正、非法工具拒絕、非涵蓋範圍轉介、狀態竄改攔截、離線備援、育兒津貼、桃園受理、自訂情境等。
  - 匯出時全面自動過濾 API Keys、Bearer tokens、系統提示詞、思考過程（chain-of-thought）與個人敏感資料。
- **API Hardening (`src/server.ts`, `src/agent/client.ts`)**：
  - Request body 上限 `16 KB`（超過回傳 HTTP `413 PAYLOAD_TOO_LARGE`）。
  - User goal 長度上限 `800` 字元（超過回傳 HTTP `400 GOAL_TOO_LONG`）。
  - 單一 IP 速率限制預設 `20 requests / 60s`（超過回傳 HTTP `429 RATE_LIMIT_EXCEEDED` 與 `Retry-After`）。
  - Provider 呼叫逾時保護預設 `15,000 ms`（逾時回傳受控之 `AGENT_PROVIDER_TIMEOUT` fallback）。
  - 全套自動化回歸測試：**92 / 92 PASS**（9 套測試套件）。

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

目前實作的政策來源索引（詳見 `docs/wave4-policy-evidence.md`、`src/evidence.ts` 與 `src/policies/`）：

- **R1**：內政部國土管理署 — 三百億元中央擴大租金補貼專案計畫作業規定（115年度）
- **R6**：臺北市政府都市發展局 — 115年度臺北幸福租－民間租屋租金加碼補貼
- **R7**：新北市政府城鄉發展局 — 115年度新北市青年租金補貼
- **R8**：衛生福利部社會及家庭署 — 育有未滿二歲兒童育兒津貼申領作業要點（115年度適用）
- **R9**：桃園市政府住宅發展處／內政部國土管理署 — 300億元中央擴大租金補貼專案計畫－桃園市受理與申辦規定（115年度）

### Explicit Coverage Limitations (What GovAid Atlas Does NOT Claim)
1. **桃園市邊界說明**：桃園市目前已支援「300億元中央擴大租金補貼（桃園市政府住宅發展處協辦受理與桃園所得門檻檢核）」之預審與申辦導航（`PARTIAL_CHECK`）；桃園市無另設全市通用地方租金加碼，若查詢桃園市獨立地方租屋補助、原住民族租金補貼、包租代管或其他未實作縣市（如臺中市、高雄市），系統明確回傳 `NOT_COVERED`。
2. **育兒補助邊界說明**：目前育兒領域僅涵蓋「育有未滿2歲兒童育兒津貼（`CHILDCARE_ALLOWANCE_UNDER_2_115`）」；若查詢準公共托育補助、各縣市生育獎勵金、2–4歲就學補助或育嬰留職停薪津貼，系統明確回傳 `NOT_COVERED` 並提供衛福部社家署官方入口，絕不混用租屋規則工具。
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

### 2. Vercel Deployment

Vercel deploys the Vite frontend from `dist` and serves `/api/*` through the
Node 22 CommonJS bundle in `api/[...path].js`. `npm run build` bundles the API
handler and backend dependencies with esbuild; policy JSON is included in that
bundle. The source handler dynamically initializes `src/server.ts` inside its
error boundary. Production requests do not use the local port `8787`.
Set `AGENT_PROVIDER=openai` and `OPENAI_API_KEY` in the Vercel project's
Environment Variables, then redeploy. Optionally set `OPENAI_MODEL` there as well.
The API key is read only by the serverless backend and must not use a `VITE_`
prefix or be added to client-side code.

### 3. Install, Test, Typecheck & Build

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
- `docs/trace-evidence-index.md` — `artifacts/traces/trace-a..l.json`（共 12 份）執行軌跡索引與去識別化驗證
- `docs/backup-demo-video-status.md` — 預錄備援影片狀態評估（`OUTDATED`）與重新錄製規範
- `docs/field-validation-protocol.md` & `docs/field-validation-results-template.md` — 真人交叉實驗設計與空白結果表（`PENDING`）
- `docs/security-self-assessment.md` — 14 項資安、可控性與治理自我評估
- `docs/third-party-resources.md` — 第三方模型、套件、雲端服務與政策來源揭露
- `docs/anonymization-audit.md` — 匿名化提交稽核報告
- `docs/napai-submission-readiness.md` & `docs/competition-evidence-matrix.md` — 決賽提交準備度與評分項目證據矩陣
