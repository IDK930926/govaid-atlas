# OpenAI Live Validation — Golden Path

**Measured competition-preparation runs.** These are five Golden Path validation runs of the live
GovAid Atlas app, collected while preparing for the NAPAI 2026 final. They are not an SLA, not a
production uptime figure, and not a general performance guarantee. Five runs are too few to
characterise latency or cost outside this exact scenario.

## Setup

| Item | Value |
|---|---|
| Provider | OPENAI CLOUD |
| Model | `gpt-5.4-mini` |
| Scenario | Golden Path (synthetic): 新北市永和區 NT$13,500 → 臺北市文山區 NT$15,500 |
| Flow | 開始分析 → Human Gate → 沒有自有住宅 → Decision Passport |
| Fallback used | 0 on all five runs (no Ollama fallback was triggered) |

## Per-run measurements

| Run | Planner latency | Input tokens | Output tokens | Estimated cloud API cost (USD) | Result |
|---|---|---|---|---|---|
| 1 | 6.6 s | 323 | 275 | 0.001480 | Completed |
| 2 | 6.6 s | 323 | 387 | 0.001984 | Completed |
| 3 | 3.7 s | 323 | 317 | 0.001669 | Completed |
| 4 | 4.1 s | 323 | 352 | 0.001826 | Completed |
| 5 | 5.1 s | 323 | 476 | 0.002384 | Completed |

## Summary

| Metric | Value |
|---|---|
| Completed | **5 / 5** |
| Median planner latency | **5.1 s** |
| Average planner latency | 5.22 s |
| Slowest planner latency | 6.6 s |
| Fallback triggered | 0 / 5 |
| Total estimated cost | USD 0.009343 |
| Average estimated cost | ≈ USD 0.001869 per run |

Costs are the app's estimate from the token counts it recorded, not a provider invoice.
Planner latency covers the model planning call only; the deterministic resume after the Human Gate
is measured separately (see `docs/demo-reliability-wave3.md`).

## Where these numbers appear

`demo/govaid-atlas-competition-showcase.html` (Reliability section) shows only the median
(≈ 5.1 s) and the completion count (5 / 5), labelled as measured in five Golden Path validation
runs. The showcase HTML itself never calls OpenAI; it is an offline replay.

The local Ollama fallback measurements (5 / 5, median planner latency 63.8 s on CPU) are recorded
in `docs/demo-reliability-wave3.md`.
