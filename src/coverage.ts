import type { PolicyCompleteness } from "./status";
import type { BenefitDomain } from "./types";

// Explicit coverage boundary for the current GovAid Atlas version.
// Anything outside this boundary must be reported as NOT_COVERED (or missing
// information), never silently routed to another rule set and never as PASS.

// OTHER: a recognized request for a domain the product does not cover (never rental).
export type CoverageDomain = "RENTAL_SUBSIDY" | "CHILDCARE" | "OTHER";

export type OfficialReferral = {
  label: string;
  agency?: string;
  url?: string;
};

export type CoverageAssessment = {
  status: "COVERED" | "NOT_COVERED";
  domain: CoverageDomain;
  reason: string;
  message: string;
  officialReferrals: OfficialReferral[];
};

export type CityCoverage = {
  status: "COVERED" | "NOT_COVERED" | "MISSING";
  city?: string;
  message: string;
};

// Cities whose local rental programs have encoded rules in src/policies/.
export const COVERED_LOCAL_CITIES = ["臺北市", "新北市"] as const;

// Cities supported via verified central-subsidy local intake & navigation rules in src/policies/.
export const COVERED_CENTRAL_NAVIGATION_CITIES = ["桃園市"] as const;

export const ALL_COVERED_HOUSING_CITIES = [
  ...COVERED_LOCAL_CITIES,
  ...COVERED_CENTRAL_NAVIGATION_CITIES,
] as const;

// Keywords that indicate a childcare / parenting benefit request.
const CHILDCARE_KEYWORDS = [
  "育兒",
  "育嬰",
  "托育",
  "托嬰",
  "幼兒",
  "生育",
  "嬰兒",
  "保母",
  "保姆",
  "準公共",
  "未滿2歲",
  "未滿二歲",
  "childcare",
  "child care",
  "parental leave",
];

// Childcare-adjacent programs that are NOT covered by the under-2 childcare allowance workflow.
const UNSUPPORTED_CHILDCARE_KEYWORDS = [
  "托育補助",
  "準公共托育補助",
  "生育津貼",
  "生育獎勵",
  "生育補助",
  "就學補助",
  "幼兒園補助",
  "育嬰留職停薪",
  "parental leave",
];

// Housing programs that are NOT covered by our verified rental subsidy workflows.
const UNSUPPORTED_HOUSING_KEYWORDS = [
  "桃園市地方加碼",
  "桃園地方加碼",
  "桃園市地方租屋補助",
  "桃園地方租屋補助",
  "原住民族租金補貼",
  "原住民租金補貼",
  "包租代管",
  "購屋貸款",
  "青年購屋",
  "修繕住宅",
];

// General public assistance programs outside the scope of housing & childcare.
const UNSUPPORTED_GENERAL_KEYWORDS = [
  "老人",
  "長照",
  "身心障礙",
  "急難救助",
  "失業",
  "年金",
  "勞保",
  "健保",
  "重陽",
  "敬老",
  "假牙",
  "農民",
  "漁民",
  "學貸",
  "就學貸款",
  "獎學金",
];

// Words that make a request a housing / rental request.
const HOUSING_KEYWORDS = ["租", "房", "住宅", "住屋", "居住", "rent", "housing", "lease"];

function isHousingQuery(text: string): boolean {
  return HOUSING_KEYWORDS.some((keyword) => text.includes(keyword));
}

const OUTSIDE_VERIFIED_COVERAGE_MESSAGE =
  "您查詢的政策／領域不在目前已驗證的涵蓋範圍內（Requested policy/domain is outside current verified coverage）。目前版本僅涵蓋特定租屋補貼與未滿2歲育兒津貼，因此無法作成該項補助之資格判定，也不會改以租屋補貼回答。這不代表您無法申請，請以主管機關官方公告為準。";

const GENERAL_WELFARE_REFERRALS: OfficialReferral[] = [
  {
    label: "衛生福利部 1957 福利諮詢專線",
    agency: "衛生福利部",
    url: "https://1957.mohw.gov.tw/",
  },
];

