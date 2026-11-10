# Storyboard — 78 秒備援 Demo

> 原始需求的段落加總為 85 秒。為了貼近 75 秒的目標，每段各縮 1–2 秒，總長 **78 秒**（在 60–90 秒的允許範圍內）。
> 所有產品畫面都來自真實 live UI 的錄影。畫面標籤以 `src/App.tsx` 和 `src/ui-copy.ts` 的實際文字為準。

| # | 時間 | 長度 | 場景 |
|---|---|---|---|
| S1 | 0:00–0:07 | 7s | Hero／開場 |
| S2 | 0:07–0:16 | 9s | 申請目標 → 執行 Agent |
| S3 | 0:16–0:29 | 13s | Agent Journey → UNCERTAIN → Human Gate |
| S4 | 0:29–0:38 | 9s | 人工確認 → Resume → 中央 PASS |
| S5 | 0:38–0:51 | 13s | ACTUAL vs WHAT-IF |
| S6 | 0:51–1:03 | 12s | Decision Passport |
| S7 | 1:03–1:13 | 10s | Benchmark |
| S8 | 1:13–1:18 | 5s | Ending |

---

## S1 · 0:00–0:07 · Hero

- **畫面：** `recording-page.html` 開場卡（1–2 秒）→ 切到 live UI 的 Hero 區。
- **畫面重點：** Hero 副標「Agent 規劃 × 規則引擎 × 官方證據 × 人工覆核」。
- **旁白：** 「GovAid Atlas 是一個可追溯、可暫停、可人工確認的政府補助 AI Agent。」
- **字幕（關鍵詞）：** Agent Planning · Deterministic Rules · Official Evidence · Human Review
- **標示：** 右上角 `預錄畫面 · PRE-RECORDED`

## S2 · 0:07–0:16 · 申請目標

- **畫面：** 申請目標輸入區，Golden Goal 已預先填入：
  > 我目前住在新北市永和區，每月租金 13,500 元。如果搬到臺北市文山區、租金 15,500 元，我有哪些租屋補助可以考慮？還缺什麼資料？
- **必須入鏡：** 「合成示範資料 Synthetic Persona」提示、Provider 狀態 `AVAILABLE`。
- **動作：** 滑鼠移到「執行 Agent / Run Agent」→ 點擊。
- **旁白：** 「LLM 只負責理解使用者目標與調度工具，資格結果仍交由 deterministic rules 判定。」

## S3 · 0:16–0:29 · Agent Journey → Human Gate

- **畫面：** Agent Journey：理解目標 → 規劃 → 工具執行 → 人工確認（Human Gate）。
- **必須入鏡：** Last Tool 為 `evaluate_central_rules`（中央補助規則檢查）、結果 `UNCERTAIN`、狀態「需要人工確認」。
- **剪輯：** 模型推論等待可加速 ×2–×4，左下角標示 `畫面加速 ×N`。
- **旁白：** 「必要條件不足時，Agent 不會自行猜測，而是停止推論並要求人工確認。」

## S4 · 0:29–0:38 · Human Gate → Resume

- **畫面：** Human Gate 問題「本人是否持有住宅？」
- **動作：** 點「無自有住宅」。
- **必須入鏡：** 狀態轉為「繼續執行 / Resuming」，中央規則 `PASS`。
- **旁白：** 「人工補充關鍵資料後，Agent 才能繼續。」

## S5 · 0:38–0:51 · ACTUAL vs WHAT-IF

- **畫面：** 居住情境比較（Scenario Comparison），兩欄並排。

| | ACTUAL（實際情境） | WHAT-IF（假設情境） |
|---|---|---|
| 地址 | 新北市永和區 | 臺北市文山區 |
| 租金 | 13,500 元 | 15,500 元 |
| 中央 | PASS | PASS |
| 地方 | 新北 UNCERTAIN | 臺北 UNCERTAIN |

- **動作：** 慢速捲動，讓兩欄的狀態徽章都停留 ≥ 2 秒。
- **旁白：** 「即使中央條件通過，地方必要條件還沒確認時，系統仍維持 UNCERTAIN。」

## S6 · 0:51–1:03 · Decision Passport

- **畫面：** 申辦決策護照（Decision Passport），依序帶到：
  待確認事項 Missing Items → 風險 Risks → 下一步 Next Steps → 政策依據 Evidence（R1、R6、R7）。
- **動作：** 每個區塊約停 2–3 秒；Evidence 區要讓 R1／R6／R7 和來源機關清楚可讀。
- **旁白：** 「最後產出可追溯的 Decision Passport，告訴使用者缺什麼、風險在哪、下一步怎麼做，以及每個判斷的官方依據。」

## S7 · 1:03–1:13 · Benchmark

- **畫面：** 治理與評測 → Benchmark 分頁，標題「安全優先於過度確定」。

| 指標 | LLM + Policy Context | GovAid Atlas |
|---|---|---|
| Status Accuracy | 70% | 100% |
| Unsupported Claim | 30% | 0% |
| Unsafe Certainty | 40% | 0% |

- **必須入鏡且清楚可讀（≥ 3 秒）：** 「10 組合成政策導航測試案例，不代表真實世界整體準確率。」
- **旁白：** 「在目前十組合成測試中，GovAid Atlas 降低了無依據主張與過度確定。」

## S8 · 1:13–1:18 · Ending

- **畫面：** `recording-page.html` 結尾卡。
- **主標：** 安全優先於過度確定 · Safety Before Certainty
- **副標：** 不讓 AI 猜得更肯定，而是讓每一步更可驗證。
- **旁白：** 「不讓 AI 猜得更肯定，而是讓每一步更可驗證。」
- **結尾：** 停在結尾卡 1 秒，聲音淡出，不放音樂高潮。
