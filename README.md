# GovAid Atlas

GovAid Atlas 是一個以規則引擎為核心的政府補助資格預審與申辦導航原型。它支援特定租屋補貼，以及全國適用的未滿 2 歲兒童育兒津貼；Agent 協助理解需求、安排檢查步驟並詢問缺漏資料，資格規則由 deterministic engine 評估。系統不會代替主管機關核定或自動送件。

## What It Does

- 依明確的政策與城市邊界檢查支援範圍；範圍外回傳 `NOT_COVERED` 並提供官方轉介。
- 對租屋政策已編碼條件回報 `PARTIAL_CHECK`、`FAIL` 或 `UNCERTAIN`，避免把部分檢查說成完整資格核准。
- 支援 `CHILDCARE_ALLOWANCE_UNDER_2_115`，檢查月齡、出生／初設戶籍登記、公費安置、公共化／準公共托育及出生胎次。
- 透過 Human Gate 詢問缺漏事實，產生 `ApplicationGuide` 和 Decision Passport；指南含應備文件、申辦方式、官方連結、受理機關與電話、期間與狀態、排除條件、下一步及免責聲明。
- 提供有界限的 Agent tool routing、政策來源、有效期間檢查及去識別化 trace。

## Supported Policies

目前有 **5 個政策 ID**，分屬 HOUSING 與 CHILDCARE 兩個領域。租屋城市支援限於臺北市、新北市及桃園市的下表方案；不代表其他縣市的中央補貼或地方方案均已涵蓋。

| Domain | Policy ID | 支援範圍與政策來源 |
|---|---|---|
| HOUSING | `CENTRAL_RENT_115` | 115 年度中央擴大租金補貼；臺北、新北及桃園受理情境提供部分條件預審。R1：內政部國土管理署，《三百億元中央擴大租金補貼專案計畫作業規定（115年度）》。 |
| HOUSING | `TAIPEI_RENT_115` | 臺北市加碼補貼。R6：臺北市政府都市發展局，《115年度臺北幸福租－民間租屋租金加碼補貼》。 |
| HOUSING | `NEW_TAIPEI_RENT_115` | 新北市青年租金補貼。R7：新北市政府城鄉發展局，《115年度新北市青年租金補貼》。 |
| HOUSING | `TAOYUAN_CENTRAL_RENT_115` | 桃園市受理之中央擴大租金補貼導航及部分條件檢查，包含政策檔所列每人每月平均所得 NT$50,304 門檻。R9：桃園市政府住宅發展處／內政部國土管理署，《300億元中央擴大租金補貼專案計畫－桃園市受理與申辦規定（115年度）》。 |
| CHILDCARE | `CHILDCARE_ALLOWANCE_UNDER_2_115` | 全國育有未滿 2 歲兒童育兒津貼；包括未滿 24 個月、出生或初設戶籍登記、未經政府公費安置、未接受公共化／準公共托育及胎次。R8：衛生福利部社會及家庭署，《育有未滿二歲兒童育兒津貼申領作業要點（115年度適用）》。第 1 胎每月 NT$5,000、第 2 胎 NT$6,000、第 3 胎以上 NT$7,000。 |

托育補助、生育獎勵金、2–4 歲就學補助及其他未列方案不在目前支援範圍。

## How It Works

```text
USER GOAL
  ↓
DOMAIN & COVERAGE BOUNDARY CHECK
  ├─ HOUSING
  ├─ CHILDCARE
  └─ Unsupported policy / city / program → NOT_COVERED + Official Referral
  ↓
Agent Planner → schema / allowlist / state & domain validation
  ↓
Deterministic policy rules + validity checks
  ↓
Human Gate (when facts are missing) → Decision Passport / ApplicationGuide
  ↓
Sanitized Agent Trace
```

### Housing Status Semantics

