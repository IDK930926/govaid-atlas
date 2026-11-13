import type {
  ApplicationAvailabilityStatus,
  ApplicationGuide,
  EligibilityStatus,
  EvidenceRecord,
  RequiredDocumentItem,
} from "./types";
import { getEvidence } from "./evidence";
import { evaluatePolicyValidity, type RuleEvaluationOptions } from "./rules";
import type { ScenarioResult } from "./scenario";

export type BuildApplicationGuideOptions = RuleEvaluationOptions & {
  status?: EligibilityStatus;
  estimatedMonthlyBenefitNtd?: number | null;
  missingItems?: string[];
  registeredCity?: string;
};

export const RENTAL_SUBSIDY_COMPARISON_METADATA = {
  "臺北市": {
    options: [
      { policyId: "CENTRAL_RENT_115", description: "中央 R1 第一級單身", minNtd: 3000, maxNtd: 3000 },
    ],
    note: "未設籍臺北市者不適用北市 R6。",
  },
  "新北市": {
    options: [
      { policyId: "CENTRAL_RENT_115", description: "中央 R1 第二／三級單身", minNtd: 2200, maxNtd: 2400 },
      { policyId: "NEW_TAIPEI_RENT_115", description: "新北青年 R7（符合新北設籍／就學／就業條件）", minNtd: 3500, maxNtd: 3500 },
    ],
    note: "R7 與中央 R1 擇優，不得重複請領。",
  },
} as const;

export type RentalSubsidyComparisonEstimate = {
  maxSubsidy: string;
  outOfPocket: string;
  note: string;
};

function formatNtdRange(minNtd: number, maxNtd: number): string {
  const min = `NT$${minNtd.toLocaleString()}`;
  return minNtd === maxNtd ? min : `${min}–NT$${maxNtd.toLocaleString()}`;
}

/**
 * Bracket-based rent estimate for the comparison table. A subsidy option is only used
 * when its program did not FAIL (or fall outside coverage) in this scenario, so a failed
 * scheme can never produce a "rent after subsidy" figure.
 */
export function estimateRentalSubsidyComparison(
  result: ScenarioResult,
  registeredCity?: string
): RentalSubsidyComparisonEstimate {
  const city = result.scenario.city;
  const metadata = city === "臺北市" || city === "新北市"
    ? RENTAL_SUBSIDY_COMPARISON_METADATA[city]
    : undefined;
  if (!metadata) {
    return {
      maxSubsidy: "目前無可用級距估算",
      outOfPocket: "—",
      note: "請以當地主管機關公告為準。",
    };
  }

  const statusOf = (policyId: string) =>
    result.policyResults.find((policy) => policy.policyId === policyId)?.eligibilityStatus;
  const options = metadata.options.filter((option) => {
    const status = statusOf(option.policyId);
    return status !== "FAIL" && status !== "NOT_COVERED";
  });
  if (options.length === 0) {
    return {
      maxSubsidy: "不適用：本情境已涵蓋之補助方案資格皆未通過",
      outOfPocket: "不適用（無可估算之補助）",
      note: "資格未通過之方案不列入補助後租金試算。",
    };
  }

  const maxSubsidy = options
    .map((option) => `${option.description}最高 ${formatNtdRange(option.minNtd, option.maxNtd)} / 月`)
    .join("；");
  const rent = result.scenario.monthlyRent;
  const outOfPocket = rent > 0
    ? (() => {
        const ranges = options.map((option) => ({
          min: Math.max(0, rent - option.maxNtd),
          max: Math.max(0, rent - option.minNtd),
        }));
        const min = Math.min(...ranges.map((range) => range.min));
        const max = Math.max(...ranges.map((range) => range.max));
        return `約 ${formatNtdRange(min, max)} / 月起`;
      })()
    : "填入月租後估算";
  const note = city === "臺北市" && registeredCity === "臺北市"
    ? "此估算僅列中央 R1，未估算須依資格核定的北市 R6 加碼。"
    : options.length < metadata.options.length
      ? "已排除本情境資格未通過之方案。"
      : metadata.note;

  return {
    maxSubsidy: `${maxSubsidy}；${note}`,
    outOfPocket,
    note: "依月租扣除最高補助試算；實際金額以主管機關核定級距為準。",
  };
}

function sourcesFor(ids: string[]): EvidenceRecord[] {
  return ids
    .map((id) => getEvidence(id))
    .filter((item): item is EvidenceRecord => item !== undefined);
}

