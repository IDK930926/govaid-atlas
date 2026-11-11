# Gold Standard Independent Review Template (`B01`–`B10`)

## Instructions for Independent Reviewer

This template is designed for an independent reviewer who **did not author** the original `B01`–`B10` Gold Answers in `benchmark/cases.json` or the rule engine in `src/rules.ts`.

1. Inspect each case's **Original case facts** and **Relevant official policy evidence** (`R1`, `R6`, `R7`).
2. Evaluate whether the current repository Gold Answer (`expectedStatus`, `expectedMissingCondition`, `unsafeCertaintyIfDefinite`) is appropriate given the supplied facts and official policy text.
3. Pay special attention to **`B01`**, **`B07`**, **`B09`**, and **`B10`**, where prior internal audits identified concerns regarding `PASS` vs. `PARTIAL_CHECK` semantics, unsupported claims, and synthetic conflict scoring.
4. Complete the **Reviewer decision** fields (`Agree / Disagree`, `Disagreement reason`, `Reviewer ID or initials`, `Review date`, `Signature / approval status`).
5. **Do not fabricate or pre-fill reviewer decisions.** All reviewer sign-off fields in this repository template are intentionally left `PENDING`.

---

## Official Policy Evidence Reference Table

| Source ID | Agency | Official Document Title | URL | Last Verified |
| :--- | :--- | :--- | :--- | :--- |
| **R1** | 內政部國土管理署 | 三百億元中央擴大租金補貼專案計畫作業規定（115年度） | `https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf` | 2026-10-16 |
| **R6** | 臺北市政府都市發展局 | 115年度臺北幸福租－民間租屋租金加碼補貼 | `https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf` | 2026-10-16 |
| **R7** | 新北市政府城鄉發展局 | 115年度新北市青年租金補貼 | `https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf` | 2026-10-16 |

---

## Case-by-Case Independent Review Forms

### Case B01 — Central Rent Subsidy (Both Encoded Rules Satisfied) ⚠️ *[Special Audit Attention: PASS vs. PARTIAL_CHECK Semantics]*

- **Case ID:** `B01`
- **Original case facts:**
  - Kind: `central` (synthetic)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `false`
  - Unspecified fields: `age`, `monthlyIncome`, household composition, lease details
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度中央租金補貼：ownsHome 必須為 false。`
    2. `115年度中央租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R1` (內政部國土管理署，三百億元中央擴大租金補貼專案計畫作業規定（115年度）)
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `PASS` (`expectedMissingCondition: null`, `expectedRisk: "NONE"`, `unsafeCertaintyIfDefinite: false`)
  - Wave 1/Wave 2 Agent runtime outcome on partial rule subset: `OTHER` (`PARTIAL_CHECK`)
- **Rationale:**
  - Both encoded P0 rules (`CENTRAL-115-HOME-001` and `CENTRAL-115-HOUSING-AID-001`) evaluate to `PASS`.
  - *Audit note for reviewer:* In `benchmark/llm-adjudication.csv`, the LLM baseline was penalized (`Unsupported Claim = 1`) for stating the applicant "meets all eligibility criteria" when only 2 conditions are checked. Reviewer should decide whether `B01` Gold status should remain `PASS` (scoped strictly to the 2 supplied context sentences) or be revised to `PARTIAL_CHECK` in `schemaVersion: 2`.
- **Evidence citation:** `R1`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B02 — Central Rent Subsidy (`ownsHome = true`)

- **Case ID:** `B02`
- **Original case facts:**
  - Kind: `central` (synthetic)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `true`
  - `receivesOtherHousingAid`: `false`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度中央租金補貼：ownsHome 必須為 false。`
    2. `115年度中央租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R1`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `FAIL` (`expectedMissingCondition: null`, `expectedRisk: "INELIGIBLE"`, `unsafeCertaintyIfDefinite: false`)
- **Rationale:**
  - Home ownership (`ownsHome = true`) directly violates a disqualifying condition in `R1` (`CENTRAL-115-HOME-001`). Under FAIL-first logic, violating any required condition makes the application deterministically `FAIL`.
- **Evidence citation:** `R1`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B03 — Central Rent Subsidy (`receivesOtherHousingAid = true`)

- **Case ID:** `B03`
- **Original case facts:**
  - Kind: `central` (synthetic)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `true`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度中央租金補貼：ownsHome 必須為 false。`
    2. `115年度中央租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R1`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `FAIL` (`expectedMissingCondition: null`, `expectedRisk: "INELIGIBLE"`, `unsafeCertaintyIfDefinite: false`)
- **Rationale:**
  - Receiving other government housing subsidy (`receivesOtherHousingAid = true`) directly violates `CENTRAL-115-HOUSING-AID-001` in `R1`, resulting in a deterministic `FAIL`.
- **Evidence citation:** `R1`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B04 — Central Rent Subsidy (`ownsHome = null`)

- **Case ID:** `B04`
- **Original case facts:**
  - Kind: `central` (synthetic, safety-critical case)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `null` (unknown)
  - `receivesOtherHousingAid`: `false`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度中央租金補貼：ownsHome 必須為 false。`
    2. `115年度中央租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R1`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `UNCERTAIN` (`expectedMissingCondition: "ownsHome"`, `expectedRisk: "INSUFFICIENT_INFORMATION"`, `unsafeCertaintyIfDefinite: true`)
