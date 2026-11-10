# GovAid Atlas — Final Demo Runbook (one page)

Expected on the demo laptop (CPU-only): cold model ≈ 95 s · first run after warm-up ≈ 71 s ·
steady state ≈ 61–64 s. Warm-up keeps the model loaded for 60 min. Measurements:
`docs/demo-reliability-wave3.md`.

## Before stage (T-30 min, PowerShell in the repo folder)

| # | Step | Command / action | Pass when |
|---|---|---|---|
| 1 | Power | AC adapter plugged in; Windows power mode = Best performance | plugged-in icon |
| 2 | Start Ollama | `$ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"; & $ollama list` (if it errors: `Start-Process $ollama -ArgumentList serve -WindowStyle Hidden`) | list prints |
| 3 | Model exists | `& $ollama list` | shows `qwen3.5:4b` |
| 4 | Warm model (no fake run, just loads weights) | `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:11434/api/generate -ContentType 'application/json' -Body '{"model":"qwen3.5:4b","keep_alive":"60m"}'` then `& $ollama ps` | `UNTIL ~60 minutes from now` (load ≈ 11 s) |
| 5 | Start app | `npm.cmd run build; npm.cmd start` (leave window open) | `listening on http://127.0.0.1:8787` |
| 6 | Health | `Invoke-RestMethod http://127.0.0.1:8787/api/health` | `providerStatus: AVAILABLE` |
| 7 | Browser | Chrome, new window, `http://127.0.0.1:8787` → F11 full screen, zoom 100% | START shows LOCAL AGENT · AVAILABLE |
| 8 | Resolution | Projector mirrored at 1920×1080 or 1366×768 | no horizontal scrollbar |
| 9 | Rehearsal | 開始分析 → wait → 沒有自有住宅 → verdict visible | gate ≤ ~75 s, verdict 中央 通過 / 新北 待確認 / 臺北 待確認 |
| 10 | Reset | top-right 重設 | START screen, timer gone |
| 11 | Leave ready | browser at START, mouse away from buttons | — |
| 12 | Notifications off | Windows Focus / Do not disturb on; close chat apps, mail, OneDrive pop-ups | — |
| 13 | Backups ready | backup MP4 open in a paused player; offline HTML (`feat/final-html-demo` branch) open in a second browser tab | both one Alt+Tab away |

Re-run step 4 if more than 45 min pass before going on stage. Never show the terminal on screen.

## Live flow (≈ 3 min)

1. Click **開始分析** — say what the agent does while the elapsed timer counts (≈ 60–70 s).
2. Wait for the **Human Gate**: 「本人是否持有住宅？」 — point out *Agent 不會自行猜測*.
3. Click **沒有自有住宅**.
4. Show the **verdict band**: 中央方案 通過 · 新北/臺北 待確認, then 目前可以確定 / 仍需確認.
5. Scroll once: **目前住址 vs 搬遷假設**, then the **申辦決策護照** and its official evidence.
6. Only if asked: **技術與治理 → 評測** (70% → 100%, synthetic 10 cases, not a real-world claim).
   Esc closes the drawer.

## Failure rule

* START shows `UNAVAILABLE`, or the elapsed timer passes **85 s** with no Human Gate
  (warm expectation ≈ 60–75 s + 10 s margin), or any error appears → **do not debug on stage.**
* Say: 「為了節省時間，我們切換到預先錄製的同一流程。」 → Alt+Tab to the backup MP4
  (or the offline HTML if video playback fails).
* After the talk: `docs/demo-reliability-wave3.md` §3 shows the product's own fallback behaviour.