function outsideVerifiedCoverage(): CoverageAssessment {
  return {
    status: "NOT_COVERED",
    domain: "OTHER",
    reason: "UNSUPPORTED_DOMAIN_NOT_IMPLEMENTED",
    message: OUTSIDE_VERIFIED_COVERAGE_MESSAGE,
    officialReferrals: GENERAL_WELFARE_REFERRALS,
  };
}

export function isLocalOnlyHousingQuery(goal: string): boolean {
  const text = goal.toLowerCase();
  return text.includes("地方租屋補助") || text.includes("地方加碼");
}

export function detectBenefitDomain(goal: string): BenefitDomain {
  const text = goal.toLowerCase();
  if (CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "CHILDCARE";
  }
  return "HOUSING";
}

// Administrative list of Taiwan's 22 municipalities / counties / cities. This is a
// data-entry validation list only; it does NOT change which cities are covered by
// encoded policies (see COVERED_LOCAL_CITIES / COVERED_CENTRAL_NAVIGATION_CITIES).
export const TAIWAN_CITIES = [
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "嘉義市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;

export function isSupportedTaiwanCity(city: string | undefined): boolean {
  const normalized = normalizeCityName(city);
  return Boolean(normalized && (TAIWAN_CITIES as readonly string[]).includes(normalized));
}

export function normalizeCityName(city: string | undefined): string | undefined {
  const trimmed = city?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^台/, "臺");
}

export function assessQueryCoverage(goal: string): CoverageAssessment {
  const text = goal.toLowerCase();
  if (CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    if (UNSUPPORTED_CHILDCARE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return {
        status: "NOT_COVERED",
        domain: "CHILDCARE",
        reason: "CHILDCARE_POLICY_NOT_IMPLEMENTED",
        message:
          "目前版本僅涵蓋「育有未滿2歲兒童育兒津貼」，尚未涵蓋托育補助、生育獎勵金、就學補助或育嬰留職停薪津貼，因此無法作成該項補助之資格判定。這不代表您無法申請，請以主管機關官方公告為準。",
        officialReferrals: [
          {
            label: "衛生福利部社會及家庭署－未滿2歲兒童育兒津貼與托育補助專區",
            agency: "衛生福利部社會及家庭署",
            url: "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582",
          },
          {
            label: "育有未滿2歲兒童育兒津貼線上申請網",
            agency: "衛生福利部社會及家庭署",
            url: "https://twbaby.sfaa.gov.tw/",
          },
        ],
      };
    }

    return {
      status: "COVERED",
      domain: "CHILDCARE",
      reason: "CHILDCARE_UNDER2_ALLOWANCE_IN_SCOPE",
      message:
        "目前版本已支援「育有未滿2歲兒童育兒津貼（115年度）」之資格預審、胎次金額試算與申辦導航。",
      officialReferrals: [
        {
          label: "育有未滿2歲兒童育兒津貼線上申請網",
          agency: "衛生福利部社會及家庭署",
          url: "https://twbaby.sfaa.gov.tw/",
        },
      ],
    };
  }

  if (UNSUPPORTED_HOUSING_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_HOUSING_POLICY_NOT_IMPLEMENTED",
      message:
        "目前版本僅涵蓋「300億元中央擴大租金補貼（含雙北與桃園市受理導航）」、「臺北市臺北幸福租加碼」與「新北市青年租金補貼」，尚未涵蓋桃園市獨立地方租屋補助、原住民族專案租金補貼、社會住宅包租代管或購屋貸款補貼。請以主管機關官方公告為準。",
      officialReferrals: [
        {
          label: "內政部國土管理署－300億元中央擴大租金補貼線上申請系統",
          agency: "內政部國土管理署",
          url: "https://has.nlma.gov.tw/subsidyOnline/",
        },
        {
          label: "桃園市政府住宅發展處官方網站",
          agency: "桃園市政府住宅發展處",
          url: "https://ohd.tycg.gov.tw/",
        },
      ],
    };
  }

  const normalizedText = text.replace(/台/g, "臺");
  const housingQuery = isHousingQuery(normalizedText);

  // Another domain (e.g. "花蓮縣老人假牙補助", "農民津貼") is never reinterpreted as a
  // rental-subsidy request and never sent to rental-subsidy resources.
  // Generic requests without a domain keyword (e.g. "檢查補助資格") keep the existing default.
  if (
    !housingQuery &&
    UNSUPPORTED_GENERAL_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))
  ) {
    return outsideVerifiedCoverage();
  }

  // Check if query explicitly targets an unsupported city for housing / rental subsidy
  const matchedCity = TAIWAN_CITIES.find((c) => normalizedText.includes(c));
  if (housingQuery && matchedCity && !(ALL_COVERED_HOUSING_CITIES as readonly string[]).includes(matchedCity)) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_CITY_HOUSING_POLICY_NOT_IMPLEMENTED",
      message: `目前版本僅涵蓋雙北及桃園市（受理導航）之租金補貼，尚未完整涵蓋${matchedCity}地方租屋補助，因此無法作成該縣市補助之資格判定。請以主管機關官方公告為準。`,
      officialReferrals: [
        {
          label: "內政部國土管理署－300億元中央擴大租金補貼線上申請系統",
          agency: "內政部國土管理署",
          url: "https://has.nlma.gov.tw/subsidyOnline/",
        },
      ],
    };
  }

  if (UNSUPPORTED_GENERAL_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_DOMAIN_NOT_IMPLEMENTED",
      message:
        "目前版本僅涵蓋特定租屋補貼與未滿2歲育兒津貼，尚未涵蓋此類政策項目，因此無法作成該項補助之資格判定。請以主管機關官方公告為準。",
      officialReferrals: [
        {
          label: "衛生福利部 1957 福利諮詢專線",
          agency: "衛生福利部",
          url: "https://1957.mohw.gov.tw/",
        },
      ],
    };
  }

  return {
    status: "COVERED",
    domain: "RENTAL_SUBSIDY",
    reason: "RENTAL_SUBSIDY_IN_SCOPE",
    message: "目前版本可進行租屋補助的部分條件預審與申辦導航。",
    officialReferrals: [],
  };
}

