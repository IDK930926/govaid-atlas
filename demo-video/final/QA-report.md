# Final Backup Demo — QA Report

Output: `demo-video/final/GovAidAtlas_Final_Backup_Demo.mp4` (narrated) and `GovAidAtlas_Final_Backup_Demo_noVO.mp4` (silent audio track, same picture and captions).
The MP4 files are git-ignored; this report and `edl.json` are the committed record.

## ffprobe

| Field | Value |
|---|---|
| Duration | 78.000000 s |
| Resolution | 1920×1080, SAR 1:1 |
| Frame rate | 30/1 (r and avg), 2340 frames |
| Video | H.264 High, yuv420p, tv range, BT.709, ~730 kb/s |
| Audio | AAC-LC, 48000 Hz, stereo, ~132 kb/s |
| Container | MP4 (isom), `+faststart` |
| File size | 8,485,932 bytes narrated / 7,206,712 bytes noVO |
| Format tags | `major_brand`, `minor_version`, `compatible_brands` only |
| Stream tags | `handler_name=VideoHandler/SoundHandler`, `encoder=Lavc libx264`, `language=zho` (audio) |

Metadata: `-map_metadata -1 -fflags +bitexact`; `udta/meta/ilst` box is empty. A byte scan of the file found no Windows username, user path, `AppData`, email, GitHub handle, tunnel host or API-key text. Windows Shell properties show empty Author/Title.

## Scenes (all real footage plays at 1×, no acceleration)

| Scene | Output | Source (one continuous take) |
|---|---|---|
| S1 Hero | 0:00–0:07 | Live hero, provider `gpt-5.4-mini · AVAILABLE`, synthetic persona chips |
| S2 Goal | 0:07–0:16 | Golden Goal prefilled → click 開始分析 at 0:15.5 |
| S3 Journey → Human Gate | 0:16–0:29 | Real model planning (elapsed counter 1.0 → 4.8 s, next tool `evaluate_central_rules`), Human Gate appears at 0:20.9 with 中央條件「待確認」 |
| S4 Human Gate → Resume | 0:29–0:38 | Click 沒有自有住宅 at 0:32.1 → result shows 已依你的確認（沒有自有住宅）繼續分析, 中央方案 通過 PASS |
| S5 Actual vs What-if | 0:38–0:51 | ACTUAL 新北永和 NT$13,500 / WHAT-IF 臺北文山 NT$15,500; central PASS ×2, 新北/臺北 local 待確認 UNCERTAIN |
| S6 Decision Passport | 0:51–1:03 | 需要補充的資料, 建議下一步, 風險提醒, 官方依據 R1/R6/R7 |
| S7 Benchmark | 1:03–1:13 | 技術與治理 → 評測: LLM + Context 70/30/40 % vs GovAid Atlas 100/0/0 %, Evidence Coverage 77.8 % → 100 %, “10 synthetic policy-navigation cases; not a real-world accuracy claim.” |
| S8 Ending | 1:13–1:18 | `recording-page.html` card 2 — 安全優先於過度確定 / Safety Before Certainty |

The cuts drop only idle dwell time between scenes; no step of the agent run is removed or reordered. The 安全治理 (Safety) tab is skipped on purpose because it shows synthetic profile fields (ID/phone placeholders).

## Checks

| Check | Result |
|---|---|
| Full decode (`ffmpeg -f null`) | No errors |
| Black frames (`blackdetect d=0.05 pix_th=0.10`) | None |
| Loudness (`ebur128`) | −15.8 LUFS integrated, −4.5 dBFS true peak, no clipping |
| A/V alignment | Both streams start 0.000 and end 78.000 |
| Captions | All 14 cues verified rendering at their midpoints; ≤ 2 lines; opaque dark box, Microsoft JhengHei 44 px |
| PRE-RECORDED badge | Two-line `預錄畫面 / PRE-RECORDED`, top-left corner. Measured against the clean footage at 5 fps (390 frames): present in every frame, footprint x 7–153 / y 5–62, an area that is plain background in all frames (brand starts at x 254; S7 drawer, tabs and × are on the right). No UI control is covered. |
| Chrome (installed, temp profile) | `canPlayType` "probably", 1920×1080, duration 78, playback advances |
| Edge (installed, temp profile) | Same as Chrome |
| Windows Media Foundation (MediaPlayer API) | Both files play; 1920×1080, 78 s |
| VLC | Not installed on the production machine — not tested |
| Console errors during recording | 0 |

## Anonymity reviews

Pass 1 (flow and captions, 1 frame per second, 78 frames) and pass 2 (full-resolution frames from each scene plus the badge and caption strips).
On screen: product UI only, synthetic persona (20 歲・單身・臺北戶籍・新北永和), model name, case ID `CASE-P0-001`, generation timestamp, public agency names.
Not present: browser frame or URL bar, bookmarks, profile avatar, notifications, terminal, VS Code, DevTools, file paths, school, names, emails, GitHub username, Cloudflare account, API keys or tunnel tokens.

## Badge patch (re-render only)

The badge was moved from top-right (where it partly covered the S7 drawer's × button) to top-left. The footage, cut list, 14 caption cues, narration mix and benchmark frames are unchanged. Only the badge line in `subs.ass` differs, and the same intermediate video was re-encoded.

## Open items

- Narration is synthetic TTS (Yating). Nobody has listened to it yet; a person must listen once for pronunciation of `deterministic rules`, `Decision Passport` and `GovAid Atlas`. If any of them sounds wrong, use the `_noVO` file or record a human voice-over and remix.
- A second human reviewer should watch the file once on the competition laptop and projector.
- VLC playback test is still open (VLC not installed here).