租屋政策目前只編碼官方資格條件的子集。已編碼規則通過會顯示 `PARTIAL_CHECK`，不等於完整法定資格核准；已編碼條件不符為 `FAIL`，必要資料缺漏為 `UNCERTAIN`，未涵蓋的政策或城市為 `NOT_COVERED`。聚合優先序為 `FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`。**最終核定以主管機關審查為準。** `PASS` 僅供完整編碼政策的規則結果使用；不會用來宣稱租屋方案已完整核准。

## Safety by Design

- **Deterministic Rules：** 最終資格規則、狀態聚合與政策有效期間檢核由程式規則執行，不由 LLM 判定。
- **Human Gate：** 必要事實缺漏時暫停詢問，不以猜測補值；輸入驗證後才接續流程。
- **Bounded Tool Routing：** 僅可選用 11 個 allowlisted tools；另檢查 schema、跨領域工具及狀態轉移，並設有步數上限。
- **Coverage Boundary：** 不支援的方案或城市回報 `NOT_COVERED`，並提供適用的官方查詢入口。
- **Policy Validity：** 依政策有效日期判斷；過期政策不會作為現行通過依據。
- **Sanitized Trace：** trace 匯出會過濾敏感欄位、憑證樣式、系統提示詞與個人資料。
- **Safe Fallback：** Provider 不可用或提案無效時，流程使用 deterministic 安全路徑；不以 fallback 偽裝 LLM 成功。
- **API Input Limits：** Request body 上限 16 KB、goal 上限 800 字元；預設 in-memory per-IP rate limit 為 20 requests / 60 s。

## Agent Provider Architecture

`AGENT_PROVIDER=auto` 的順序為 **OpenAI → Ollama → Deterministic Safety Fallback**。設定範例指定 OpenAI `gpt-5.4-mini` 與 Ollama `qwen3.5:4b`；若未設定 `OPENAI_MODEL`，provider implementation 的程式預設值為 `gpt-4o-mini`。

- **Planner（OpenAI／Ollama）：** intent understanding、planning、tool routing；只提出下一步提案。
- **Deterministic Engine：** 執行最終規則評估、政策有效性判斷及狀態安全不變量；LLM 不可覆寫結果。

> The model plans. The rules decide. The human confirms.

預設單次 provider attempt timeout 為 8,000 ms、整條 provider chain 預算為 10,000 ms，可由環境設定覆寫；不是 15 秒固定 timeout。

## Golden Demo

合成測試人物：20 歲、單身、戶籍臺北市；比較新北市永和區（實際情境）與臺北市文山區（假設搬遷情境）。地址及家庭資料為 synthetic persona，不是真實個案。Housing 結果仍依輸入與已編碼子集呈現 `PARTIAL_CHECK`／`UNCERTAIN` 等狀態。

## Evaluation

`benchmark/results.csv` 中的 deterministic GovAid Atlas runner 與 `LLM_CONTEXT` 比較：

| Metric | LLM + Policy Context | GovAid Atlas |
|---|---:|---:|
| Status Accuracy | 70% | 100% |
| Evidence Coverage | 77.8% | 100% |
| Unsupported Claims | 30% | 0% |
| Unsafe Certainty | 40% | 0% |

**Automated regression tests:** 131 / 131 PASS (`npm.cmd test`); TypeScript check and production build also pass.

> 以上為 10 組 synthetic policy-navigation cases，不代表真實世界整體準確率。比較中的 GovAid Atlas 欄是 deterministic benchmark runner，不是完整 Agent workflow；Gold Standard 為 `PENDING_INDEPENDENT_REVIEW`，Manual baseline 為 pending。

**Measured competition-preparation runs — OpenAI:** Golden Path 5 / 5 completed，median planner latency 約 5.1 s、平均約 5.22 s、fallback 0 / 5，估算總成本 USD 0.009343（平均約 USD 0.001869 / run）。這些特定準備賽事量測**不是 SLA、uptime 保證或一般化 production benchmark**；成本為 token 用量估算，非帳單。詳見 [docs/openai-live-validation.md](docs/openai-live-validation.md)。