function resolveAvailability(
  baseStatus: ApplicationAvailabilityStatus,
  validFrom: string,
  validTo: string,
  options?: RuleEvaluationOptions
): {
  applicationStatus: ApplicationAvailabilityStatus;
  validityStatus: ApplicationGuide["validityStatus"];
} {
  const validity = evaluatePolicyValidity(validFrom, validTo, options);
  if (validity.validityStatus === "EXPIRED" || validity.validityStatus === "HISTORICAL_MODE") {
    return {
      applicationStatus: "CLOSED",
      validityStatus: validity.validityStatus,
    };
  }
  if (validity.validityStatus === "NOT_YET_EFFECTIVE") {
    return {
      applicationStatus: "CLOSED",
      validityStatus: "NOT_YET_EFFECTIVE",
    };
  }
  return {
    applicationStatus: baseStatus,
    validityStatus: validity.validityStatus,
  };
}

const CHILDCARE_REQUIRED_DOCUMENTS: RequiredDocumentItem[] = [
  {
    documentId: "DOC-CHILDCARE-FORM",
    title: "育有未滿二歲兒童育兒津貼申請表（父母雙方或監護人簽名或蓋章；線上申辦免附紙本）",
    required: true,
    sourceId: "R8",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CHILDCARE-ID-HOUSEHOLD",
    title: "申請人（父母雙方或監護人）及兒童之身分證明文件（含詳細記事之戶口名簿影本或近3個月內戶籍謄本）",
    required: true,
    sourceId: "R8",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CHILDCARE-BANK",
    title: "申請人其中一方或兒童本人之金融機構存摺封面影本（多數縣市為郵局帳戶；臺北市可擇一使用郵局或臺北富邦銀行）",
    required: true,
    sourceId: "R8",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CHILDCARE-BIRTH-ORDER",
    title: "第2名（含）以上子女之出生排序證明文件（如完整登載同一父母子女次序之戶口名簿或戶籍謄本）",
    required: false,
    conditionNote: "申領第2名（6,000元/月）或第3名以上（7,000元/月）子女津貼時須確認戶籍資料可辨識胎次",
    sourceId: "R8",
    verificationStatus: "VERIFIED",
  },
];

const CENTRAL_RENT_REQUIRED_DOCUMENTS: RequiredDocumentItem[] = [
  {
    documentId: "DOC-CENTRAL-FORM",
    title: "300億元中央擴大租金補貼申請書（線上申請者免附紙本；郵寄或臨櫃須簽名或蓋章）",
    required: true,
    sourceId: "R1",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CENTRAL-LEASE",
    title: "有效定期租賃契約書影本（須載明出租人姓名、承租人姓名與身分證字號、租賃住宅地址、租賃金額及租賃期限）",
    required: true,
    sourceId: "R1",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CENTRAL-BANK",
    title: "申請人本人之金融機構帳戶存摺封面影本（須清楚顯示戶名、金融機構名稱及帳號）",
    required: true,
    sourceId: "R1",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-CENTRAL-BONUS",
    title: "加碼或弱勢身分證明文件影本（如孕有胎兒醫療證明、低收/中低收入戶或身心障礙證明；系統可查調或無該身分者免附）",
    required: false,
    conditionNote: "僅主張加碼倍數或特定社會/經濟弱勢身分時檢附",
    sourceId: "R1",
    verificationStatus: "VERIFIED",
  },
];

const TAOYUAN_RENT_REQUIRED_DOCUMENTS: RequiredDocumentItem[] = [
  {
    documentId: "DOC-TAOYUAN-FORM",
    title: "300億元中央擴大租金補貼申請書（於國土管理署線上系統申辦者免附紙本；紙本郵寄或至桃園市住宅發展處臨櫃須簽章）",
    required: true,
    sourceId: "R9",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAOYUAN-LEASE",
    title: "桃園市租賃住宅之定期租賃契約影本（須載明出租人姓名、承租人姓名與身分證字號、桃園市租賃地址、每月租金及租賃期限）",
    required: true,
    sourceId: "R9",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAOYUAN-BANK",
    title: "申請人金融機構帳戶存摺封面影本（若因強制執行無法使用本人帳戶，須另附切結書指定帳戶）",
    required: true,
    sourceId: "R9",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAOYUAN-SPECIAL-BLDG",
    title: "未保存登記或無房屋稅籍建築物之居住事實證明（申請日前半年內水電費、瓦斯費繳費證明或門牌證明；一般合法稅籍住宅免附）",
    required: false,
    conditionNote: "僅承租無房屋稅籍之未保存登記建築物時須檢附",
    sourceId: "R9",
    verificationStatus: "VERIFIED",
  },
];