export function assessCityCoverage(
  city: string | undefined,
  options?: { localOnly?: boolean }
): CityCoverage {
  const normalized = normalizeCityName(city);
  if (!normalized) {
    return {
      status: "MISSING",
      message: "缺少租屋地址所在縣市，無法判定適用的地方方案。",
    };
  }

  if ((COVERED_LOCAL_CITIES as readonly string[]).includes(normalized)) {
    return {
      status: "COVERED",
      city: normalized,
      message: `${normalized}地方方案已有部分規則可供預審。`,
    };
  }

  if (
    !options?.localOnly &&
    (COVERED_CENTRAL_NAVIGATION_CITIES as readonly string[]).includes(normalized)
  ) {
    return {
      status: "COVERED",
      city: normalized,
      message: `${normalized}已支援「300億元中央擴大租金補貼（桃園市政府住宅發展處協辦受理）」之部分條件預審與申辦導航（桃園市無另設全市通用地方租金加碼，其他特定族群專案不在本系統預審範圍）。`,
    };
  }

  return {
    status: "NOT_COVERED",
    city: normalized,
    message: `目前版本尚未完整涵蓋${normalized}此類補助，因此無法作成完整資格判定。請以該縣市主管機關官方公告為準。`,
  };
}

// Completeness of the encoded policies.
// - Housing rental policies encode a subset of the official eligibility conditions -> PARTIAL
// - CHILDCARE_ALLOWANCE_UNDER_2_115 encodes the complete official national eligibility rules -> COMPLETE
export const POLICY_COMPLETENESS: Record<string, PolicyCompleteness> = {
  CENTRAL_RENT_115: "PARTIAL",
  NEW_TAIPEI_RENT_115: "PARTIAL",
  TAIPEI_RENT_115: "PARTIAL",
  TAOYUAN_CENTRAL_RENT_115: "PARTIAL",
  CHILDCARE_ALLOWANCE_UNDER_2_115: "COMPLETE",
};

export function getPolicyCompleteness(policyId: string): PolicyCompleteness {
  return POLICY_COMPLETENESS[policyId] ?? "PARTIAL";
}

export const PARTIAL_CHECK_NOTE =
  "本系統目前僅檢查已編碼的部分條件；所得、財產、年齡、家戶等其他資格條件尚未由本系統驗證，最終資格以主管機關審查為準。";
