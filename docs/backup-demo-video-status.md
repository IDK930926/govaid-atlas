# Backup Demo Video Status & Re-Recording Specification

## 1. Current Video Classification

- **Artifact:** `GovAidAtlas_Final_Backup_Demo.mp4` (referenced on historical branch `feat/backup-demo-video`)
- **Current Classification:** **`CURRENT VIDEO: OUTDATED`**
- **Readiness Status:** **`OUTDATED`** (Must **NOT** be marked as `READY` until an updated video is recorded)

### Detailed Rationale for Outdated Status:

1. **Pre-Wave-1 Verdict Copy:** The legacy recording displays central and local rental subsidies as unconditional `PASS`, violating the project's strict legal truthfulness principle. The current system accurately displays `PARTIAL_CHECK` (初步條件通過（部分檢核）) to reflect partial statutory rule encoding.
2. **Lacks Childcare Domain:** The video was recorded when GovAid Atlas was housing-only. It lacks the Under-2 Childcare Allowance (`CHILDCARE_ALLOWANCE_UNDER_2_115`), tiered birth-order calculation (NT$5,000 / 6,000 / 7,000), and Childcare JourneyStepper.
3. **Lacks Taoyuan Intake:** It does not demonstrate Taoyuan City rental subsidy intake (`TAOYUAN_CENTRAL_RENT_115`) or Taoyuan-specific income thresholds.
4. **Lacks ApplicationGuide:** It does not display the actionable citizen application guide (`ApplicationGuide`) featuring official document checklists (R1, R6, R7, R8, R9), online portal URLs, and administering agency hotlines.
5. **Lacks Arbitrary-Case UI:** It only demonstrates the fixed single-persona flow and does not reflect the Gate A/B arbitrary applicant scenario builder or 14-field Human Gate.

---

## 2. Re-Recording Checklist (For Team Use When Recording Equipment is Available)

### Environment & Screen Setup:
- [ ] Display resolution: 1920×1080, Windows scaling 100%, Chrome zoom 100% (`Ctrl+0`).
- [ ] Clean Chrome profile without avatar, bookmarks bar hidden (`Ctrl+Shift+B`), extensions disabled.
- [ ] Single browser tab on full screen (`F11`), address bar showing `http://127.0.0.1:8787`.
- [ ] Notifications muted: Windows Focus / Do Not Disturb ON; quit Discord, Slack, LINE, Teams, Mail.
- [ ] OBS / Screen recorder: 1920×1080 @ 30 or 60 fps, high-bitrate MP4 or MKV remux.
- [ ] Audio: Clear voiceover in Traditional Chinese; microphone noise gate active.
- [ ] Overlay watermark: Clean, unobtrusive label in corner: `預錄備援畫面 · PRE-RECORDED DEMO`.

### Execution Script & Shot List (~90–120 Seconds):
1. **0:00–0:25 — Arbitrary Housing Intake & Goal:**
   - Input custom housing scenario in New Taipei / Taipei.
   - Click **開始分析**; highlight ~5 s fast OpenAI cloud planner proposal or warm Ollama response.
2. **0:25–0:45 — Dynamic Human Gate:**
   - Pause on Human Gate: 「本人是否持有住宅？」
   - Highlight active fact-seeking without guessing; select **沒有自有住宅**.
3. **0:45–1:15 — Decision Passport & ApplicationGuide:**
   - Highlight legally truthful verdict: **初步條件通過（部分檢核）** (`PARTIAL_CHECK`).
   - Scroll through required documents checklist (身份證、租賃契約、存摺封面).
   - Display official portal link (`has.nlma.gov.tw`) and administering agency hotline.
4. **1:15–1:40 — Multi-Domain Switch: Childcare Allowance:**
   - Reset and enter: 「我的小孩一歲，想申請育兒津貼」.
   - Run analysis; demonstrate Childcare JourneyStepper.
   - Display verified `PASS` verdict with birth-order subsidy calculation (NT$5,000 / 6,000 / 7,000) and `twbaby.sfaa.gov.tw` link.
5. **1:40–2:00 — Trace & Safe Boundary:**
   - Open **技術與治理** drawer; show sanitized Agent Trace (zero PII, zero tokens/prompts).
   - Test out-of-scope query (e.g. 托育補助); show **`NOT_COVERED`** card with official referral links.

### Post-Recording Validation:
- [ ] Verify no personal names, usernames, local system file paths (`C:\Users\...`), or secret tokens appear on screen.
- [ ] Verify all verdicts match runtime truth (`PARTIAL_CHECK` for housing, `PASS` for childcare, `NOT_COVERED` for out-of-scope).
- [ ] Verify total running time is under 120 seconds.
- [ ] Save output as `GovAidAtlas_Final_Backup_Demo.mp4` on local presentation drive and backup USB.
- [ ] Only change status in `docs/napai-submission-readiness.md` to `READY` after verified MP4 is generated and tested on the presentation laptop.
