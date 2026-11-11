# Field Validation Protocol — GovAid Atlas Usability & Decision-Support Study

> **STRICT INTEGRITY DISCLOSURE:**
> External human field validation has **NOT** yet been completed (`STATUS: PENDING_HUMAN_PARTICIPATION`).
> No simulated AI personas or fabricated participant numbers may be entered into `docs/field-validation-results-template.md`.

---

## 1. Study Objective & Scope

Evaluate whether GovAid Atlas improves task completion, reduces unsafe eligibility assumptions, shortens time-to-checklist, and increases user confidence compared with searching official government subsidy websites/PDFs directly.

- **Target Sample Size:** **5–8 human participants** minimum for initial empirical evidence.
- **Eligible Participant Profiles:** University students, young renters (aged 18–40), or parents/caregivers in Taiwan who have searched for or considered applying for rental or household subsidies.
- **Data Safety Principle:** Participants evaluate **fixed synthetic applicant personas only**. Do **not** collect or enter any participant's real household income, national ID, real residential address, tax records, or family property data.

---

## 2. Crossover Study Design (Counterbalanced)

Each participant completes two 10-minute tasks (`Task A` and `Task B`) using two matched synthetic personas (`Persona S1` and `Persona S2`):

- **Task A (Control — Official Government Websites / PDFs):**
  - Participant uses official Central (`R1`), Taipei City (`R6`), and New Taipei City (`R7`) subsidy web pages/PDFs to determine:
    1. Whether the synthetic persona passes the preliminary housing/aid conditions;
    2. What specific required condition is still missing (`UNCERTAIN`);
    3. How moving between New Taipei City and Taipei City changes local add-on eligibility;
    4. Which official source document supports each conclusion.
- **Task B (Treatment — GovAid Atlas):**
  - Participant uses GovAid Atlas (`http://127.0.0.1:8787`) on a matched synthetic persona to answer the same four questions, interact with the Human Gate, compare Actual vs. What-if scenarios, and inspect the Decision Passport.

### Counterbalancing Order
- **Odd Participant IDs (`P01`, `P03`, `P05`, `P07`):** `Task A (Official Websites)` first → `Task B (GovAid Atlas)` second.
- **Even Participant IDs (`P02`, `P04`, `P06`, `P08`):** `Task B (GovAid Atlas)` first → `Task A (Official Websites)` second.

---

## 3. Synthetic Test Cases Used in Study

### Synthetic Persona S1 (Used in First Assigned Task)
- **Age / Status:** 20 years old, single
- **Household Registration (`registeredCity`):** 臺北市
- **Current Residence (`ACTUAL`):** 新北市永和區合成測試地址 (Monthly rent: NT$13,500)
- **Candidate Move Address (`WHAT_IF`):** 臺北市文山區合成測試地址 (Monthly rent: NT$15,500)
- **Known Facts:** `receivesOtherHousingAid = false`; initially `ownsHome = unknown` (confirmed as `false` when asked); `newTaipeiResidenceStudyWork = unknown`; `centralRentApproved = unknown`.

### Synthetic Persona S2 (Used in Second Assigned Task)
- **Age / Status:** 24 years old, single
- **Household Registration (`registeredCity`):** 臺北市
- **Current Residence (`ACTUAL`):** 桃園市桃園區合成測試地址 (Monthly rent: NT$12,000)
- **Candidate Move Address (`WHAT_IF`):** 新北市板橋區合成測試地址 (Monthly rent: NT$14,000)
- **Known Facts:** `ownsHome = false`, `receivesOtherHousingAid = false`, `newTaipeiResidenceStudyWork = true`. (Tests whether the user recognizes that Taoyuan local rules are `NOT_COVERED` in P0 while Central & New Taipei rules are preliminary `PARTIAL_CHECK`).

---

## 4. Informed Consent Wording

Before starting, read and obtain verbal/written confirmation of the following consent statement:

