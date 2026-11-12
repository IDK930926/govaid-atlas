# Wave 4 Official Policy Research & Evidence Registry (`docs/wave4-policy-evidence.md`)

**Last Verified Date:** `2026-11-11`  
**Verification Standard:** Only official R.O.C. central and municipal government domains (`gov.tw`, `sfaa.gov.tw`, `mohw.gov.tw`, `nlma.gov.tw`, `ohd.tycg.gov.tw`, `tycg.gov.tw`, `gov.taipei`, `ntpc.gov.tw`) are accepted as policy authority. No blogs, news summaries, or third-party websites are used for eligibility logic.

---

## 1. Summary of Supported Policies in Wave 4

| Policy ID | Policy Title | Domain | Jurisdiction | Issuing / Administering Agency | Applicable Year / Period | Implementation Status | Eligibility Completeness |
|---|---|---|---|---|---|---|---|
| `CHILDCARE_ALLOWANCE_UNDER_2_115` | 育有未滿2歲兒童育兒津貼 | `CHILDCARE` | 全國（中央訂定、戶籍地公所受理） | 衛生福利部社會及家庭署 ／ 各直轄市、縣（市）政府社會局處及鄉（鎮、市、區）公所 | 115年度（2026-01-01 至 2026-12-31，常態隨到隨辦） | `VERIFIED` | `COMPLETE`（核心法定要件與胎次金額皆已驗證編碼；行政查調事項列於導航提醒） |
| `CENTRAL_RENT_115` | 300億元中央擴大租金補貼專案計畫（115年度） | `HOUSING` | 全國（中央主辦） | 內政部國土管理署 | 115年度（2026-01-01 09:00 至 2026-12-31 17:00） | `VERIFIED` | `PARTIAL`（僅預審無自有住宅、未重複領取住宅補貼等核心條件） |
| `TAOYUAN_CENTRAL_RENT_115` | 300億元中央擴大租金補貼專案計畫（桃園市受理與申辦導航） | `HOUSING` | 中央政策・桃園市協辦受理 | 內政部國土管理署 ／ 桃園市政府住宅發展處（住宅服務科） | 115年度（2026-01-01 09:00 至 2026-12-31 17:00） | `VERIFIED` | `PARTIAL`（中央無自有住宅、未領其他補貼及桃園市每人每月平均所得上限 50,304 元預審；租約與稅籍待主管機關審查） |
| `TAIPEI_RENT_115` | 115年度臺北幸福租－民間租屋租金加碼補貼 | `HOUSING` | 臺北市 | 臺北市政府都市發展局 | 115年度（2026-04-08 至 2027-03-31） | `VERIFIED` | `PARTIAL`（預審設籍臺北市與中央租補核定條件） |
| `NEW_TAIPEI_RENT_115` | 115年度新北市青年租金補貼 | `HOUSING` | 新北市 | 新北市政府城鄉發展局 | 115年度（2025-10-01 至 2026-12-31） | `VERIFIED` | `PARTIAL`（預審新北市設籍/就學/就業與未重複領取補貼條件） |

---

## 2. Rule-Level Evidence Records

### 2.1 育有未滿2歲兒童育兒津貼 (`CHILDCARE_ALLOWANCE_UNDER_2_115`)

- **policyId:** `CHILDCARE_ALLOWANCE_UNDER_2_115`
- **policyTitle:** 育有未滿二歲兒童育兒津貼申領作業要點（115年度適用）
- **issuingAgency:** 衛生福利部社會及家庭署（各直轄市、縣市政府社會局處及鄉鎮市區公所受理）
- **officialSource:**
  - 主題專區與作業要點：`https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582`
  - 線上申辦系統：`https://twbaby.sfaa.gov.tw/`
  - 我的E政府申辦服務：`https://www.gov.tw/News3_Content.aspx?n=2&s=381263`
- **effectiveDate / applicableYear:** 自 2023-01-01 起取消排富規定並持續適用至 115 年度（`2026-01-01` – `2026-12-31`）
- **lastVerifiedAt:** `2026-11-11`

| ruleId | ruleTextSummary | sourceSection | implementationStatus |
|---|---|---|---|
| `CHILDCARE-115-AGE-001` | 請領當時兒童年齡須未滿 2 歲（0 歲至未滿 24 個月，即 `0 <= childAgeMonths < 24`）。 | 《育有未滿二歲兒童育兒津貼申領作業要點》第三點第一款 | `VERIFIED` |
| `CHILDCARE-115-REG-001` | 我國籍兒童須已完成出生登記或初設戶籍登記（`childHasBirthOrInitialHouseholdRegistration === true`）。 | 《育有未滿二歲兒童育兒津貼申領作業要點》第三點第一款 | `VERIFIED` |
| `CHILDCARE-115-PLACEMENT-001` | 兒童未經政府公費安置收容（`isGovernmentPlaced === false`）。 | 《育有未滿二歲兒童育兒津貼申領作業要點》第三點第二款 | `VERIFIED` |
| `CHILDCARE-115-CARE-001` | 兒童未接受公共化或準公共托育服務（公設民營托嬰中心、社區公共托育家園、準公共托嬰中心或準公共居家托育人員）（`receivesPublicOrQuasiPublicChildcare === false`）。 | 《育有未滿二歲兒童育兒津貼申領作業要點》第三點第三款 | `VERIFIED` |
| `CHILDCARE-115-ORDER-001` | 補助金額依兒童出生排序（胎次）核發：第 1 名子女每月 5,000 元、第 2 名子女每月 6,000 元、第 3 名（含）以上子女每月 7,000 元（自 112 年 1 月 1 日起已取消家庭綜合所得稅率 20% 排富限制）。 | 《育有未滿二歲兒童育兒津貼申領作業要點》第四點 | `VERIFIED` |

