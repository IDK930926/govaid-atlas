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

/**
 * 每月補貼金額上限 by tier, verbatim from 三百億元中央擴大租金補貼專案計畫作業規定 附表四
 * (國署住字第1151002186號令修正，行政院公報 第032卷第006期 2026-01-09，自115/1/1生效).
 * The tier is set by household composition / low-income status, NOT by district:
 *   第一級：家庭成員二人以上且具低收入戶身分，或三人以上且具中低收入戶身分
 *   第二級：非屬第一級及第三級
 *   第三級：家庭成員一人、未滿四十歲，且未具經濟或社會弱勢身分
 * GovAid does not collect household size or low-/middle-low-income / social-disadvantage
 * status, so it never determines the tier; it can only show the 第三級 base for comparison.
 */
export type CentralRentTierAmounts = { tier1: number; tier2: number; tier3: number };

export const CENTRAL_RENT_TIER_TABLE: Record<string, Array<{ districts: readonly string[] | "ALL"; amounts: CentralRentTierAmounts }>> = {
  "臺北市": [{ districts: "ALL", amounts: { tier1: 8000, tier2: 5000, tier3: 3000 } }],
  "新北市": [
    {
      districts: [
        "三重區", "土城區", "中和區", "永和區", "汐止區", "板橋區", "新店區", "新莊區", "蘆洲區", "八里區",
        "三峽區", "五股區", "林口區", "泰山區", "淡水區", "深坑區", "樹林區", "鶯歌區",
      ],
      amounts: { tier1: 5000, tier2: 4000, tier3: 2400 },
    },
    {
      districts: [
        "三芝區", "平溪區", "石門區", "石碇區", "坪林區", "金山區", "烏來區", "貢寮區", "瑞芳區", "萬里區", "雙溪區",
      ],
      amounts: { tier1: 3600, tier2: 3200, tier3: 2000 },
    },
  ],
  "桃園市": [{ districts: "ALL", amounts: { tier1: 5000, tier2: 4000, tier3: 2400 } }],
};

/** Official 附表四 amounts for a city/district, or null when the district is unknown/unlisted. */
export function lookupCentralRentTierAmounts(city: string, district?: string): CentralRentTierAmounts | null {
  const rows = CENTRAL_RENT_TIER_TABLE[city];
  if (!rows) return null;
  const row = rows.find((item) => item.districts === "ALL" || (district !== undefined && item.districts.includes(district)));
  return row?.amounts ?? null;
}

/** Label for a tier-unknown base estimate: never claims a tier was determined. */
export const CENTRAL_TIER3_BASE_LABEL = "中央 R1 第三級基準（級距未判定）";
export const CENTRAL_TIER_UNDETERMINED_NOTE =
  "本系統未取得家庭人數、低收／中低收入戶或社會弱勢身分，未判定補貼級距；僅以第三級（單身未滿40歲、無經濟或社會弱勢身分）基準估算，未計加碼倍數。";

export function describeCentralTierTable(amounts: CentralRentTierAmounts): string {
  return `附表四級距：第一級 NT$${amounts.tier1.toLocaleString()}／第二級 NT$${amounts.tier2.toLocaleString()}／第三級 NT$${amounts.tier3.toLocaleString()}`;
}

/**
 * 每月租金補貼金額加碼表, verbatim from 作業規定 附表五 (same 115/1/9 amendment, 自115/1/1生效).
 * Marriage / newborn multipliers depend on the event date relative to 115/1/1 (2026-01-01).
 * GovAid does not collect marriage-registration or child birth dates, so it presents both
 * schedules and never selects a multiplier for the applicant.
 */