**Ollama:** 歷史 demo reliability 紀錄為 5 / 5 completed；暖機後 runs 的 planner latency median 約 63 秒，為本機 CPU 實測，不是延遲保證。詳見 [docs/demo-reliability-wave3.md](docs/demo-reliability-wave3.md)。

## Known Limitations

- Housing 僅檢查已編碼的核心條件；`PARTIAL_CHECK` 不等同完整法定資格核准，最終核定以主管機關審查為準。
- 未列方案與未涵蓋城市不作資格判定；沒有政府系統整合或自動申辦 API。
- Gold Standard 尚待獨立審查（`PENDING_INDEPENDENT_REVIEW`）；Field Validation 與 Manual baseline 均為 `PENDING`。
- RBAC role switching 是 **synthetic front-end masking demonstration**，不是 production authentication、authorization 或正式 IAM。
- Rate limiter 為程序記憶體中的 per-IP 限制，服務重啟後重設；不是分散式 production rate limiting。
- Repository 的提交證據指出公開部署仍需重新部署，未證明與目前 checkout 同步。README 不宣稱該部署正在執行此版本。

## Competition Demo Assets

- **Live Product:** 部署記錄見 [docs/napai-submission-readiness.md](docs/napai-submission-readiness.md)；該文件記載需要 operator redeploy，故目前版本一致性未驗證。
- **Competition Showcase:** [demo/govaid-atlas-competition-showcase.html](demo/govaid-atlas-competition-showcase.html)。
- **Offline / Backup Demo:** 上述單檔 HTML showcase 可離線開啟。此 checkout 未包含 `GovAidAtlas_Final_Backup_Demo.mp4` 或影片 QA record；[docs/backup-demo-video-status.md](docs/backup-demo-video-status.md) 是既有錄影狀態文件，不作為新影片完成的證據。

## Local Setup

需要 Node.js 22。`.env.example` 提供以下設定範例；將它複製為 `.env`，並只在本機設定有效 API key，不要提交 `.env`：

```dotenv
AGENT_PROVIDER=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
```

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

測試、型別檢查與 production build：

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

## Vercel Deployment

Vercel 設定使用 Vite，前端輸出至 `dist`；`npm run build` 會以 esbuild 將 backend handler 打包成 Node 22 CommonJS API functions，包括 `api/[...path].js`，再建置 Vite 前端。此架構由 [vercel.json](vercel.json)、[package.json](package.json)、[api/](api) 及 handler 實作確認。

在 Vercel 專案的 server-side Environment Variables 設定 provider。Serverless 環境中的 `http://127.0.0.1:11434` 不會連到開發者電腦的 Ollama；若需 LLM planner，設定 OpenAI API key/model。未設定可用 provider 時，系統會使用 deterministic fallback。

```dotenv
AGENT_PROVIDER=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
```

## Repository Evidence

- [docs/napai-evaluation-report.md](docs/napai-evaluation-report.md) — benchmark、Agent evaluation 與技術回歸結果。
- [docs/benchmark-methodology.md](docs/benchmark-methodology.md) — benchmark 方法、樣本及結果分類。
- [docs/gold-standard-review-status.md](docs/gold-standard-review-status.md) — Gold Standard 審查狀態與限制。
- [docs/field-validation-protocol.md](docs/field-validation-protocol.md) — Field Validation 設計與待完成狀態。
- [docs/security-self-assessment.md](docs/security-self-assessment.md) — 安全控制、API 限制與 synthetic RBAC 揭露。
- [docs/anonymization-audit.md](docs/anonymization-audit.md) — 匿名化與憑證稽核紀錄。
- [docs/competition-evidence-matrix.md](docs/competition-evidence-matrix.md) — 評審項目與 evidence 對照。
- [src/evidence.ts](src/evidence.ts) 與 [src/policies/](src/policies/) — 政策來源索引與規則資料。