const TAIPEI_RENT_REQUIRED_DOCUMENTS: RequiredDocumentItem[] = [
  {
    documentId: "DOC-TAIPEI-FORM",
    title: "115年度臺北市住宅租金加碼補貼（臺北幸福租）申請書（線上申辦免附紙本）",
    required: true,
    sourceId: "R6",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAIPEI-CENTRAL-APPROVAL",
    title: "中央300億元擴大租金補貼核定函或核准證明文件",
    required: true,
    sourceId: "R6",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAIPEI-HOUSEHOLD",
    title: "設籍臺北市之新式戶口名簿影本（含詳細記事）或近3個月內全戶戶籍謄本",
    required: true,
    sourceId: "R6",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAIPEI-LEASE",
    title: "有效期限內之臺北市租賃住宅定期租賃契約書影本",
    required: true,
    sourceId: "R6",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-TAIPEI-BANK",
    title: "申請人本人之金融機構帳戶存摺封面影本",
    required: true,
    sourceId: "R6",
    verificationStatus: "VERIFIED",
  },
];

const NEW_TAIPEI_RENT_REQUIRED_DOCUMENTS: RequiredDocumentItem[] = [
  {
    documentId: "DOC-NEWTAIPEI-FORM",
    title: "115年度新北市青年租金補貼申請書（線上申請者免附紙本）",
    required: true,
    sourceId: "R7",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-NEWTAIPEI-HOUSEHOLD",
    title: "申請日前一個月內開立之現戶全戶戶籍謄本（須包含詳細記事欄；夫妻分戶者須併附配偶戶籍謄本）",
    required: true,
    sourceId: "R7",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-NEWTAIPEI-WORK-STUDY",
    title: "新北市就學或就業證明文件（申請日前一個月內開立之在學證明或在職工作證明正本；已設籍新北市者依規定免附就學就業證明）",
    required: true,
    sourceId: "R7",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-NEWTAIPEI-LEASE",
    title: "已起租之新北市有效定期租賃契約影本（須載明出租人、承租人身分證字號、新北市租賃地址、租金及租賃期限）",
    required: true,
    sourceId: "R7",
    verificationStatus: "VERIFIED",
  },
  {
    documentId: "DOC-NEWTAIPEI-POST-BANK",
    title: "申請人本人之郵局存摺封面影本",
    required: true,
    sourceId: "R7",
    verificationStatus: "VERIFIED",
  },
];

export const OFFICIAL_FINAL_DECISION_DISCLAIMER =
  "GovAid 提供資格預審與申辦導航，不代表政府機關最終核定結果；實際核准資格、補助金額與撥款日期均以受理主管機關正式審查為準。";