export const CENTRAL_RENT_MULTIPLIER_REFORM_DATE = "2026-01-01";
export const CENTRAL_RENT_MULTIPLIERS = {
  singleYouth: 1.2,
  economicallyDisadvantaged: 1.4,
  sociallyDisadvantaged: 1.2,
  newlywed: { registeredOnOrBefore20251231: 1.3, registeredOnOrAfter20260101: 1.5 },
  /** 子女均非 115/1/1 以後出生（含胎兒）：1人1.4、2人1.6、3人1.8，逾3人每增1名 +0.2 */
  minorChildrenPreReform: { base: 1.4, step: 0.2 },
  /** 115/1/1 以後（含）有新生兒出生：1人2、2人2.5、3人3，逾3人每增1名 +0.5 */
  newbornPostReform: { base: 2.0, step: 0.5 },
} as const;

/** Table lookup only (附表五); callers must know the event date — GovAid's applicant model does not. */
export function centralRentChildMultiplier(schedule: "PRE_115" | "POST_115_NEWBORN", children: number): number | null {
  if (!Number.isInteger(children) || children < 1) return null;
  const { base, step } = schedule === "PRE_115"
    ? CENTRAL_RENT_MULTIPLIERS.minorChildrenPreReform
    : CENTRAL_RENT_MULTIPLIERS.newbornPostReform;
  return Math.round((base + step * (children - 1)) * 10) / 10;
}

export const CENTRAL_RENT_MULTIPLIER_DATE_NOTE =
  "新婚與育兒加碼倍數依結婚登記日或新生兒出生日是否在 115/1/1 以後而不同；本系統未取得上述日期，不判定適用倍數。";

export function describeCentralRentMultipliers(): string {
  const m = CENTRAL_RENT_MULTIPLIERS;
  return [
    `加碼倍數（附表五）：單身青年 ${m.singleYouth} 倍`,
    `新婚家庭：114/12/31 前（含）登記結婚 ${m.newlywed.registeredOnOrBefore20251231} 倍、115/1/1 後（含）登記結婚 ${m.newlywed.registeredOnOrAfter20260101} 倍`,
    `育有未成年子女（胎兒）且子女非 115/1/1 後出生：1人 1.4 倍、2人 1.6 倍、3人 1.8 倍，逾3人每增1名加 0.2 倍`,
    `115/1/1 後（含）有新生兒出生：1人 2 倍、2人 2.5 倍、3人 3 倍，逾3人每增1名加 0.5 倍`,
    `經濟弱勢 ${m.economicallyDisadvantaged} 倍、社會弱勢 ${m.sociallyDisadvantaged} 倍；同時符合者擇高`,
  ].join("；");
}

