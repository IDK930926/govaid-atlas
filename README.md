# GovAid Atlas

GovAid Atlas 是育兒／租屋補助資格預審與申辦導航的概念 Demo；目前完成的 P0 範圍聚焦於租金補貼 Golden Case，以 deterministic Rules Engine 執行明確的資格條件判斷。此版本以本機 React UI 呈現流程，尚未串接 LLM、Agent orchestration service 或政府系統。

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

目前 P0 流程由明確的 UI 操作驅動；上圖描述的是 Demo 的案例處理步驟，不代表已整合 LLM 或獨立 Agent orchestration。

## Policy Sources

目前示範的政策來源索引：

- R1：中央租金補貼官方資料
- R6：臺北市住宅租金加碼補貼官方資料
- R7：新北市青年租金補貼官方資料

來源連結及規則子集分別記錄於 `src/evidence.ts` 與 `src/policies/`。目前政策規則只實作決賽 P0 所需子集，不代表完整政府資格審查系統；政策可能更新，使用前應再次查核最新官方資訊。

## Important Limitations

- GovAid Atlas 僅提供資格預審與申辦導航，不代表主管機關核准。
- 未串接任何政府系統或政府 API。
- 不使用真實個資；Demo 使用 Synthetic Persona。
- 目前只完成 P0 Golden Case。
- 此版本尚未串接 LLM、Agent orchestration service。
- Rule Conflict、Permission / Role control、Token / Cost evaluation、Benchmark 尚未完成。
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