---

### 2.2 300億元中央擴大租金補貼專案計畫 — 桃園市受理與申辦導航 (`TAOYUAN_CENTRAL_RENT_115`)

- **policyId:** `TAOYUAN_CENTRAL_RENT_115`
- **policyTitle:** 三百億元中央擴大租金補貼專案計畫（115年度桃園市受理與審查導航）
- **issuingAgency:** 內政部國土管理署（主辦）／ 桃園市政府住宅發展處（協辦受理與審查）
- **officialSource:**
  - 內政部國土管理署 300億元中央擴大租金補貼專區：`https://has.nlma.gov.tw/subsidyOnline/`
  - 桃園市政府住宅發展處官方網站：`https://ohd.tycg.gov.tw/`
  - 作業規定 PDF：`https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf`
- **effectiveDate / applicableYear:** `2026-01-01` 至 `2026-12-31`（115年度隨到隨辦至 115年12月31日 17:00 止）
- **lastVerifiedAt:** `2026-11-11`

| ruleId | ruleTextSummary | sourceSection | implementationStatus |
|---|---|---|---|
| `CENTRAL-115-HOME-001` | 家庭成員均無自有房屋（`ownsHome === false`）。 | 《三百億元中央擴大租金補貼專案計畫作業規定》第五點 | `VERIFIED` |
| `CENTRAL-115-HOUSING-AID-001` | 家庭成員目前未重複享有其他政府住宅補貼（`receivesOtherHousingAid === false`）。 | 《三百億元中央擴大租金補貼專案計畫作業規定》第五點 | `VERIFIED` |
| `TAOYUAN-115-INCOME-001` | 桃園市租賃案件：家庭成員每人每月平均所得須低於桃園市最低生活費 3 倍（115年度標準為新臺幣 50,304 元／月；若申請人已提供月所得且高於 50,304 元則判定 `FAIL`）。 | 《三百億元中央擴大租金補貼專案計畫作業規定》第五點及115年度桃園市每人每月平均所得標準表 | `VERIFIED` |
| `TAOYUAN-115-LEASE-VERIFICATION` | 定期租賃契約（含出租人、承租人身分證號、桃園市租賃地址、租金與期限）及房屋稅籍課稅現值認定。 | 《三百億元中央擴大租金補貼專案計畫作業規定》第六點 | `PARTIAL`（列為應備文件與申辦檢核，不進入自動 PASS 判定） |
| `TAOYUAN-LOCAL-EXCLUSIVE` | 桃園市其他地方專屬住宅計畫（如桃園市原住民族租金補貼、社會住宅包租代管、購屋貸款利息補貼等）。 | 桃園市政府住宅發展處各專案公告 | `NOT_IMPLEMENTED`（明確回傳 `NOT_COVERED`） |

---

### 2.3 既有雙北與中央租屋補助方案 (`CENTRAL_RENT_115`, `TAIPEI_RENT_115`, `NEW_TAIPEI_RENT_115`)

| policyId | ruleId | ruleTextSummary | officialSource | effectiveDate / applicableYear | lastVerifiedAt | implementationStatus |
|---|---|---|---|---|---|---|
| `CENTRAL_RENT_115` | `CENTRAL-115-HOME-001` | 家庭成員無自有住宅 (`ownsHome === false`) | `https://has.nlma.gov.tw/subsidyOnline/` | `2026-01-01` – `2026-12-31` | `2026-11-11` | `VERIFIED` |
| `CENTRAL_RENT_115` | `CENTRAL-115-HOUSING-AID-001` | 未重複領取其他政府住宅補貼 (`receivesOtherHousingAid === false`) | `https://has.nlma.gov.tw/subsidyOnline/` | `2026-01-01` – `2026-12-31` | `2026-11-11` | `VERIFIED` |
| `TAIPEI_RENT_115` | `TAIPEI-115-REGISTERED-001` | 申請人設籍於臺北市 (`registeredCity === "臺北市"`) | `https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf` | `2026-04-08` – `2027-03-31` | `2026-11-11` | `VERIFIED` |
| `TAIPEI_RENT_115` | `TAIPEI-115-CENTRAL-001` | 已取得中央300億元擴大租金補貼核定資格 (`centralRentApproved === true`) | `https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf` | `2026-04-08` – `2027-03-31` | `2026-11-11` | `VERIFIED` |
| `NEW_TAIPEI_RENT_115` | `NEWTAIPEI-115-LOCAL-001` | 於新北市設籍、就學或就業 (`newTaipeiResidenceStudyWork === true`) | `https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf` | `2025-10-01` – `2026-12-31` | `2026-11-11` | `VERIFIED` |
| `NEW_TAIPEI_RENT_115` | `NEWTAIPEI-115-AID-001` | 未重複領取其他政府住宅補貼 (`receivesOtherHousingAid === false`) | `https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf` | `2025-10-01` – `2026-12-31` | `2026-11-11` | `VERIFIED` |