export const RENTAL_SUBSIDY_COMPARISON_METADATA = {
  "臺北市": {
    options: [
      { policyId: "CENTRAL_RENT_115", description: CENTRAL_TIER3_BASE_LABEL, minNtd: 3000, maxNtd: 3000 },
    ],
    note: "未設籍臺北市者不適用北市 R6。",
  },
  "新北市": {
    options: [
      // 附表四 新北市（含永和區）第三級 = 2,400；偏遠 11 區第三級 = 2,000 (resolved per district below).
      { policyId: "CENTRAL_RENT_115", description: CENTRAL_TIER3_BASE_LABEL, minNtd: 2400, maxNtd: 2400 },
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

  const policyOf = (policyId: string) =>
    result.policyResults.find((policy) => policy.policyId === policyId);
  // A program whose answered condition cannot be resolved (e.g. location of an owned home)
  // is not estimated either: showing an amount would imply the condition is likely met.
  const isPendingBlocked = (policyId: string) =>
    Boolean(policyOf(policyId)?.evaluations.some((evaluation) => evaluation.blocksEstimate));
  // Central R1 amount comes from 附表四 for the scenario's district; an unknown or unlisted
  // district yields no central estimate rather than a guessed bracket.
  const tierAmounts = lookupCentralRentTierAmounts(city ?? "", result.scenario.district);
  const options = metadata.options
    .map((option) => option.policyId === "CENTRAL_RENT_115"
      ? tierAmounts ? { ...option, minNtd: tierAmounts.tier3, maxNtd: tierAmounts.tier3 } : null
      : option)
    .filter((option): option is NonNullable<typeof option> => {
      if (!option) return false;
      const status = policyOf(option.policyId)?.eligibilityStatus;
      return status !== "FAIL" && status !== "NOT_COVERED" && !isPendingBlocked(option.policyId);
    });
  const usesCentralBase = options.some((option) => option.policyId === "CENTRAL_RENT_115");
  const hasPendingExclusion = metadata.options.some((option) => isPendingBlocked(option.policyId));
  if (options.length === 0 && hasPendingExclusion) {
    return {
      maxSubsidy: "不提供估算：已涵蓋之補助方案資格未通過，或自有住宅條件仍待確認",
      outOfPocket: "不適用（無可估算之補助）",
      note: "資格未通過或條件待確認之方案不列入補助後租金試算。",
    };
  }
  if (options.length === 0 && !tierAmounts) {
    return {
      maxSubsidy: "目前無可用級距估算：租賃行政區未確認",
      outOfPocket: "—",
      note: "中央租金補貼金額依租賃行政區及家庭級距而定，請以主管機關核定為準。",
    };
  }
  if (options.length === 0) {
    return {
      maxSubsidy: "不適用：本情境已涵蓋之補助方案資格皆未通過",
      outOfPocket: "不適用（無可估算之補助）",
      note: "資格未通過之方案不列入補助後租金試算。",
    };
  }

  const maxSubsidy = options
    .map((option) => option.policyId === "CENTRAL_RENT_115"
      ? `${option.description} ${formatNtdRange(option.minNtd, option.maxNtd)} / 月`
      : `${option.description}最高 ${formatNtdRange(option.minNtd, option.maxNtd)} / 月`)
    .join("；");
  const tierDisclosure = usesCentralBase && tierAmounts
    ? `${CENTRAL_TIER_UNDETERMINED_NOTE}${describeCentralTierTable(tierAmounts)}。`
    : "";
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
    : !tierAmounts
      ? "租賃行政區未確認，中央 R1 未列入估算。"
      : options.length < metadata.options.length
      ? hasPendingExclusion
        ? "已排除資格未通過或自有住宅條件待確認之方案。"
        : "已排除本情境資格未通過之方案。"
      : metadata.note;

  return {
    maxSubsidy: `${maxSubsidy}；${note}${tierDisclosure ? ` ${tierDisclosure}` : ""}`,
    outOfPocket,
    note: usesCentralBase
      ? "依月租扣除上列金額試算（中央 R1 以第三級基準計，級距未判定）；實際金額以主管機關核定級距及加碼倍數為準。"
      : "依月租扣除最高補助試算；實際金額以主管機關核定級距為準。",
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
    title: "116年度新北市青年租金補貼申請書（線上申請者免附紙本）",
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
        stoppedNotes: [
          "若後續改採托育補助，請依主管機關規定辦理原津貼停發／轉換；此為資訊提醒，不代表目前建議申請。",
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
        benefitAmountFormula: `桃園市每月補貼上限依家庭級距（附表四）：第一級 5,000 元／第二級 4,000 元／第三級 2,400 元，本系統未判定級距。${describeCentralRentMultipliers()}。${CENTRAL_RENT_MULTIPLIER_DATE_NOTE}實際金額以國土管理署及桃園市住宅發展處核定為準`,
        requiredDocuments: TAOYUAN_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦（最推薦）：至內政部國土管理署「300億元中央擴大租金補貼線上申請系統」（https://has.nlma.gov.tw/subsidyOnline/）填寫並上傳租約與存摺影本（免附紙本申請書）",
          "臨櫃申辦：攜帶申請書、桃園市有效定期租賃契約影本與存摺影本，至「桃園市政府住宅發展處（住宅服務科）」（桃園市桃園區力行路300號）現場辦理",
          "郵寄申辦：填妥紙本申請書並簽章，連同應備文件影本以掛號郵寄至「330060 桃園市桃園區力行路300號 桃園市政府住宅發展處住宅服務科收」（以郵戳為憑）",
        ],
        onlineApplicationUrl: "https://has.nlma.gov.tw/subsidyOnline/",
        formUrl: "https://pip.moi.gov.tw/Upload/HouSubsidy/File2/115Y_01_租金補貼申請書.pdf",
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
        benefitAmountFormula: "依租賃房屋所在縣市／行政區及家庭級距（附表四第一級至第三級，依家庭人數與低收／中低收入戶身分等判定；本系統未判定級距）每月上限 2,000 元至 8,000 元，並依附表五加碼倍數計算（新婚與育兒倍數依結婚登記日或新生兒出生日是否在 115/1/1 以後而不同）；實際金額以國土管理署核定為準",
        requiredDocuments: CENTRAL_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至內政部國土管理署「300億元中央擴大租金補貼線上申請系統」（https://has.nlma.gov.tw/subsidyOnline/）填寫並上傳租約與存摺影本",
          "郵寄或臨櫃申辦：填妥紙本申請書並檢附租賃契約影本、存摺封面影本，掛號郵寄或親送至租賃房屋所在地之直轄市、縣（市）政府住宅主管機關",
        ],
        onlineApplicationUrl: "https://has.nlma.gov.tw/subsidyOnline/",
        formUrl: "https://pip.moi.gov.tw/Upload/HouSubsidy/File2/115Y_01_租金補貼申請書.pdf",
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

    // policyId keeps its historical "_115" suffix (stable id used by benchmark cases); the
    // programme content is the 116年度 edition (新北城住字第1151855676號公告, 115/9/23).
    case "NEW_TAIPEI_RENT_115": {
      const validFrom = "2026-10-01";
      const validTo = "2027-12-31";
      const { applicationStatus, validityStatus } = resolveAvailability("OPEN", validFrom, validTo, options);

      return {
        policyId: "NEW_TAIPEI_RENT_115",
        programTitle: "116年度新北市青年租金補貼",
        domain: "HOUSING",
        jurisdiction: "新北市",
        administeringAgency: "新北市政府城鄉發展局（住宅發展科）",
        applicationStatus,
        applicationPeriod: "115年10月1日起至 116年12月31日止，或至年度經費用罄為止（新北城住字第1151855676號公告）",
        deadlineDate: "2027-12-31",
        validityStatus,
        validFrom,
        validTo,
        estimatedMonthlyBenefitNtd: options?.estimatedMonthlyBenefitNtd ?? null,
        benefitAmountFormula: "每月補貼：單身 3,500 元、新婚 4,500 元、育（孕）有未成年子女 1 人 5,000 元／2 人 6,000 元／3 人以上 7,000 元（116年度公告）；實際金額以新北市政府城鄉發展局核定為準",
        requiredDocuments: NEW_TAIPEI_RENT_REQUIRED_DOCUMENTS,
        applicationMethods: [
          "線上申辦：至「新北市住宅補貼資訊服務網－青年租金補貼」（https://nths.ntpc.gov.tw/FC）線上填寫並上傳應備文件",
          "紙本郵寄申辦：下載紙本申請書填妥後，連同應備文件影本掛號郵寄至「220242 新北市板橋區中山路一段161號1樓 新北市政府城鄉發展局住宅發展科收」（信封註明申請青年租金補貼）",
        ],
        onlineApplicationUrl: "https://nths.ntpc.gov.tw/FC",
        formUrl: "https://www.planning.ntpc.gov.tw/uploaddowndoc?file=planningapply/202610010853260.pdf&filedisplay=116%E5%B9%B4%E5%BA%A6%E6%96%B0%E5%8C%97%E5%B8%82%E9%9D%92%E5%B9%B4%E7%A7%9F%E9%87%91%E8%A3%9C%E8%B2%BC%E7%94%B3%E8%AB%8B%E6%9B%B8.pdf&flag=doc",
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
          "本系統未檢核：年齡（年滿18歲至未滿40歲）、116年度家庭所得門檻（家庭年收入低於145萬元，且每人每月平均收入低於62,125元）與不動產持有狀況，仍以新北市政府城鄉發展局審核為準。",
          "受理至116年12月31日或年度經費用罄為止；115年度方案已於115年10月1日停止受理。",
        ],
        disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
      };
    }

    default:
      return null;
  }
}
