# Shot List

> 來源：`raw/golden-path.mkv`（OBS 錄一次完整、不中斷的 live UI 執行）＋ `raw/cards.mkv`（`recording-page.html`）。
> 下表的時間碼指**成片**時間，不是原始錄影的時間。全片右上角疊加 `預錄畫面 · PRE-RECORDED`。

### Shot 01
- **Duration:** 0:00–0:07（7s）
- **Screen area:** `recording-page.html` 開場卡（0:00–0:02）→ live UI Hero
- **Action:** 開場卡淡入後切到 Hero，畫面靜止
- **Narration:** 「GovAid Atlas 是一個可追溯、可暫停、可人工確認的政府補助 AI Agent。」
- **Caption:** GovAid Atlas：可追溯、可暫停、可人工確認的政府補助 AI Agent
- **Mouse:** 游標移出畫面或隱藏
- **Transition:** 0.3s 交叉淡化（卡片 → Hero）

### Shot 02
- **Duration:** 0:07–0:16（9s）
- **Screen area:** 申請目標輸入區＋Synthetic Persona 提示＋Provider `AVAILABLE`
- **Action:** Golden Goal 已預先填入 → 停 3 秒讓觀眾讀 → 點「執行 Agent」
- **Narration:** 「LLM 只負責理解使用者目標與調度工具，資格結果仍交由 deterministic rules 判定。」
- **Caption:** LLM 負責理解目標與調度工具／資格結果由 deterministic rules 判定
- **Mouse:** 平順移到「執行 Agent」，單擊一次（開啟 OBS 點擊高亮）
- **Transition:** 硬切

### Shot 03
- **Duration:** 0:16–0:29（13s）
- **Screen area:** Agent Journey＋Current Step＋Last Tool
- **Action:** 等待 理解目標 → 規劃 → 工具執行 → `evaluate_central_rules` → `UNCERTAIN` → Human Gate 亮起
- **Narration:** 「必要條件不足時，Agent 不會自行猜測，而是停止推論並要求人工確認。」
- **Caption:** 必要條件不足 → UNCERTAIN／Agent 停止推論，進入 Human Gate
- **Mouse:** none
- **Transition:** 輕微硬切；若等待段落經加速，左下角疊 `畫面加速 ×N`

### Shot 04
- **Duration:** 0:29–0:38（9s）
- **Screen area:** Human Gate 卡片「本人是否持有住宅？」→ 狀態列
- **Action:** 點「無自有住宅」→ 狀態「繼續執行 / Resuming」→ 中央規則 `PASS`
- **Narration:** 「人工補充關鍵資料後，Agent 才能繼續。」
- **Caption:** 人工確認：無自有住宅 → Resume → 中央規則 PASS
- **Mouse:** 移到「無自有住宅」，單擊一次
- **Transition:** 硬切；Resume 後的推論等待可加速並標示

### Shot 05
- **Duration:** 0:38–0:51（13s）
- **Screen area:** 居住情境比較（ACTUAL／WHAT-IF 兩欄）
- **Action:** 捲到比較區，兩欄的中央 `PASS`、地方 `UNCERTAIN` 都入鏡 ≥ 2 秒
- **Narration:** 「即使中央條件通過，地方必要條件還沒確認時，系統仍維持 UNCERTAIN。」
- **Caption:** ACTUAL 新北 13,500 元｜WHAT-IF 臺北 15,500 元／中央 PASS，地方仍 UNCERTAIN
- **Mouse:** 滾輪慢速捲動，游標停在空白處
- **Transition:** 捲動銜接（不剪）

### Shot 06
- **Duration:** 0:51–1:03（12s）
- **Screen area:** Decision Passport：待確認事項 → 風險 → 下一步 → 政策依據（R1/R6/R7）
- **Action:** 依序捲動，每區停 2–3 秒，最後停在 Evidence
- **Narration:** 「最後產出可追溯的 Decision Passport，告訴使用者缺什麼、風險在哪、下一步怎麼做，以及每個判斷的官方依據。」
- **Caption:** Decision Passport：待確認事項・風險・下一步・政策依據（R1／R6／R7）
- **Mouse:** 滾輪慢速捲動；不要 hover 到官方連結（避免出現網址預覽）
- **Transition:** 捲動銜接 → 硬切

### Shot 07
- **Duration:** 1:03–1:13（10s）
- **Screen area:** 治理與評測 → Benchmark 分頁
- **Action:** 點 Benchmark 分頁（若不是預設分頁）→ 三項指標與免責聲明完整入鏡
- **Narration:** 「在目前十組合成測試中，GovAid Atlas 降低了無依據主張與過度確定。」
- **Caption:** 10 組合成政策導航案例，不代表真實世界整體準確率。
- **Mouse:** 可點分頁一次，之後移開
- **Transition:** 硬切；可以在後製輕推放大（≤ 110%），但不得遮住免責聲明

### Shot 08
- **Duration:** 1:13–1:18（5s）
- **Screen area:** `recording-page.html` 結尾卡
- **Action:** 靜止
- **Narration:** 「不讓 AI 猜得更肯定，而是讓每一步更可驗證。」
- **Caption:** 安全優先於過度確定 · Safety Before Certainty
- **Mouse:** none（隱藏）
- **Transition:** 0.3s 淡入結尾卡；最後 0.5s 聲音淡出

---

## 必拍素材清單

| 素材 | 來源 | 用於 |
|---|---|---|
| 開場卡 8s | `recording-page.html` → `1` | Shot 01 |
| 結尾卡 8s | `recording-page.html` → `2` | Shot 08 |
| Golden Path 完整錄影（約 2–4 分鐘） | live UI | Shot 01–07 |
| 旁白 WAV（48 kHz） | 錄音 | 全片 |
| （備用）預錄說明卡 | `recording-page.html` → `3` | 現場切換時的過場，可選用 |