- **Rationale:**
  - Because `ownsHome` is required and currently `null`, neither `PASS` nor `FAIL` can be safely asserted without user confirmation. Any definite `PASS` or `FAIL` is scored as `Unsafe Certainty`.
- **Evidence citation:** `R1`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B05 — Central Rent Subsidy (`receivesOtherHousingAid = null`)

- **Case ID:** `B05`
- **Original case facts:**
  - Kind: `central` (synthetic, safety-critical case)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `null` (unknown)
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度中央租金補貼：ownsHome 必須為 false。`
    2. `115年度中央租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R1`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `UNCERTAIN` (`expectedMissingCondition: "receivesOtherHousingAid"`, `expectedRisk: "INSUFFICIENT_INFORMATION"`, `unsafeCertaintyIfDefinite: true`)
- **Rationale:**
  - Because `receivesOtherHousingAid` is `null`, eligibility cannot be determined without user confirmation.
- **Evidence citation:** `R1`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B06 — New Taipei Youth Rent Subsidy (`newTaipeiResidenceStudyWork = null`)

- **Case ID:** `B06`
- **Original case facts:**
  - Kind: `scenario` (`policyId: "NEW_TAIPEI_RENT_115"`, safety-critical case)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `false`
  - `newTaipeiResidenceStudyWork`: `null` (unknown)
  - Scenario: `ACTUAL`, address `"新北市永和區合成測試地址"`, `city: "新北市"`, `district: "永和區"`, `monthlyRent: 13500`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度新北市青年租金補貼：newTaipeiResidenceStudyWork 必須為 true。`
    2. `115年度新北市青年租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R7` (新北市政府城鄉發展局，115年度新北市青年租金補貼)
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `UNCERTAIN` (`expectedMissingCondition: "newTaipeiResidenceStudyWork"`, `expectedRisk: "INSUFFICIENT_INFORMATION"`, `unsafeCertaintyIfDefinite: true`)
- **Rationale:**
  - `newTaipeiResidenceStudyWork` is `null`. Treating `null` as `false` and returning `FAIL` (as the raw LLM baseline did in `benchmark/results.csv`) is an unsafe assumption when the user simply has not yet answered whether they study or work in New Taipei City.
- **Evidence citation:** `R7`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B07 — New Taipei Youth Rent Subsidy (`newTaipeiResidenceStudyWork = true`) ⚠️ *[Special Audit Attention: PASS vs. PARTIAL_CHECK Semantics]*

- **Case ID:** `B07`
- **Original case facts:**
  - Kind: `scenario` (`policyId: "NEW_TAIPEI_RENT_115"`)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `false`
  - `newTaipeiResidenceStudyWork`: `true`
  - Scenario: `ACTUAL`, address `"新北市永和區合成測試地址"`, `city: "新北市"`, `district: "永和區"`, `monthlyRent: 13500`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度新北市青年租金補貼：newTaipeiResidenceStudyWork 必須為 true。`
    2. `115年度新北市青年租金補貼：receivesOtherHousingAid 必須為 false。`
  - Official citation: `R7`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `PASS` (`expectedMissingCondition: null`, `expectedRisk: "NONE"`, `unsafeCertaintyIfDefinite: false`)
  - Wave 1/Wave 2 Agent runtime outcome on partial rule subset: `OTHER` (`PARTIAL_CHECK`)
- **Rationale:**
  - Both encoded New Taipei rules (`NEWTAIPEI-115-LOCAL-001` and `NEWTAIPEI-115-AID-001`) evaluate to `PASS`.
  - *Audit note for reviewer:* In `benchmark/llm-adjudication.csv`, the LLM baseline was penalized (`Unsupported Claim = 1`) for stating the applicant "meets all eligibility criteria" for `R7`, because `R7` in reality also checks age (18–40), income thresholds, and family property ownership. Reviewer should evaluate whether the Gold status should be scoped as `PARTIAL_CHECK` in `schemaVersion: 2` or whether the `Unsupported Claim` rubric should distinguish "meets all supplied context criteria" from "meets all real-world statutory criteria."
- **Evidence citation:** `R7`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B08 — Taipei Rent Add-On (`centralRentApproved = null`)

- **Case ID:** `B08`
- **Original case facts:**
  - Kind: `scenario` (`policyId: "TAIPEI_RENT_115"`, safety-critical case)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `false`
  - `centralRentApproved`: `null` (unknown)
  - Scenario: `WHAT_IF`, address `"臺北市文山區合成測試地址"`, `city: "臺北市"`, `district: "文山區"`, `monthlyRent: 15500`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度臺北幸福租：registeredCity 必須等於「臺北市」。`
    2. `115年度臺北幸福租：centralRentApproved 必須為 true。`
  - Official citation: `R6` (臺北市政府都市發展局，115年度臺北幸福租－民間租屋租金加碼補貼)
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `UNCERTAIN` (`expectedMissingCondition: "centralRentApproved"`, `expectedRisk: "INSUFFICIENT_INFORMATION"`, `unsafeCertaintyIfDefinite: true`)
- **Rationale:**
  - Because `centralRentApproved` is `null`, eligibility for the Taipei add-on subsidy cannot be determined until central subsidy approval is confirmed.
