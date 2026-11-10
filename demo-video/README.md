# GovAid Atlas — 備援 Demo 影片製作包（NAPAI 決賽）

> 用途：正式 5 分鐘 Live Demo 失效時，立即播放的 **78 秒「濃縮版產品操作證據」**。
> 這不是宣傳廣告；影片中的每一個產品畫面都必須來自真實執行的 GovAid Atlas live UI。

| 項目 | 規格 |
|---|---|
| 目標長度 | **78 秒**（允許 60–90 秒） |
| 解析度 | 1920×1080，16:9 |
| 影格率 | 30 fps |
| 編碼 | H.264（yuv420p）+ AAC 48 kHz，`-movflags +faststart` |
| 旁白 | 繁體中文，見 [`voiceover-zh.md`](voiceover-zh.md) |
| 字幕 | 燒入字幕＋另附 [`captions.srt`](captions.srt) |
| 錄影來源 | 真實 GovAid Atlas live UI（Synthetic Persona、本機 Ollama provider） |

## 最終成品（已產出）

| 項目 | 結果 |
|---|---|
| 檔案 | `demo-video/final/GovAidAtlas_Final_Backup_Demo.mp4`（另有無旁白版 `GovAidAtlas_Final_Backup_Demo_noVO.mp4`） |
| 長度／規格 | 78.000 s・1920×1080・30 fps（2340 frames）・H.264 High yuv420p・AAC-LC 48 kHz stereo・faststart・約 8.5 MB |
| 錄影來源 | `https://govaid.torchark.tw` 公開網站，Provider `OPENAI CLOUD gpt-5.4-mini · AVAILABLE`，一次不中斷的真實 Golden Path |
| 加速 | **無**。所有片段 1× 播放；模型等待（約 5.4 秒）完整保留。場景之間只有 clean cut（跳過靜止停留），未加 TIMELAPSE 標示是因為沒有任何片段被加速 |
| 旁白 | Windows OneCore「Yating」zh-TW 本機 TTS（見 `voiceover-zh.md`） |
| 字幕 | 燒入 14 段字幕（每段 ≤ 2 行）＋ sidecar `captions.srt` |
| 預錄標示 | 全片右上角 `預錄畫面 · PRE-RECORDED` |
| QA 紀錄 | [`final/QA-report.md`](final/QA-report.md)、剪輯表 [`final/edl.json`](final/edl.json) |

成品 MP4 依 `demo-video/.gitignore` 不進 git；請複製到比賽筆電桌面、USB、第二台裝置三份。

### 自動化製作流程（[`pipeline/`](pipeline/)）

1. `record-golden-path.mjs`：Playwright 開啟真實網站（1920×1080、無瀏覽器外框、無個人 profile），以 CDP screencast 錄下整條 Golden Path，並記錄每個操作的時間戳。為了在 headless 畫面中看得到滑鼠，注入一個 `pointer-events:none` 的游標圓點，不改動任何產品 DOM 或邏輯。
2. `render-card.mjs`：把 `recording-page.html` 的結尾卡（`#2`）輸出成 1920×1080 圖。
3. `tts-onecore.ps1`：逐段合成旁白。
4. `build-edit.mjs`：依剪輯表把原始 screencast 影格組成 30 fps 時間軸，並產生 ASS 字幕（含預錄標示）與 `captions.srt`。
5. ffmpeg：先輸出無字幕的高品質 intermediate，再燒入字幕並混入旁白（兩段式，避免靜止畫面複製影格時字幕不更新）。

```bash
# 混音（各段旁白已去頭尾靜音，adelay 為旁白起點毫秒）
ffmpeg -i s1_t.wav ... -i s8_t.wav -filter_complex "[0]aresample=48000,adelay=400:all=1[a0];...;[a0]...[a7]amix=inputs=8:normalize=0,highpass=f=70,apad=whole_dur=78,atrim=0:78,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st=77.7:d=0.3[out]" -map "[out]" vo_mix.wav
# intermediate
ffmpeg -f concat -safe 0 -i video.ffconcat -vf "fps=30,scale=1920:1080:in_range=pc:out_range=tv,format=yuv420p" -c:v libx264 -crf 8 -an inter.mp4
# 成品（清除 metadata）
ffmpeg -i inter.mp4 -i vo_mix.wav -vf "ass=subs.ass" -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -color_range tv -r 30 -c:a aac -b:a 192k -ar 48000 -map_metadata -1 -map_chapters -1 -fflags +bitexact -movflags +faststart GovAidAtlas_Final_Backup_Demo.mp4
```

## 檔案

| 檔案 | 內容 |
|---|---|
| [`storyboard.md`](storyboard.md) | 8 個場景的畫面、旁白、字幕與真實性要求 |
| [`shot-list.md`](shot-list.md) | 逐鏡錄影規格：時間碼、畫面區塊、動作、滑鼠、轉場 |
| [`voiceover-zh.md`](voiceover-zh.md) | 完整繁中旁白稿、字數與語速 |
| [`captions.srt`](captions.srt) | 對齊 78 秒剪輯的字幕 |
| [`recording-checklist.md`](recording-checklist.md) | 錄影前／中／後檢查清單 |
| [`anonymity-checklist.md`](anonymity-checklist.md) | 匿名與機密資訊逐格檢查 |
| [`recording-page.html`](recording-page.html) | 開場卡、結尾卡與「預錄畫面」標示卡（本機開啟，無外部依賴） |

> `raw/` 與 `build/` 已在 `demo-video/.gitignore` 中排除，原始錄影與輸出的 MP4 **不進 git**。

## 製作流程

