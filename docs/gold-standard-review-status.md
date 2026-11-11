# Gold Standard Review Status & Integrity Governance

## 1. Executive Classification

- **Gold Standard File:** `benchmark/cases.json`
- **Current Review Status:** `PENDING_INDEPENDENT_REVIEW`
- **Explicit Disqualification of Overclaimed Statuses:** This dataset is **NOT** `VERIFIED`, **NOT** `APPROVED`, and **NOT** `VALIDATED` by an independent external domain reviewer.
- **Gold Standard Modified in Wave 1 / Wave 2 / Wave 3?** `NO` (`git diff benchmark/cases.json` is empty).

---

## 2. Dataset & Policy Source Version Inventory

| Attribute | Value / Status | Source Reference |
| :--- | :--- | :--- |
| **Dataset Path** | `benchmark/cases.json` | Repository benchmark root |
| **Schema Version** | `schemaVersion: 1` | `benchmark/cases.json` line 2 |
| **Dataset Description** | `"Synthetic benchmark cases; gold answers reflect the current repository implementation."` | `benchmark/cases.json` line 3 |
| **Cases Included** | `B01` through `B10` (10 synthetic cases: `B01`–`B05` Central rent, `B06`–`B07` New Taipei rent, `B08`–`B09` Taipei rent, `B10` synthetic policy conflict) | `benchmark/cases.json` lines 27–330 |
| **Separate Deterministic Suite** | 12 synthetic cases (`C01`–`C04`, `S01`–`S05`, `CF01`–`CF02`, `R01`) | `src/benchmark-cases.ts` |
| **Policy Source R1** | 內政部國土管理署 — 三百億元中央擴大租金補貼專案計畫作業規定（115年度） (`lastVerifiedAt: 2026-10-16`) | `src/policies/central-rent-115.json`, `src/evidence.ts` |
| **Policy Source R6** | 臺北市政府都市發展局 — 115年度臺北幸福租－民間租屋租金加碼補貼 (`lastVerifiedAt: 2026-10-16`) | `src/policies/taipei-rent-115.json`, `src/evidence.ts` |
| **Policy Source R7** | 新北市政府城鄉發展局 — 115年度新北市青年租金補貼 (`lastVerifiedAt: 2025-10-01` in `src/evidence.ts`, `2026-10-16` in `benchmark/cases.json`) | `src/policies/new-taipei-rent-115.json`, `src/evidence.ts` |
| **LLM Adjudication Log** | `benchmark/llm-adjudication.csv` (10 rows adjudicated for `LLM_CONTEXT` run `2026-11-08T01:31:49.316Z`) | Internal author adjudication only (`PENDING_INDEPENDENT_REVIEW`) |
| **Manual Baseline Files** | `benchmark/manual-results.csv`, `benchmark/manual-scoring-sheet.csv`, `benchmark/manual-test-packet.md` | `NOT_MEASURED` (blank templates) |

---

## 3. Current Reviewer Status & Circular-Validation Risk Disclosure

### 3.1 Circular-Validation Risk
As explicitly recorded in `docs/benchmark-protocol.md` (line 25) and `benchmark/cases.json` (line 3):

> *"Gold Answers were derived from the existing central, Taipei, New Taipei, and conflict implementations and their current policy JSON."*

Because the Gold Answers in `benchmark/cases.json` were authored from the same rule definitions (`src/policies/*.json`) that `GOVAID_ATLAS` executes:
1. A `100% (10/10)` score by `GOVAID_ATLAS` on `B01`–`B10` measures **technical implementation consistency (regression fidelity)** against the encoded 2-rule subsets—it does **not** constitute independent external validation of legal or domain completeness.
2. No independent social worker, legal reviewer, or public-sector housing specialist outside the repository authors has signed off on `B01`–`B10`.
3. Therefore, the Gold Standard status is strictly classified as **`PENDING_INDEPENDENT_REVIEW`**.

### 3.2 Specific Semantic Discrepancies Identified in Audit (`B01`, `B07`, `B09`, `B10`)
- **`B01` (Central Rent) & `B07` (New Taipei Rent):**
  - `benchmark/cases.json` defines `expectedStatus: "PASS"` when the 2 encoded rules (`ownsHome == false`, `receivesOtherHousingAid == false`, and for `B07` `newTaipeiResidenceStudyWork == true`) pass.
  - However, in `benchmark/llm-adjudication.csv`, the `LLM_CONTEXT` baseline was penalized with `Unsupported Claim = 1` on `B01` and `B07` for stating *"The applicant meets all eligibility criteria"*, because the P0 rule subset omits income thresholds, age thresholds, household composition, and property/lease constraints.
  - In Wave 1 (`c05af4e`), the application runtime and Agent tools (`src/agent/tools.ts`, `src/passport.ts`, `src/types.ts`) were hardened to output `PARTIAL_CHECK` (初步條件通過（部分檢核）) rather than full `PASS` when only partial rule subsets are evaluated. `benchmark/cases.json` was intentionally left untouched so historical benchmark data was not post-hoc altered.
