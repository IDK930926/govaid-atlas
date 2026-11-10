# 錄影 Checklist

## 錄影前 · 畫面與系統

- [ ] 螢幕解析度 1920×1080，Windows 縮放 100%
- [ ] Browser zoom 100%（`Ctrl+0`）
- [ ] 使用**全新、未登入**的 Chrome profile（或 Guest 模式），沒有頭像
- [ ] 關閉 bookmarks bar（`Ctrl+Shift+B`）
- [ ] 隱藏 / 移除所有擴充功能圖示
- [ ] 只開一個分頁：GovAid Atlas
- [ ] 瀏覽器用 `F11` 全螢幕，網址列不入鏡；若網址列必須入鏡，只能顯示 `localhost` / `127.0.0.1`
- [ ] 關閉 Windows 通知：開啟「勿擾模式」（設定 → 系統 → 通知）
- [ ] 關閉 Gmail、LINE、Discord、Teams、Slack 等通訊軟體
- [ ] 關閉 GitHub 視窗與 GitHub account popup
- [ ] 關閉 Cloudflare dashboard / tunnel 視窗（錄影用 localhost，不走 tunnel）
- [ ] 關閉 terminal 視窗，或移到其他虛擬桌面
- [ ] 工作列設為自動隱藏（OBS 只擷取瀏覽器視窗時可略過）
- [ ] 桌面不入鏡（OBS 用「視窗擷取」或只擷取瀏覽器的「顯示器擷取」）
- [ ] 關閉 Windows Update 自動重啟提示、防毒軟體彈窗
- [ ] 筆電接上電源，關閉省電模式

## 錄影前 · OBS 設定

- [ ] Base / Output 解析度 1920×1080、FPS 30
- [ ] 錄影格式 MKV（避免當機時毀檔），之後 remux 成 MP4
- [ ] 編碼器 x264 或 NVENC，CRF/CQ 18 左右
- [ ] 錄影路徑設為 `C:\Projects\govaid-atlas\demo-video\raw\`（已被 gitignore 排除）
- [ ] 關閉麥克風擷取（旁白另外錄）
- [ ] 開啟滑鼠點擊高亮（可選）

## 錄影前 · 產品狀態

- [ ] 用 production build 啟動 GovAid Atlas（`npm run build` 後 `npm start`），並以 `http://127.0.0.1:8787` 開啟。⚠️ 目前 `package.json` 在 HEAD 中有未解決的 merge 衝突標記，必須先由維護者在獨立的 PR 處理，否則 `npm` 指令可能無法執行
- [ ] 確認 Synthetic Persona：畫面顯示「合成示範資料 Synthetic Persona」，地址為「合成測試地址」
- [ ] 確認 Ollama `AVAILABLE`（Provider 狀態）
- [ ] 預熱模型：先完整跑一次 Golden Path 再錄（避免第一次冷啟動太慢）
- [ ] 重新整理頁面，回到 IDLE 狀態
- [ ] 確認 Golden Goal 文字完全一致：「我目前住在新北市永和區，每月租金 13,500 元。如果搬到臺北市文山區、租金 15,500 元，我有哪些租屋補助可以考慮？還缺什麼資料？」
- [ ] 確認 Run Agent（執行 Agent）按鈕可用
- [ ] 試跑確認 Human Gate 會出現「本人是否持有住宅？」
- [ ] 試跑確認 Decision Passport 有 Missing Items / Risks / Next Steps / Evidence（R1、R6、R7）
- [ ] 確認 Benchmark 分頁顯示 70%→100%、30%→0%、40%→0% 與免責聲明
- [ ] 進階 debug 面板保持收合（避免露出 run ID、模型原始輸出或路徑）

## 錄影中

- [ ] 先錄 3 秒靜止畫面再開始操作
- [ ] 滑鼠移動慢而直接；不亂晃、不 hover 官方連結
- [ ] 每個關鍵狀態（UNCERTAIN、Human Gate、PASS、Passport 各區、Benchmark）停 ≥ 2 秒
- [ ] 模型等待時不要點任何東西（後製再加速，並標示 `畫面加速 ×N`）
- [ ] 若出現 `FAILED`／`UNAVAILABLE`：停止錄影，重來，不剪接拼湊不同次的執行來假裝成功
- [ ] 結束後再錄 3 秒靜止畫面

## 錄影後

- [ ] 確認畫面上的狀態與 storyboard 一致；不一致時改旁白和字幕，不改畫面
- [ ] 依 [`anonymity-checklist.md`](anonymity-checklist.md) 逐格檢查
- [ ] 確認所有加速段落都有 `畫面加速 ×N` 標示
- [ ] 確認右上角全程有 `預錄畫面 · PRE-RECORDED`
- [ ] 確認成片長度 60–90 秒、1920×1080、30fps
- [ ] 在比賽筆電與投影機上實測播放（含聲音）
- [ ] 複製三份：比賽筆電桌面、USB、第二台裝置
- [ ] `git status` 確認 `raw/`、`build/`、MP4 沒有進入版本控制