1. 依 [`recording-checklist.md`](recording-checklist.md) 準備環境，並確認 Ollama 狀態為 `AVAILABLE`。
2. 用瀏覽器開啟 `recording-page.html`，以全螢幕錄下開場卡（`1`）與結尾卡（`2`）各 8 秒。
3. 用 OBS 錄一次**完整、不中斷**的 Golden Path（Run Agent → Human Gate → Resume → Passport → Benchmark tab），存到 `demo-video/raw/golden-path.mkv`。建議錄 2–3 次，挑最乾淨的一次。
4. 依 [`shot-list.md`](shot-list.md) 剪出 8 個鏡頭；模型等待段落可加速，但畫面必須標示 `畫面加速 ×N`。
5. 錄旁白（[`voiceover-zh.md`](voiceover-zh.md)），存成 `raw/voiceover.wav`。
6. 用下方 ffmpeg 指令組裝、燒入字幕、壓縮。
7. 依 [`anonymity-checklist.md`](anonymity-checklist.md) 逐格檢查成品，**兩個人各看一次**。
8. 成品存在：比賽筆電桌面＋USB 隨身碟＋第二台裝置（三份）。

## 真實性規則（必讀）

- 只錄**真實執行中**的 GovAid Atlas。不得以靜態截圖、設計稿、手改 DOM 或 AI 生成畫面冒充 Live Agent 執行。
- 時間壓縮（等待模型回應）可以做，但必須在畫面角落標示 `畫面加速 ×2` 之類的字樣，不得暗示模型反應速度。
- 若改用 Offline HTML Demo 錄製，整支影片必須持續顯示 **`OFFLINE DEMO`**，旁白不得說「LLM 正在推論」。
- 全片右上角持續顯示 `預錄畫面 · PRE-RECORDED`，避免評審誤認為現場執行。
- 旁白與字幕必須**與畫面實際顯示的結果一致**。若當次執行的狀態和腳本不同（例如出現 `FAIL`），以畫面為準，修改旁白，不修改畫面。
- Benchmark 數字只能引用 `src/benchmark-final.ts` 的既有結果，並且一定要同時顯示「10 組合成政策導航案例，不代表真實世界整體準確率。」

## 現場 Failover Script

**觸發條件：** 正式 Live Agent 按下「執行 Agent」後 **8–10 秒內沒有明顯進展**（Agent Journey 沒有推進、畫面卡住、出現 `UNAVAILABLE`／`FAILED`、Cloudflare 或 localhost 錯誤、投影異常）。

**主講人說（約 12 秒）：**

> 「GovAid Atlas 具備 provider failure handling；即使模型服務異常，決策核心仍保留 deterministic safety workflow。以下使用預錄流程展示完整 Golden Path。」

**操作者同時：**

1. 切到已預先開好、暫停在第 0 格的影片播放器（建議 VLC，全螢幕、音量已測）。
2. 按播放，不關閉、不重新整理原本的瀏覽器分頁。
3. 影片播完後回到簡報頁，繼續後續講稿。

**禁止：** 在台上 debug、開 terminal、重開 Ollama、重新整理頁面或重試第二次。

**事前準備：** 影片檔 `GovAidAtlas_Final_Backup_Demo.mp4` 放在桌面；VLC 預先開啟並暫停；USB 與第二台裝置各留一份備份。

## ffmpeg 組裝指令

本機已安裝 ffmpeg 8.1。以下指令在 `demo-video/` 目錄下用 PowerShell 執行（用相對路徑，避免 Windows 磁碟機冒號干擾 `subtitles` filter）。時間碼請依實際錄影調整。

```powershell
cd demo-video
New-Item -ItemType Directory -Force build | Out-Null

# 1) 從 Golden Path 原始錄影切出鏡頭（-ss/-to 依實際錄影填入）
ffmpeg -y -ss 00:00:03 -to 00:00:12 -i raw/golden-path.mkv -vf "scale=1920:1080,fps=30" -an -c:v libx264 -crf 18 -pix_fmt yuv420p build/s02-goal.mp4

# 2) 模型等待段落：加速 ×2，並標示「畫面加速 ×2」
ffmpeg -y -ss 00:00:12 -to 00:00:38 -i raw/golden-path.mkv -vf "setpts=PTS/2,scale=1920:1080,fps=30,drawtext=fontfile='C\:/Windows/Fonts/msjh.ttc':text='畫面加速 ×2':x=40:y=h-80:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12" -an -c:v libx264 -crf 18 -pix_fmt yuv420p build/s03-journey.mp4

# ...依 shot-list.md 切出 s01–s08，開場卡與結尾卡來自 recording-page.html 的錄影

# 3) 依序串接（concat.txt 每行：file 'build/s01-intro.mp4'）
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy build/video-only.mp4

# 4) 加旁白、燒入字幕、加「預錄畫面」標示，輸出成品
ffmpeg -y -i build/video-only.mp4 -i raw/voiceover.wav -vf "subtitles=captions.srt:force_style='FontName=Microsoft JhengHei,FontSize=22,Outline=2,MarginV=48',drawtext=fontfile='C\:/Windows/Fonts/msjh.ttc':text='預錄畫面 · PRE-RECORDED':x=w-tw-40:y=36:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -ar 48000 -movflags +faststart -shortest build/govaid-atlas-backup.mp4

# 5) 驗證長度、解析度與影格率
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=nw=1 build/govaid-atlas-backup.mp4
```

驗收標準：長度 60–90 秒（目標 78 秒）、`1920x1080`、`30/1`、檔案小於 100 MB、在比賽筆電上用 VLC 與 Windows 內建播放器都能播放。