- **`B09` (Taipei Rent):**
  - `benchmark/cases.json` supplies `monthlyRent: 15500` in the scenario input and expects `PASS` based on `registeredCity == "臺北市"` and `centralRentApproved == true`.
  - In `benchmark/llm-adjudication.csv`, `LLM_CONTEXT` was penalized (`Unsupported Claim = 1`) for claiming NT$15,500 falls within the eligible rent range when the supplied `policyContext` did not specify a rent cap rule. An independent reviewer must verify whether including `monthlyRent: 15500` in the case input without a corresponding rent-cap rule in `policyContext` creates ambiguity for human/LLM testers.
- **`B10` (Synthetic Policy Conflict):**
  - `B10` uses explicitly synthetic conflicting claims (`SYN-A: ALLOW` vs `SYN-B: DENY`) and expects `HUMAN_REVIEW_REQUIRED`.
  - `LLM_CONTEXT` returned `UNCERTAIN` and stated that the assertions are synthetic and contradictory with no official evidence to resolve them. Scoring `UNCERTAIN` as `Correct Status = NO` tests adherence to a GovAid-specific enum (`HUMAN_REVIEW_REQUIRED`) rather than substantive policy error.

---

## 4. Known Limitations

1. **Rule-Subset Scope:** Each policy JSON (`central-rent-115.json`, `taipei-rent-115.json`, `new-taipei-rent-115.json`) encodes only 2 required conditions per program. Official 115-year regulations include additional household income, per-person monthly expenditure, family member property ownership, and lease registration rules.
2. **Coverage Boundary:** `B01`–`B10` only cover Central, Taipei City, and New Taipei City rental subsidies. Uncovered cities (e.g., Taoyuan City `桃園市`) and uncovered benefit domains (e.g., childcare subsidies `育兒津貼`) are evaluated in the Wave 1/Wave 2/Wave 3 Agent evaluation suite (`benchmark/results-wave2-agent.csv`), not in `B01`–`B10`.
3. **Unmeasured Human Baseline:** `benchmark/manual-results.csv` and `benchmark/manual-scoring-sheet.csv` remain unpopulated (`NOT_MEASURED`).

---

## 5. Freeze Policy & Prohibition Against Post-Hoc Answer Changes

1. **Strict Freeze on `benchmark/cases.json` and `benchmark/results.csv`:**
   - Developers and AI agents are strictly prohibited from editing `benchmark/cases.json`, `benchmark/results.csv`, `benchmark/llm-adjudication.csv`, or `benchmark/manual-results.csv` to make current or future system outputs look better.
2. **Prohibition Against Post-Hoc Answer Changes:**
   - Expected statuses (`expectedStatus`), missing conditions (`expectedMissingCondition`), and adjudication scores must never be retroactively changed to match system behavior.
   - Where Wave 1/Wave 2 introduced safer statuses (`PARTIAL_CHECK`, `NOT_COVERED`), those evaluations must be recorded in a separate versioned output file (`benchmark/results-wave2-agent.csv`) and explicitly distinguished as **Technical Regression Results** vs. **Policy Correctness Results (`PENDING_INDEPENDENT_REVIEW`)**.

---

## 6. Independent Review Requirement & Adjudication Procedure

Before `benchmark/cases.json` can transition from `PENDING_INDEPENDENT_REVIEW` to `VERIFIED`:

1. **Reviewer Independence:**
   - At least one human reviewer who did **not** write the rule engine (`src/rules.ts`, `src/policies/*.json`) or the original `benchmark/cases.json` file must inspect all 10 cases using `docs/gold-standard-independent-review-template.md`.
2. **Source-Document Verification:**
   - The reviewer must compare each case's input facts and `policyContext` directly against the official PDFs (`R1`, `R6`, `R7`) and record whether the expected outcome should be `PASS`, `PARTIAL_CHECK`, `FAIL`, `UNCERTAIN`, or `HUMAN_REVIEW_REQUIRED`.
3. **Adjudication of Disagreements:**
   - If the independent reviewer marks `Disagree` on any case (especially `B01`, `B07`, `B09`, or `B10`), the disagreement reason must be logged verbatim in the review record.
   - Any revision to the Gold Standard must be released as `schemaVersion: 2` in a separate versioned file (`benchmark/cases-v2.json`), preserving `benchmark/cases.json` (`schemaVersion: 1`) intact for historical auditability.
4. **No Fabricated Sign-Off:**
   - Reviewer IDs, initials, dates, and signatures must remain blank (`PENDING`) until a real human reviewer completes the review.
