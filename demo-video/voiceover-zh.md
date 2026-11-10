# 旁白稿（繁體中文）

> 語氣：專業、平穩、說明式。不要有廣告腔，不用「顛覆」「革命性」之類的詞。
> 語速：約每秒 4.5 字（英文術語以 1 詞計），句間留 0.5–1 秒，讓畫面自己說話。
> 英文術語照原文念：Agent、deterministic rules、UNCERTAIN、PASS、Decision Passport、GovAid Atlas。

| 段 | 時間 | 旁白 | 旁白起點 |
|---|---|---|---|
| S1 | 0:00–0:07 | GovAid Atlas 是一個可追溯、可暫停、可人工確認的政府補助 AI Agent。 | 0:00.4 |
| S2 | 0:07–0:16 | LLM 只負責理解使用者需求與調度工具，資格判定交由 deterministic rules 執行。 | 0:07.4 |
| S3 | 0:16–0:29 | 必要資料不足時，Agent 不會自行猜測，而是停止推論，並要求人工確認。 | 0:18.8 |
| S4 | 0:29–0:38 | 人工補充關鍵資料後，Agent 才繼續執行後續分析。 | 0:29.8 |
| S5 | 0:38–0:51 | 即使中央條件通過，地方必要條件尚未確認時，系統仍維持 UNCERTAIN。 | 0:41.0 |
| S6 | 0:51–1:03 | 最後產出可追溯的 Decision Passport，讓使用者知道缺什麼、風險在哪、下一步怎麼做，以及每個判斷的官方依據。 | 0:51.4 |
| S7 | 1:03–1:13 | 在目前十組合成測試中，GovAid Atlas 降低了無依據主張與過度確定。 | 1:03.6 |
| S8 | 1:13–1:18 | GovAid Atlas 不讓 AI 猜得更肯定，而是讓每一步都更可驗證。 | 1:12.3 |

> S7 的「10 組合成案例，不代表真實世界整體準確率」改由字幕（1:09.2–1:12.9）與 Benchmark 畫面本身的英文聲明呈現，旁白不重複。

## 連續稿（錄音用）

GovAid Atlas 是一個可追溯、可暫停、可人工確認的政府補助 AI Agent。

LLM 只負責理解使用者需求與調度工具，資格判定交由 deterministic rules 執行。

必要資料不足時，Agent 不會自行猜測，而是停止推論，並要求人工確認。

人工補充關鍵資料後，Agent 才繼續執行後續分析。

即使中央條件通過，地方必要條件尚未確認時，系統仍維持 UNCERTAIN。

最後產出可追溯的 Decision Passport，讓使用者知道缺什麼、風險在哪、下一步怎麼做，以及每個判斷的官方依據。

在目前十組合成測試中，GovAid Atlas 降低了無依據主張與過度確定。

GovAid Atlas 不讓 AI 猜得更肯定，而是讓每一步都更可驗證。

## 字數（最終版）

- 中文字（不含標點與英文）：**189 字**
- 英文術語：約 15 個（GovAid Atlas、AI Agent、LLM、deterministic rules、UNCERTAIN、Decision Passport 等）
- 實際語音長度（去頭尾靜音）：S1 6.3s・S2 7.4s・S3 6.8s・S4 4.6s・S5 6.4s・S6 10.1s・S7 6.2s・S8 5.2s，合計約 53 秒；每段都短於畫面，留白給畫面。

## 最終成品使用的語音

- 引擎：Windows 內建 OneCore 語音 **Microsoft Yating（zh-TW）**，透過 `Windows.Media.SpeechSynthesis` 在本機合成（不連網、不需 API key），腳本見 [`pipeline/tts-onecore.ps1`](pipeline/tts-onecore.ps1)。
- 語速 `prosody rate=1.05`；TTS 文字將 `GovAid` 寫成 `Gov Aid`、`UNCERTAIN` 寫成小寫，避免逐字母拼讀。
- 混音：48 kHz、highpass 70 Hz、`loudnorm I=-16 LUFS / TP=-1.5 dBTP`；成品實測 −15.8 LUFS、峰值 −4.5 dBFS。
- 若時間允許，可依本稿錄真人旁白取代（存 `raw/voiceover.wav`），再用 README 的混音指令重混。

## 錄音注意

- 用安靜房間、近距離麥克風，存 48 kHz WAV。
- 每段分開錄，方便對齊畫面。
- 錄音檔不得含旁人聲音、姓名、學校名稱。
- 如果當次 live 執行的狀態和本稿不同，**改稿配合畫面**，不要改畫面。