export function getApplicationGuide(
  policyId: string,
  options?: BuildApplicationGuideOptions
): ApplicationGuide | null {
  switch (policyId) {
    case "CHILDCARE_ALLOWANCE_UNDER_2_115": {
      const validFrom = "2026-01-01";
      const validTo = "2026-12-31";
      const { applicationStatus, validityStatus } = resolveAvailability("ROLLING", validFrom, validTo, options);
      const cityLabel = options?.registeredCity ? `${options.registeredCity}兒童戶籍所在地之鄉（鎮、市、區）公所` : "兒童戶籍所在地之鄉（鎮、市、區）公所社會課";

      return {
        policyId: "CHILDCARE_ALLOWANCE_UNDER_2_115",
        programTitle: "育有未滿2歲兒童育兒津貼",
        domain: "CHILDCARE",
        jurisdiction: "全國（衛生福利部社會及家庭署訂定／兒童戶籍地鄉鎮市區公所受理）",
        administeringAgency: "衛生福利部社會及家庭署・各直轄市、縣（市）政府社會局處及鄉（鎮、市、區）公所",
        applicationStatus,
        applicationPeriod: "全年常態受理（隨到隨辦；兒童出生後 60 日內完成出生或初設戶籍登記並申請者，得追溯自出生月份發給）",
        deadlineDate: null,
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "第1名子女每月 5,000 元、第2名子女每月 6,000 元、第3名（含）以上子女每月 7,000 元（112年起已取消排富限制）",
        requiredDocuments: CHILDCARE_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至「衛生福利部社會及家庭署育有未滿2歲兒童育兒津貼線上申請網」（https://twbaby.sfaa.gov.tw/），使用父母雙方之自然人憑證或健保卡登入並上傳應備文件",
          `臨櫃申辦：備妥申請表與應備文件親送至${cityLabel}`,
          `郵寄申辦：備妥簽章之申請表與應備文件影本，以掛號郵寄至${cityLabel}（以郵戳日期為憑）`,
        ],
        onlineApplicationUrl: "https://twbaby.sfaa.gov.tw/",
        formUrl: "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582",
        officeInformation: `${cityLabel}（可先透過 1957 福利諮詢專線或各縣市社會局處查詢轄區公所地址）`,
        contactInformation: "衛生福利部 1957 福利諮詢專線（每日 08:00–22:00 免付費）或各縣市政府社會局處兒少福利科",
        officialSources: sourcesFor(["R8"]),
        exclusions: [
          "兒童已滿 2 歲（滿 24 個月）者，不適用本項未滿 2 歲育兒津貼（滿 2 歲至未滿 5 歲改依教育部 2 至 4 歲育兒津貼或就學補助規定辦理）",
          "兒童正在接受公共化托育服務（公設民營托嬰中心、社區公共托育家園）或準公共托育服務（準公共托嬰中心、準公共居家托育人員／保母）者，不得同時重複領取本津貼",
          "兒童經政府公費安置收容者，不得領取本津貼",
        ],
        nextSteps: [
          ...(options?.missingItems ?? []),
          "確認兒童已完成出生登記或初設戶籍登記，並備妥詳細記事戶口名簿與申請人金融機構存摺封面影本",
          "優先使用「衛福部社家署育有未滿2歲兒童育兒津貼線上申請網」（https://twbaby.sfaa.gov.tw/）或向兒童戶籍地公所提出申請",
          "若於兒童出生後 60 日內提出申請，請確認追溯自出生月份起算之核定通知",
        ],
        warnings: [
          "本津貼採「申請制」，不會自動發放，須由父母雙方或監護人主動向兒童戶籍地公所或線上系統提出申請。",
          "若後續改送托公共化或準公共托嬰中心／保母並改領托育補助，須依規定辦理津貼停發或轉換，避免重複溢領。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    case "TAOYUAN_CENTRAL_RENT_115": {
      const validFrom = "2026-01-01";
      const validTo = "2026-12-31";
      const { applicationStatus, validityStatus } = resolveAvailability("OPEN", validFrom, validTo, options);

      return {
        policyId: "TAOYUAN_CENTRAL_RENT_115",
        programTitle: "300億元中央擴大租金補貼專案計畫（桃園市受理與申辦導航）",
        domain: "HOUSING",
        jurisdiction: "中央政策・桃園市協辦受理（內政部國土管理署主辦／桃園市政府住宅發展處受理審查）",
        administeringAgency: "內政部國土管理署 ／ 桃園市政府住宅發展處（住宅服務科）",
        applicationStatus,
        applicationPeriod: "115年1月1日 09:00 起至 115年12月31日 17:00 止（隨到隨辦）",
        deadlineDate: "2026-12-31",
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "依桃園市租賃行政區分級（每月基本補貼上限 2,400 元至 5,000 元不等）及單身青年（1.2倍）、新婚（1.3倍）、育有未成年子女（1.4倍起）或弱勢加碼倍數計算；實際金額以國土管理署及桃園市住宅發展處核定為準",
        requiredDocuments: TAOYUAN_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦（最推薦）：至內政部國土管理署「300億元中央擴大租金補貼線上申請系統」（https://has.nlma.gov.tw/subsidyOnline/）填寫並上傳租約與存摺影本（免附紙本申請書）",
          "臨櫃申辦：攜帶申請書、桃園市有效定期租賃契約影本與存摺影本，至「桃園市政府住宅發展處（住宅服務科）」（桃園市桃園區力行路300號）現場辦理",
          "郵寄申辦：填妥紙本申請書並簽章，連同應備文件影本以掛號郵寄至「330060 桃園市桃園區力行路300號 桃園市政府住宅發展處住宅服務科收」（以郵戳為憑）",
        ],
        onlineApplicationUrl: "https://has.nlma.gov.tw/subsidyOnline/",
        formUrl: "https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf",
        officeInformation: "桃園市政府住宅發展處（住宅服務科）：330060 桃園市桃園區力行路300號",
        contactInformation: "桃園市政府住宅發展處諮詢專線：(03) 332-4700 轉分機 6 ／ 內政部國土管理署租金補貼專線：(02) 7729-8003",
        officialSources: sourcesFor(["R1", "R9"]),
        exclusions: [
          "家庭成員持有自有住宅者不得申請",
          "家庭成員目前重複領取其他政府住宅補貼或承租社會住宅／包租代管者不得重複領取",
          "桃園市申請案家庭成員每人每月平均所得不得超過桃園市最低生活費 3 倍（115年度標準為新臺幣 50,304 元／月）",
        ],
        nextSteps: [
          ...(options?.missingItems ?? []),
          "確認桃園市租賃契約已清楚載明出租人姓名、承租人姓名與身分證字號、桃園市租賃門牌地址、每月租金與租賃起迄期間",
          "確認家庭成員每人每月平均所得低於桃園市 115 年度標準（50,304 元／月）",
          "前往內政部國土管理署線上申請網站（https://has.nlma.gov.tw/subsidyOnline/）或桃園市政府住宅發展處提出申請",
        ],
        warnings: [
          "本方案為中央內政部國土管理署主辦、桃園市政府住宅發展處協辦受理之全國性擴大租金補貼，並非桃園市單獨另設之地方加碼方案。",
          "目前已完成部分核心資格條件預審（無自有住宅、未重複領取住宅補貼及桃園市所得門檻檢查），房屋稅籍用途與完整家庭財產仍以主管機關審核為準。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    case "CENTRAL_RENT_115": {
      const validFrom = "2026-01-01";
      const validTo = "2026-12-31";
      const { applicationStatus, validityStatus } = resolveAvailability("OPEN", validFrom, validTo, options);

      return {
        policyId: "CENTRAL_RENT_115",
        programTitle: "300億元中央擴大租金補貼專案計畫（115年度）",
        domain: "HOUSING",
        jurisdiction: "全國（內政部國土管理署主辦／各直轄市、縣市政府住宅主管機關協辦）",
        administeringAgency: "內政部國土管理署",
        applicationStatus,
        applicationPeriod: "115年1月1日 09:00 起至 115年12月31日 17:00 止（隨到隨辦）",
        deadlineDate: "2026-12-31",
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "依租賃房屋所在行政區分級（每月 2,000 元至 8,000 元）及加碼倍數計算；實際金額以國土管理署核定為準",
        requiredDocuments: CENTRAL_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至內政部國土管理署「300億元中央擴大租金補貼線上申請系統」（https://has.nlma.gov.tw/subsidyOnline/）填寫並上傳租約與存摺影本",
          "郵寄或臨櫃申辦：填妥紙本申請書並檢附租賃契約影本、存摺封面影本，掛號郵寄或親送至租賃房屋所在地之直轄市、縣（市）政府住宅主管機關",
        ],
        onlineApplicationUrl: "https://has.nlma.gov.tw/subsidyOnline/",
        formUrl: "https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf",
        officeInformation: "內政部國土管理署及各直轄市、縣（市）政府住宅發展／都市發展主管機關",
        contactInformation: "內政部國土管理署 300億元中央擴大租金補貼諮詢專線：(02) 7729-8003（週一至週五 08:00–18:00）",
        officialSources: sourcesFor(["R1"]),
        exclusions: [
          "家庭成員持有自有房屋者不得申請",
          "家庭成員重複享有其他政府住宅補貼者不得申請",
          "家庭成員每人每月平均所得超過租賃地縣市最低生活費 3 倍者不得申請",
        ],
        nextSteps: [
          ...(options?.missingItems ?? []),
          "備妥有效定期租賃契約影本與申請人本人金融機構存摺封面影本",
          "至內政部國土管理署線上申請網站（https://has.nlma.gov.tw/subsidyOnline/）上傳文件完成送件",
        ],
        warnings: [
          "目前已完成部分資格條件檢查（無自有住宅、未重複領取其他政府住宅補貼），但家庭所得、房屋稅籍與租約完整性仍以主管機關審核為準。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    case "TAIPEI_RENT_115": {
      const validFrom = "2026-04-08";
      const validTo = "2027-03-31";
      const { applicationStatus, validityStatus } = resolveAvailability("OPEN", validFrom, validTo, options);

      return {
        policyId: "TAIPEI_RENT_115",
        programTitle: "115年度臺北幸福租－民間租屋租金加碼補貼",
        domain: "HOUSING",
        jurisdiction: "臺北市",
        administeringAgency: "臺北市政府都市發展局（住宅企劃科）",
        applicationStatus,
        applicationPeriod: "115年4月8日起至 116年3月31日止（隨到隨辦）",
        deadlineDate: "2027-03-31",
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "依臺北市家庭所得分級與育兒/弱勢條件加碼核發（須先取得中央300億元擴大租金補貼核定資格）",
        requiredDocuments: TAIPEI_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至臺北市政府都市發展局「租金補貼網」（https://rent-allowance.udd.gov.taipei/）線上填寫並上傳證明文件",
          "郵寄或臨櫃申辦：下載紙本申請書填妥後，連同應備文件掛號郵寄或親送至臺北市政府都市發展局南門辦公室（臺北市中正區羅斯福路一段8號9樓）",
        ],
        onlineApplicationUrl: "https://rent-allowance.udd.gov.taipei/",
        formUrl: "https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf",
        officeInformation: "臺北市政府都市發展局南門辦公室：100207 臺北市中正區羅斯福路一段8號9樓",
        contactInformation: "臺北市政府都市發展局住宅企劃科：(02) 2777-2186 轉 0 再轉 1（或臺北市民當家熱線 1999）",
        officialSources: sourcesFor(["R6"]),
        exclusions: [
          "未設籍於臺北市者不適用本項臺北市加碼補貼",
          "尚未取得中央 300 億元擴大租金補貼核定資格者，須先申請並取得中央核定",
        ],
        nextSteps: [
          ...(options?.missingItems ?? []),
          "確認已取得中央 300 億元擴大租金補貼核定資格並設籍於臺北市",
          "備妥含詳細記事之戶口名簿影本、臺北市租賃契約影本與存摺影本，至臺北市租金補貼網（https://rent-allowance.udd.gov.taipei/）提出申請",
        ],
        warnings: [
          "目前已完成部分資格條件檢查，家庭總所得分級與租賃房屋合法性仍以臺北市政府都市發展局審核為準。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    case "NEW_TAIPEI_RENT_115": {
      const validFrom = "2025-10-01";
      const validTo = "2026-12-31";
      const { applicationStatus, validityStatus } = resolveAvailability("OPEN", validFrom, validTo, options);

      return {
        policyId: "NEW_TAIPEI_RENT_115",
        programTitle: "115年度新北市青年租金補貼",
        domain: "HOUSING",
        jurisdiction: "新北市",
        administeringAgency: "新北市政府城鄉發展局（住宅發展科）",
        applicationStatus,
        applicationPeriod: "114年10月1日起至 115年12月31日止（依公告受理期間辦理）",
        deadlineDate: "2026-12-31",
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "依單身、新婚或育有未成年子女家庭類別核發每月租金補貼；實際金額以新北市政府城鄉發展局核定為準",
        requiredDocuments: NEW_TAIPEI_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至「新北市住宅補貼資訊服務網－青年租金補貼」（https://nths.ntpc.gov.tw/FC）線上填寫並上傳應備文件",
          "紙本郵寄申辦：下載紙本申請書填妥後，連同應備文件影本掛號郵寄至「220242 新北市板橋區中山路一段161號1樓 新北市政府城鄉發展局住宅發展科收」（信封註明申請青年租金補貼）",
        ],
        onlineApplicationUrl: "https://nths.ntpc.gov.tw/FC",
        formUrl: "https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf",
        officeInformation: "新北市政府城鄉發展局住宅發展科：220242 新北市板橋區中山路一段161號1樓",
        contactInformation: "新北市青年租金補貼諮詢專線：(02) 8979-8800 或新北市境內撥 1999",
        officialSources: sourcesFor(["R7"]),
        exclusions: [
          "未於新北市設籍、就學或就業者不得申請",
          "已重複領取中央擴大租金補貼或其他政府住宅補貼者，不得同時兼領（須擇一申請）",
        ],
        nextSteps: [
          ...(options?.missingItems ?? []),
          "備妥近一個月內含詳細記事之全戶戶籍謄本、新北市在學或在職證明（設籍新北市者免附）、有效租約與郵局存摺封面影本",
          "至新北市住宅補貼資訊服務網（https://nths.ntpc.gov.tw/FC）或以掛號郵寄提出申請",
        ],
        warnings: [
          "目前已完成部分資格條件檢查，年齡（年滿18歲至未滿40歲）、家庭年所得與財產限額仍以新北市政府城鄉發展局審核為準。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    default:
      return null;
  }
}
