# GovAid Atlas — Demo UX Audit v2

Date: 2026-11-10 · Branch: `feat/demo-ux-redesign-v2` · Baseline commit: `d5f0b9b`

Method: production build (`npm run build && npm start`) driven in Chrome, with the real local
Ollama provider (`qwen3.5:4b`). Each viewport was rendered at its exact CSS size inside a
same-origin iframe, so media queries match the real device. States captured: INITIAL,
WAITING_FOR_HUMAN, COMPLETED at 1366×768 and 1920×1080, plus INITIAL at 390×844.
Screenshots were kept local (not committed).

## Measured baseline

| Viewport | State | Page height | Screens | Where the key element sits |
|---|---|---|---|---|
| 1366×768 | INITIAL | 1739 px | 2.26 | Run button at y=324; Agent Journey and Governance below |
| 1366×768 | WAITING_FOR_HUMAN | 2035 px | 2.65 | Human Gate at y=833–1004, **below the fold**; reached only by auto-scroll |
| 1366×768 | COMPLETED | 3101 px | **4.04** | Comparison at y=860, Passport at y=1457 (auto-scroll lands on Passport and skips the comparison) |
| 1920×1080 | INITIAL | 1818 px | 1.68 | Governance/Benchmark visible in first screen, competing with main flow |
| 1920×1080 | WAITING_FOR_HUMAN | 2114 px | 1.96 | Gate at y=882–1058 |
| 1920×1080 | COMPLETED | 3102 px | 2.87 | Passport at y=1465 |
| 390×844 | INITIAL | 3465 px | **4.11** | — |

Planner latency measured on this machine: about **100 s cold** and about **60 s warm** for a single
Ollama call (204 input / 322 output tokens). The loading state has to hold the room for a
full minute.

## 1. Information hierarchy issues

1. **Everything is a peer.** Hero, goal form, provider card, six journey cards, current-step panel,
   case-profile chips, Human Gate, Passport placeholder, comparison, Passport and five governance
   tabs all render as similarly weighted white cards. Nothing tells the eye where to go.
2. **No notion of phase.** The page is a single long document in every state. Start, Analyze and
   Decide all show the same scaffold; only some cards appear or disappear.
3. **The result is buried.** On completion the comparison renders *above* the Passport, and the
   Passport opens with a `CASE-P0-001` eyebrow and four equal engineering columns. The actual
   answer ("中央通過, 地方待確認") is a row of tiles, not a headline.
4. **Governance sits in the main flow.** Benchmark, RBAC, conflict test and audit live in an
   always-open section below the journey. At 1920×1080 it's visible on the first screen.
5. **Hero is too tall for what it says.** Four lines of tagline plus a sub-tagline take roughly
   190 px before the user sees a form, and it stays on screen during analysis and results.

## 2. Interaction issues

1. **Primary CTA reads as a developer action.** "執行 Agent / Run Agent" sits beside "重設示範" in
   the hero; the deterministic Golden Case is a third run button hidden in Debug.
2. **The Human Gate is a form row, not a decision.** It renders as a second amber panel *under* an
   amber "需要人工確認" current-step panel. The page doesn't dim, the buttons are standard size,
   and the question is visible only after auto-scroll at 1366×768.
3. **The loading state is in the wrong place.** The 60–100 s timer renders inside the goal form,
   while the Agent Journey (where attention goes) just says "規劃中 Planning".
4. **Auto-scroll jumps past content.** After the gate, the page scrolls straight to the Passport and
   skips the comparison, which then sits above the viewport.
5. **Dead code paths in the UI.** `stage === "CONFIRMED"` and `"COMPARED"` buttons ("比較居住情境",
   "產出申辦決策護照") are unreachable from the agent flow.

## 3. Duplicated information

| Information | Rendered in |
|---|---|
| "需要人工確認" | runtime status pill, stepper step 4, current-step title, Human Gate label (4×) |
| Agent status | runtime pill + current-step title + stepper ACTIVE marker |
| Program status | Passport tiles + comparison rows + rule-details rows |
| Provider/model | provider card + Runtime tab |
| Case profile | chips in current panel (Age/Single/City/Ownership) + goal text |
| "UNCERTAIN" | badge text "待確認 UNCERTAIN" + gap column "待確認：…" side by side |

## 4. Visual noise