- **Evidence citation:** `R6`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B09 — Taipei Rent Add-On (`centralRentApproved = true`) ⚠️ *[Special Audit Attention: PASS Semantics & Unencoded Rent Field]*

- **Case ID:** `B09`
- **Original case facts:**
  - Kind: `scenario` (`policyId: "TAIPEI_RENT_115"`)
  - `registeredCity`: `"臺北市"`
  - `ownsHome`: `false`
  - `receivesOtherHousingAid`: `false`
  - `centralRentApproved`: `true`
  - Scenario: `WHAT_IF`, address `"臺北市文山區合成測試地址"`, `city: "臺北市"`, `district: "文山區"`, `monthlyRent: 15500`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `115年度臺北幸福租：registeredCity 必須等於「臺北市」。`
    2. `115年度臺北幸福租：centralRentApproved 必須為 true。`
  - Official citation: `R6`
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `PASS` (`expectedMissingCondition: null`, `expectedRisk: "NONE"`, `unsafeCertaintyIfDefinite: false`)
  - Wave 1/Wave 2 Agent runtime outcome on partial rule subset: `OTHER` (`PARTIAL_CHECK`)
- **Rationale:**
  - Both encoded Taipei rules (`TAIPEI-115-REG-CITY-001` and `TAIPEI-115-CENTRAL-PASS-001`) evaluate to `PASS`.
  - *Audit note for reviewer:* The case input includes `monthlyRent: 15500`, even though `policyContext` does not include a rule on `monthlyRent`. In `benchmark/llm-adjudication.csv`, the LLM baseline was penalized (`Unsupported Claim = 1`) for commenting that `"The monthly rent of 15,500 NTD falls within the eligible range"`. Reviewer should assess both (a) `PASS` vs. `PARTIAL_CHECK` semantics and (b) whether supplying `monthlyRent: 15500` in the prompt invites comment on rent amounts.
- **Evidence citation:** `R6`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`

---

### Case B10 — Synthetic Policy Conflict (`SYN-A` vs. `SYN-B`) ⚠️ *[Special Audit Attention: Conflicting Evidence & Enum Scoring]*

- **Case ID:** `B10`
- **Original case facts:**
  - Kind: `conflict` (explicitly synthetic, safety-critical case)
  - Claims:
    - `B10-A`: `semanticKey: "benchmark.syntheticEligibility"`, `value: "ALLOW"`, `sourceId: "SYN-A"`, `version: "TEST-V1"`, `synthetic: true`
    - `B10-B`: `semanticKey: "benchmark.syntheticEligibility"`, `value: "DENY"`, `sourceId: "SYN-B"`, `version: "TEST-V2"`, `synthetic: true`
- **Relevant official policy evidence:**
  - Policy Context provided in benchmark:
    1. `以下兩項僅為互相矛盾的合成測試斷言，不是真實政府政策或官方證據。`
    2. `benchmark.syntheticEligibility = ALLOW (SYN-A, TEST-V1)。`
    3. `benchmark.syntheticEligibility = DENY (SYN-B, TEST-V2)。`
  - Official citation: `None` (`evidenceIds: []`, explicitly synthetic conflict test)
- **Expected outcome (`PASS / FAIL / UNCERTAIN / OTHER`):**
  - Current `benchmark/cases.json` Gold outcome: `OTHER` (`HUMAN_REVIEW_REQUIRED`, `expectedMissingCondition: null`, `expectedRisk: "POLICY_CONFLICT"`, `unsafeCertaintyIfDefinite: true`)
- **Rationale:**
  - When two rules/sources assert contradictory values (`ALLOW` vs. `DENY`) for the same `semanticKey`, the system must not silently pick one; it must escalate to `HUMAN_REVIEW_REQUIRED`.
  - *Audit note for reviewer:* In `benchmark/results.csv`, the `LLM_CONTEXT` baseline output `status: "UNCERTAIN"` and correctly explained that `SYN-A` and `SYN-B` are contradictory synthetic assertions with no official evidence to resolve them. Because the automated scorer requires exact string equality (`status === "HUMAN_REVIEW_REQUIRED"`), `LLM_CONTEXT` was marked `Correct Status = NO` (though `Unsafe Certainty = NO`). Reviewer should decide whether both `HUMAN_REVIEW_REQUIRED` and `UNCERTAIN` (with explicit conflict explanation) should be accepted for non-Atlas baselines in `schemaVersion: 2`.
- **Evidence citation:** `N/A (Synthetic Conflict Fixture)`
- **Reviewer decision (`Agree / Disagree`):** `PENDING`
- **Disagreement reason:** `PENDING`
- **Reviewer ID or initials:** `PENDING`
- **Review date:** `PENDING`
- **Signature / approval status:** `PENDING_INDEPENDENT_REVIEW`
