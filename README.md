# GovAid Atlas

**Evidence-backed, uncertainty-aware Agentic Decision Support for public services**

GovAid Atlas 是一個以政策規則、Agent proposal validation、Human Gate、官方證據與 Decision Passport 為核心的公共服務決策支援系統。
LLM 負責理解需求與提出下一步；系統驗證提案；deterministic rules 負責政策判定與安全邊界。

> The model proposes. The system validates. The rules decide. The human confirms.

GovAid Atlas **不是**政府核定系統：

- 不會自動送出申請；
- 不取代主管機關的正式審查，最終核定以主管機關為準；
- 未涵蓋的政策或城市不作資格判定，而是回報 `NOT_COVERED` 並轉介官方資訊。

## Links

| | |
|---|---|
| **Live Product** | https://govaid-atlas.torchark.tw/ |
| **Repository** | https://github.com/IDK930926/govaid-atlas |
| **Competition Keynote Repo** | https://github.com/ryanwu566/govaid-atlas-keynote |
| **NAPAI 2026** | https://napai.ncu.edu.tw/aaic2026/ |

## Final RC Snapshot

| | |
|---|---|
| Automated tests | **249 / 249 PASS**（`npm.cmd test`，2026-11-18 於 `main` @ `2e5a6d5` 實測） |
| TypeScript | PASS（`npx.cmd tsc --noEmit`） |
| Production build | PASS（`npm.cmd run build`） |
| Final synthetic evaluation | 57 個 production-safe frozen scenarios 中 **52/57 safe completion（91.2%）** — 見 [Final Frozen Evaluation](#final-frozen-evaluation) |
| Human field validation | **NO** — 合成情境評測；非真人場域驗證。 |

## What GovAid Atlas Does

- 使用者以自然語言描述情況，例如「我在永和租屋，戶籍在臺北，想知道能申請哪些補助」。
- Agent 拆解需求、抽取已知事實，並提出下一步。
- 系統逐一驗證每個提案，通過驗證後才執行 deterministic 政策規則。
- 只在真正缺少必要事實時，才透過 Human Gate 詢問使用者。
- 可並列比較 **Actual vs What-if**：目前租屋地與搬遷假設地。
- 每個判定都附上官方證據來源、有效期間與查核日期。
- 最後產生 **Decision Passport**，記錄結果、證據、待確認條件與下一步。

## Agentic Architecture

```text
Goal
  ↓
Proposal      ← model（OpenAI／Ollama）提出下一步
  ↓
Validation    ← validator 接受或駁回提案
  ↓
Execution     ← deterministic rules 執行政策判定
  ↓
Observation   ← 結果、證據、缺漏事實
  ↓
Next State    ← 繼續、Human Gate，或完成並產生 Decision Passport
```

| 角色 | 責任 |
|---|---|
| **Model** | 理解需求並提出下一個 action；只是提案，不直接執行或判定。 |
| **Validator** | 接受或駁回提案，檢查 schema、11 個 allowlisted tools、領域／工具相容性與狀態轉移。若要求重問已知欄位，以「該資料已由使用者提供，不得重問」駁回；若在規則評估前要求完成，以「尚未完成資格檢核，不得直接完成」駁回。 |
| **Deterministic rules** | 執行政策語意、資格條件、政策有效期間與狀態聚合；LLM 不可覆寫結果。 |
| **Human Gate** | 只在必要事實真正缺漏時詢問；回答後接續同一個案件。 |
| **Decision Passport** | 記錄結果、證據、待確認條件與下一步。 |

### Provider

`AGENT_PROVIDER=auto` 依序嘗試 OpenAI、Ollama。

- Provider 不可用或提案無效時，會改走 validated fallback／deterministic workflow，不會把 fallback 包裝成 LLM 成功。
- Production 的 provider 可用性取決於執行環境，以執行時 `/api/health` 為準。
- 預設單次 provider attempt timeout 為 8,000 ms，整條 provider chain 預算為 10,000 ms，兩者都可由環境變數覆寫。
- 未設定 `OPENAI_MODEL` 時，程式預設為 `gpt-4o-mini`；`.env.example` 範例使用 `gpt-5.4-mini`。

## Final Frozen Evaluation

> **合成情境評測；非真人場域驗證。**
> **Synthetic evaluation; not human field validation.**

**評測範圍**

| 項目 | 數量 |
|---|---|
| Frozen synthetic scenarios | 60 |
| Production-safe primary cases | 57 |
| Reproducibility runs | 30 |
| Raw evaluation records（已取回並完成完整性檢查） | 87 / 87 |

改善前後使用同一組 frozen cases、同一套評分規則，且未移除任何失敗案例。

**Before → After**

| Metric | Before | After |
|---|---:|---:|
| Frozen-rubric E2E | 5/57（8.8%） | **21/57（36.8%）** |
| Primary product task completion | 未另行量測 | **39/57（68.4%）** |
| Safe completion | 10/57（17.5%） | **52/57（91.2%）** |
| Known-field re-asks | 約 42/48 | **0/16** |
| Reproducibility：符合安全預期 | 8/30（26.7%） | **27/30（90.0%）** |
| 首個可用畫面延遲 median | 2.35 s | 2.54 s |
| 首個可用畫面延遲 p95 | 3.47 s | 3.35 s |

**如何解讀**

- **91.2% 是 safe completion，不是準確率。** 意思是：在 57 個 production-safe frozen synthetic scenarios 中，52 個安全完成。
- **Known-field re-asks 0/16，但 Human Gate 並非全部完美。** 有 2/16 個第一個 gate 仍問了不相關或錯位的問題。
- **延遲大致持平**，同時安全性與正確性提升。

**Safety observations**

- **0/57** observed unsafe certainty
- **0/41** observed Decision Passport contradictions

**這份評測不代表：**

- 不是 57 位或 60 位使用者，沒有真人受試者參與。
- 不構成 Level 3 human validation：`HUMAN_FIELD_VALIDATION = NO`、`LEVEL_3_CLAIM_FROM_THIS_STUDY = NOT_SUPPORTED`。
- 不證明普遍的資格判定準確率。

最終 frozen evaluation 的原始紀錄未收錄於本 repository。

### Remaining Failures

原始 frozen rubric 下仍有 **35 個 FAIL**：

| 類別 | 數量 |
|---|---:|
| Policy coverage | 17 |
| Protocol incompatibility | 6 |
| Routing | 5 |
| UI | 5 |
| Planner | 2 |

目前最大的限制是政策的明確涵蓋範圍。

> We expose the boundary instead of fabricating an answer.

## Supported Policies

目前有 5 個政策 ID，分屬 HOUSING 與 CHILDCARE 兩個領域。租屋只支援下表中臺北市、新北市與桃園市的方案，不代表其他縣市的方案已經涵蓋。

| Domain | Policy ID | 方案與證據來源 |
|---|---|---|
| HOUSING | `CENTRAL_RENT_115` | 115 年度 300 億元中央擴大租金補貼，部分條件預審。**R1**：內政部國土管理署《三百億元中央擴大租金補貼專案計畫作業規定》，依國土管理署官方法規頁（115.1.9 修正版），並附行政院公報與內政部不動產資訊平台佐證。 |
| HOUSING | `TAIPEI_RENT_115` | 臺北市加碼補貼。**R6**：臺北市政府都市發展局《115年度臺北幸福租－民間租屋租金加碼補貼》。設籍條件依 `registeredCity` 判斷，不以租屋地或搬遷假設地取代。 |
| HOUSING | `NEW_TAIPEI_RENT_115` | 新北市青年租金補貼。**R7**：新北市政府城鄉發展局《**116年度新北市青年租金補貼**》（新北城住字第1151855676號公告），受理期間 115/10/1 起至 116/12/31 止，或至經費用罄為止。 |
| HOUSING | `TAOYUAN_CENTRAL_RENT_115` | 桃園市受理的中央租金補貼導航與部分條件檢查，包含每人每月平均所得 NT$50,304 門檻。**R9**：桃園市政府住宅發展及都市更新處受理公告，資格規則依 R1。 |
| CHILDCARE | `CHILDCARE_ALLOWANCE_UNDER_2_115` | 育有未滿 2 歲兒童育兒津貼。**R8**：衛生福利部社會及家庭署。第 1 名子女每月 NT$5,000、第 2 名 NT$6,000、第 3 名以上 NT$7,000。 |

> **關於 `NEW_TAIPEI_RENT_115`：** Internal policy identifier retains its historical name; the current R7 evidence and validity window correspond to the 116年度 program.
> 也就是說，內部政策 ID 與檔名（`new-taipei-rent-115.json`）沿用歷史名稱，但目前的 R7 證據、方案名稱與有效期間對應 116年度方案。115年度方案已依同一公告於 115/10/1 停止受理。

托育補助、生育獎勵金、2–4 歲就學補助等未列方案，不在支援範圍內。

### 中央租金補貼金額（安全呈現）

附表四每月補貼上限：

| 地區 | 第一級 | 第二級 | 第三級 |
|---|---:|---:|---:|
| 臺北市 | NT$8,000 | NT$5,000 | NT$3,000 |
| 新北市主要行政區（含永和區） | NT$5,000 | NT$4,000 | NT$2,400 |

- **系統不判定級距。** 級距需要家庭人數、低收／中低收入戶或社會弱勢身分等事實，系統未取得這些事實時不會判定。試算以「**第三級基準（級距未判定）**」標示，只供比較，不代表申請人的實際級距就是第三級。
- **加碼倍數依日期而定。** 新婚與育兒加碼倍數，取決於結婚登記日或新生兒出生日是否在 115/1/1 以後。系統未取得這些日期時，只列出兩種倍數表，**不會把任何倍數當成已適用的事實**。

## Status Semantics

| 狀態 | 意義 | 指引內容 |
|---|---|---|
| `PASS` | 完整編碼的政策規則通過（目前用於育兒津貼） | 正常申請路徑 |
| `PARTIAL_CHECK` | 租屋方案已編碼的條件子集通過，不等於完整法定資格 | 條件式指引，標示「尚非核准」 |
| `UNCERTAIN` | 必要事實缺漏或無法確認 | 條件式指引，先完成待確認條件 |
| `FAIL` | 已編碼條件不符 | 建議停止申請此方案。不顯示金額、金額公式、送件 CTA，也不把文件清單當成申請建議；官方聯絡資訊只保留作為查證參考 |
| `NOT_COVERED` | 政策或城市不在支援範圍 | 僅供參考，附官方轉介 |

聚合優先序：`FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS`。

## Safety & Governance

**Current hardening**

- 事實分為 known／unknown／conflict 三種型別狀態：`KNOWN_TRUE`、`KNOWN_FALSE`、`KNOWN_VALUE`、`UNKNOWN`、`CONFLICT`。
- 明確處理否定語句，例如「沒有自有住宅」。
- 數值依欄位就近抽取（numeric field-local extraction）。
- 推斷縣市與行政區。
- 拆解混合範圍的需求（mixed-scope decomposition）。
- 駁回重問已知欄位的提案。
- 駁回在評估前就要求完成的提案。
- 驗證領域與工具。
- 以官方證據為依據執行 deterministic rules。
- 依判定結果調整指引內容（verdict-aware guidance）。
- 去識別化 trace，過濾敏感欄位、憑證樣式、系統提示詞與個人資料，也不輸出模型的 chain-of-thought。

**Human Gate**

- `true` 與 `false` 都算已知值。例如使用者說「沒有自有住宅」，就不會再被問一次。
- 已知欄位不重問。
- 真正未知的必要事實才進入 Human Gate。
- 互相矛盾的事實會要求釐清。
- 回答後接續同一個案件，不會重新開始。
- 最終 production 觀察：**Known-field re-asks 0/16**。其中 2/16 個第一個 gate 仍問了不相關或錯位的問題。

**Other controls**

- **Policy validity：** 依政策有效日期判斷，過期政策不作為現行通過依據。
- **API limits：** request body 上限 16 KB，goal 上限 800 字元，預設每個 IP 每 60 秒 20 次請求（in-memory rate limit）。

## Recommended Demo Cases

| Case | 流程 | Takeaway |
|---|---|---|
| **H04** | 模型提出不必要的 action（重問已知欄位），validator 駁回。 | *The model proposes. The system validates.* |
| **C01** | 模型提出過早完成，validator 駁回，接著執行育兒津貼規則。 | *Completion is validated, not trusted.* |
| **Dual-city** | Human Gate → Resume → Actual vs What-if → Evidence → Decision Passport | *Ask before assuming.* |

Dual-city 使用 synthetic persona：戶籍臺北市，目前租屋於新北市永和區，假設搬遷至臺北市文山區。這不是真實個案。

`registeredCity`（戶籍）、`actual`（目前租屋地）與 `what-if`（搬遷假設地）是三個獨立欄位。

## Known Limitations

- **政策涵蓋範圍是目前最大的限制。** 只支援上表 5 個政策 ID，其他方案與縣市一律回報 `NOT_COVERED`。
- **租屋只檢查已編碼的核心條件。** `PARTIAL_CHECK` 不等於完整法定資格核准，也不判定補貼級距與加碼倍數。
- **未經真人驗證。** 沒有真人場域驗證，`HUMAN_FIELD_VALIDATION = NO`；Gold Standard 尚未經獨立審查（見 [docs/gold-standard-review-status.md](docs/gold-standard-review-status.md)）。
- **沒有政府系統整合。** 沒有政府系統整合或自動申辦 API。
- **RBAC 只是展示。** RBAC role switching 是 synthetic front-end masking demonstration，不是正式的驗證或授權機制。
- **Rate limit 不是分散式的。** Rate limiter 存在程序記憶體中，服務重啟後重設。

## Local Setup

需要 Node.js 22。將 `.env.example` 複製為 `.env`，只在本機設定 API key，不要提交 `.env`：

```dotenv
AGENT_PROVIDER=auto
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
PORT=8787
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

- Vercel 使用 Vite，前端輸出至 `dist`。
- `npm run build` 會先以 esbuild 將 backend handler 打包成 Node 22 CommonJS API functions（`api/`），再建置前端。設定見 [vercel.json](vercel.json) 與 [package.json](package.json)。
- 在 Vercel 的 server-side Environment Variables 設定 provider。Serverless 環境中的 `http://127.0.0.1:11434` 不會連到開發者電腦上的 Ollama。若沒有可用的 provider，系統會改走 deterministic fallback。

## Repository Evidence

**Current**

- [src/evidence.ts](src/evidence.ts)、[src/policies/](src/policies/)：政策來源索引（R1、R6–R9）與規則資料。
- [docs/security-self-assessment.md](docs/security-self-assessment.md)：安全控制與 API 限制。
- [docs/field-validation-protocol.md](docs/field-validation-protocol.md)：Field validation 設計（尚未執行）。
- [docs/gold-standard-review-status.md](docs/gold-standard-review-status.md)：Gold Standard 審查狀態與限制。
- [docs/anonymization-audit.md](docs/anonymization-audit.md)：匿名化與憑證稽核。
- [artifacts/traces/](artifacts/traces/)：去識別化 Agent trace 範例。

**Historical / frozen evidence**

以下文件保留較早階段的量測紀錄以供稽核，**不是**目前 Final RC 的結果：

- [docs/napai-evaluation-report.md](docs/napai-evaluation-report.md)、[docs/benchmark-methodology.md](docs/benchmark-methodology.md)：早期 10 組 synthetic benchmark（`benchmark/`）。
- [docs/openai-live-validation.md](docs/openai-live-validation.md)：早期 OpenAI 準備賽事量測。
- [docs/demo-reliability-wave3.md](docs/demo-reliability-wave3.md)：早期 Ollama 本機 demo 紀錄。
- [docs/final-rc-version.json](docs/final-rc-version.json)：較早的 RC 快照（測試數已過時）。
- [demo/govaid-atlas-competition-showcase.html](demo/govaid-atlas-competition-showcase.html)：可離線開啟的早期單檔 showcase。
