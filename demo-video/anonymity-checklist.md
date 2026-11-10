# 匿名規範 Checklist

> NAPAI 決賽的匿名審查要求：影片**任何一格**都不得透露參賽者身分或機密資訊。
> 成片完成後由**兩個人**各逐格檢查一次（建議 0.5× 速度播放，並在每個轉場點暫停）。

## 禁止出現在影片中的項目

| # | 項目 | 常見出現位置 | 檢查 |
|---|---|---|---|
| 1 | 學校名稱 | 簡報殘留、桌布、瀏覽器分頁標題 | [ ] |
| 2 | 校徽 | 桌布、開場卡、favicon | [ ] |
| 3 | 參賽者姓名 | 旁白、字幕、作者欄、commit 訊息 | [ ] |
| 4 | 指導教授姓名 | 致謝、旁白 | [ ] |
| 5 | GitHub username | 網址列、GitHub 分頁、terminal prompt、repo URL | [ ] |
| 6 | Gmail / 任何 email | 瀏覽器 profile 頭像選單、通知、表單 | [ ] |
| 7 | Cloudflare email / 帳號 | Cloudflare dashboard、tunnel 網址 | [ ] |
| 8 | Windows username | 檔案總管、terminal prompt、錯誤訊息 | [ ] |
| 9 | `C:\Users\...` 路徑 | terminal、錯誤堆疊、下載列、OBS 視窗 | [ ] |
| 10 | API key | `.env`、debug 面板、network 面板 | [ ] |
| 11 | Tunnel token | terminal、cloudflared 設定 | [ ] |
| 12 | `.env` 內容 | 編輯器、terminal | [ ] |
| 13 | Terminal secret / 指令歷史 | 任何 terminal 視窗 | [ ] |
| 14 | 個人頭像 | Chrome profile 圖示、Windows 工作列 | [ ] |
| 15 | 通知訊息 | Windows 通知中心、瀏覽器通知、通訊軟體 | [ ] |

## 額外檢查

- [ ] 瀏覽器分頁標題與 favicon 只有 GovAid Atlas
- [ ] 網址列不入鏡；若入鏡，只能是 `localhost` / `127.0.0.1`，不得出現 `trycloudflare.com` 或自訂網域
- [ ] 系統匣時鐘、Wi-Fi 名稱（SSID）不入鏡
- [ ] Synthetic Persona 只有合成資料（「合成測試地址」），沒有真實地址、電話或身分證字號
- [ ] 旁白沒有提到團隊名稱、學校或個人姓名
- [ ] 旁白錄音沒有背景人聲叫出姓名
- [ ] 影片檔名與 metadata 不含姓名：用 `govaid-atlas-backup.mp4`，並在輸出時加 `-map_metadata -1` 清除中繼資料
- [ ] 開場卡與結尾卡只有產品名稱與標語

## 如何清除影片 metadata

```powershell
ffmpeg -i build/govaid-atlas-backup.mp4 -map_metadata -1 -c copy build/govaid-atlas-backup-clean.mp4
ffprobe -v error -show_entries format_tags -of default=nw=1 build/govaid-atlas-backup-clean.mp4
```

第二行指令應該只輸出編碼器標籤（例如 `encoder=Lavf...`），不應出現作者、標題或路徑。

## 簽核

| 檢查者 | 日期 | 結果 |
|---|---|---|
| 檢查者 A | | ☐ 通過 ☐ 需修正 |
| 檢查者 B | | ☐ 通過 ☐ 需修正 |

> 簽核欄只填代號，不填姓名。