* **Bilingual stacking on every label.** `<Bilingual>` puts Chinese and English side by side on
  about 90 labels (each step chip has two bilingual strings: "執行中 ACTIVE" + "理解目標 Understand
  Goal"). Every glance requires parsing two languages.
* Six equal-weight step cards with three text levels each.
* Status pills contain dot + zh + en, and appear inside tables, tiles and tabs alike.
* Technical vocabulary on the main surface: "Last Tool Call", "Steps 1 / 8", "Agent Runtime",
  "Deterministic P0 Regression", `CASE-P0-001`, rule IDs in comparison details.

## 5. Demo friction (5-minute final)

| Moment | Friction |
|---|---|
| 0:00 first look | Judge sees a title, a sentence in two languages, a long textarea and a dashboard of PENDING cards. No obvious "do this". |
| 0:10 start | Presenter must explain that "執行 Agent" is the start. |
| 0:15–1:15 wait | The timer is in the form; the journey shows a static "Planning" card. Dead air for 60 s. |
| 1:15 gate | Page auto-scrolls; the gate competes with the amber panel above it. |
| 1:20 result | Scroll lands on the Passport header; presenter scrolls up for the comparison, then down for evidence. 4 screens. |
| 2:00 governance | Presenter scrolls past the Passport to tabs; the benchmark is a five-column table. |

## 6. Proposed IA

Three phases, derived only from the existing `AgentRun.status` (presentation mapping, no state
machine changes):

```
Sticky header (56px): GovAid Atlas · 01 申請目標 → 02 Agent 分析 → 03 人工確認 → 04 情境比較 → 05 決策護照 · [技術與治理] [重設]

START   (status IDLE)
  Compact hero (~200px): name · one-line value prop · EN companion · capability line · LOCAL AGENT card
  Goal card: 你想確認什麼補助？ · textarea · profile chips · [開始分析]   |  "GovAid Atlas 會：①–⑤"

ANALYZE (PLANNING / RUNNING_TOOL / WAITING_FOR_HUMAN / RESUMING / HUMAN_REVIEW_REQUIRED / FAILED)
  [Stepper 6 steps] | [Current Action: the single focal card] | [Compact context: goal, profile, model, tool allowlist]
  WAITING_FOR_HUMAN → Current Action becomes the spotlight Human Gate; side columns dim.

DECIDE  (COMPLETED)
  Decision Passport: summary strip (中央 / 新北 / 臺北) → 目前可以確定 vs 目前仍需確認
                     → 需要補充的資料 · 風險提醒 · 建議下一步 → 官方依據 (agency first)
  Actual vs What-if (rule IDs behind 查看規則細節)
  [查看系統如何控制風險] → drawer

Technical & Governance drawer (modal dialog, closed by default)
  安全治理 Safety (RBAC + conflict) · 執行紀錄 Audit (events, debug, demo controls)
  · 模型資訊 Runtime (real metrics, N/A when empty) · 評測 Evaluation (benchmark cards)
```

Language rule: Chinese is the interface. English appears only as a companion on the hero tagline,
section headings, stepper secondary labels, the Human Gate, the Passport, Evidence and Benchmark,
and for technical terms (PASS / UNCERTAIN / FAIL on results, tool names). Agent status enums never
appear on the main surface; they stay in the audit/debug JSON.

Targets: START = 1 viewport at 1366×768. Human Gate fully visible without scrolling. DECIDE
summary plus definite/uncertain verdict visible in the first viewport, whole result ≤ 2 viewports.

## 7. After redesign — measured

Same method, same real Ollama run (no mocks). "Screens" = page height ÷ viewport height.

| Viewport | State | Before | After | Key element position (after) |
|---|---|---|---|---|
| 1366×768 | START | 2.26 | **1.00** | single CTA 「開始分析」 at y=537 |
| 1366×768 | Human Gate | 2.65 (gate y=833, below fold) | **1.00** | gate card y=88–450, answer buttons y=315 |
| 1366×768 | DECIDE | 4.04 | **1.99** | verdicts y=199, confirmed/uncertain y=357–487 |
| 1920×1080 | START | 1.68 | **1.00** | — |
| 1920×1080 | Human Gate | 1.96 | **1.00** | gate y=101–546 |
| 1920×1080 | DECIDE | 2.87 | **1.70** | Passport and official evidence in first screen |
| 390×844 | START | 4.11 | **1.37** | CTA at y=693 (above fold) |
| 390×844 | Human Gate | — | 1.38 | full gate and both buttons above fold (y=72–521) |
| 390×844 | DECIDE | — | 3.52 | verdicts and split in first screen |

* Horizontal overflow: none at any size.
* Raw agent enums on the main surface: 0 in every state (they remain only in Audit / Debug).
* Primary actions visible on START: 1 (was 2 equal-weight run buttons plus Reset in the hero).
* Interactions for the golden demo: 開始分析 → 沒有自有住宅. No scrolling is needed to reach
  the gate or the verdict; the page moves focus to each new focal heading.
* Keyboard-only run verified at 1366×768: Tab → Enter (start) → Tab → Enter (gate) → result.
* Benchmark values unchanged (70→100, 30→0, 40→0; coverage 77.8→100; manual baseline pending).
* Runtime values read from live state: 1 LLM call, 204 input / 322 output tokens, measured
  planner latency; empty values show N/A.