> **參與者知情同意聲明（Informed Consent）：**
> 「感謝您參與 GovAid Atlas（租屋補助資格預審與申辦導航系統）之使用者測試。本次測試僅使用研究團隊預先設計之『合成虛擬人物資料（Synthetic Persona）』進行任務操作，**請勿輸入您本人或家人的真實姓名、身分證字號、真實住址、真實所得或任何個人敏感財務資料**。
> 測試過程將記錄：任務完成與否、操作耗時（秒）、條件判斷正確性、系統易用性量表（SUS）評分及簡短文字回饋。所有紀錄僅以匿名代號（如 `P01`）標示，不會與您的真實身分連結，且您可隨時中止參與。」

---

## 5. Participant ID Format & Privacy Rules

1. **Participant ID Format:** `P01`, `P02`, `P03`, `P04`, `P05`, `P06`, `P07`, `P08` (sequential anonymous code only).
2. **Prohibited Identifiers:** Never record participant full names, student IDs, email addresses, phone numbers, university department names, or audio/video recordings containing faces or personal desktops in repository files.
3. **Broad Background Tag Only:** Record only general non-identifying category (`student`, `renter`, `parent/caregiver`, `social-work-trainee`).

---

## 6. Facilitator Step-by-Step Test Instructions

1. **Preparation (Before Participant Arrives):**
   - Start GovAid Atlas locally (`npm.cmd run build && npm.cmd start`) on `http://127.0.0.1:8787` and warm up Ollama per `docs/demo-runbook.md` (or use deterministic fallback mode if testing UI workflow speed separately).
   - Open the official PDFs (`R1`, `R6`, `R7`) in a separate browser window for `Task A`.
2. **Briefing (2 minutes):**
   - Read the Informed Consent statement and assign anonymous ID (`P01`–`P08`).
   - Hand the participant the printed card for `Persona S1` and `Persona S2`.
3. **Run Task 1 (up to 10 minutes):**
   - Start stopwatch when participant begins reading the task card.
   - Do not coach or hint where rules are located.
   - Stop stopwatch when participant writes down their final answers for: (a) Overall status, (b) Missing information required, (c) Official evidence source, and (d) Next step before filing.
4. **Run Task 2 (up to 10 minutes):**
   - Switch to the second condition (`Task B` or `Task A` per counterbalancing) with the second persona card and repeat timing and answer collection.
5. **Post-Task Questionnaire (3 minutes):**
   - Have participant rate confidence (`1–5` Likert scale) for both tasks.
   - Administer the 10-item System Usability Scale (`SUS`, `0–100` score) for GovAid Atlas.
   - Collect two short open-ended feedback prompts:
     1. *「GovAid Atlas 最有幫助的部分是什麼？」*
     2. *「哪個地方仍讓您覺得困惑或需要改進？」*
6. **Data Entry:**
   - Enter raw session rows into `docs/field-validation-results-template.md` and `benchmark/manual-results.csv` (if `B01`–`B10` packet was also administered).

---

## 7. Quantitative & Qualitative Metrics Defined

| Metric | Definition / Scale | Target Comparison |
| :--- | :--- | :--- |
| **Task Completion (`Completed`)** | `YES` if participant reaches an answer on all 4 sub-questions within 10 minutes; `NO` otherwise | `Task A (Official Sites)` vs. `Task B (GovAid Atlas)` |
| **Completion Time (`Seconds`)** | Elapsed seconds from task start to final written answer | Mean & Median seconds (`Task A` vs. `Task B`) |
| **Error Count (`0–4`)** | Number of sub-questions answered inaccurately (e.g., claiming full `PASS` when a field is `null` or `NOT_COVERED`) | Error reduction in `Task B` vs. `Task A` |
| **Decision Confidence (`1–5`)** | Self-reported confidence (`1 = 非常不確定`, `5 = 非常確定自己知道還缺什麼資料`) | Mean score (`Task A` vs. `Task B`) |
| **Usability Score (`SUS 0–100`)** | Standard 10-item System Usability Scale (`(sum of adjusted 0–4 scores) × 2.5`) | Benchmark threshold `≥ 68` (acceptable usability) |
| **Open Feedback** | Verbatim anonymized notes on clarity of `PARTIAL_CHECK`, `NOT_COVERED`, and Decision Passport | Qualitative synthesis |
