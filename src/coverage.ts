import type { PolicyCompleteness } from "./status";
import type { BenefitDomain } from "./types";
import { TAIWAN_CITIES, normalizeCityName } from "./taiwan-cities";
import { analyzeRequestIntent, type RequestIntent, type TopicKey } from "./intent";
import { extractHousingFactsTyped } from "./fact-extraction";

export { TAIWAN_CITIES, normalizeCityName };

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

/**
 * One part of a (possibly mixed) request. A request can hold a supported part and a part
 * outside coverage; the supported part keeps its workflow and the other part is referred.
 */
export type CoverageComponent = {
  key: string;
  label: string;
  status: "COVERED" | "NOT_COVERED";
  message: string;
  referral?: OfficialReferral;
};

export type CoverageAssessment = {
  status: "COVERED" | "NOT_COVERED";
  domain: CoverageDomain;
  reason: string;
  message: string;
  officialReferrals: OfficialReferral[];
  /** Present when the request decomposes into several parts (see CoverageComponent). */
  components?: CoverageComponent[];
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

const OUTSIDE_VERIFIED_COVERAGE_MESSAGE =
  "您查詢的政策／領域不在目前已驗證的涵蓋範圍內（Requested policy/domain is outside current verified coverage）。目前版本僅涵蓋特定租屋補貼與未滿2歲育兒津貼，因此無法作成該項補助之資格判定，也不會改以租屋補貼回答。這不代表您無法申請，請以主管機關官方公告為準。";

const GENERAL_WELFARE_REFERRALS: OfficialReferral[] = [
  {
    label: "衛生福利部 1957 福利諮詢專線",
    agency: "衛生福利部",
    url: "https://1957.mohw.gov.tw/",
  },
];

// Topic-specific official referrals for requests outside coverage (verified 2026-11-17).
const TOPIC_COMPONENTS: Partial<Record<TopicKey, Omit<CoverageComponent, "status">>> = {
  LONG_TERM_CARE: {
    key: "LONG_TERM_CARE",
    label: "長期照顧服務（長照）",
    message: "長照服務不在本系統涵蓋範圍，不作資格判定；請洽 1966 長照服務專線或衛福部長照專區。",
    referral: { label: "衛生福利部長照專區（1966 長照服務專線）", agency: "衛生福利部", url: "https://1966.gov.tw/" },
  },
  FARMER_ALLOWANCE: {
    key: "FARMER_ALLOWANCE",
    label: "老年農民福利津貼",
    message: "老年農民福利津貼不在本系統涵蓋範圍，不作資格判定；主責機關為勞動部勞工保險局。",
    referral: { label: "勞動部勞工保險局", agency: "勞動部勞工保險局", url: "https://www.bli.gov.tw/" },
  },
  VOCATIONAL_TRAINING: {
    key: "VOCATIONAL_TRAINING",
    label: "職業訓練生活津貼",
    message: "職業訓練生活津貼不在本系統涵蓋範圍，不作資格判定；請洽勞動部勞動力發展署。",
    referral: { label: "勞動部勞動力發展署", agency: "勞動部勞動力發展署", url: "https://www.wda.gov.tw/" },
  },
  OTHER_WELFARE: {
    key: "OTHER_WELFARE",
    label: "其他社會福利項目",
    message: "此項福利不在本系統涵蓋範圍，不作資格判定；請洽主管機關或 1957 福利諮詢專線。",
    referral: GENERAL_WELFARE_REFERRALS[0],
  },
  UNSUPPORTED_CHILDCARE: {
    key: "UNSUPPORTED_CHILDCARE",
    label: "生育／就學／育嬰留職停薪等其他育兒相關給付",
    message: "此項給付不在本系統涵蓋範圍，不作資格判定；請以主管機關官方公告為準。",
  },
};

const CHILDCARE_SUBSIDY_COMPONENT: Omit<CoverageComponent, "status"> = {
  key: "CHILDCARE_SUBSIDY",
  label: "托育費用補助（公共化／準公共托育）",
  message:
    "托育費用補助尚未納入本系統規則，不作資格判定或金額試算；請洽衛生福利部社會及家庭署或戶籍地地方政府。",
  referral: {
    label: "衛生福利部社會及家庭署－未滿2歲兒童育兒津貼與托育補助專區",
    agency: "衛生福利部社會及家庭署",
    url: "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582",
  },
};

function notCoveredComponents(intent: RequestIntent): CoverageComponent[] {
  return intent.unsupported
    .map((topic) => TOPIC_COMPONENTS[topic])
    .filter((component): component is Omit<CoverageComponent, "status"> => Boolean(component))
    .map((component) => ({ ...component, status: "NOT_COVERED" as const }));
}

function outsideVerifiedCoverage(intent?: RequestIntent): CoverageAssessment {
  const components = intent ? notCoveredComponents(intent) : [];
  const referrals = components.map((component) => component.referral).filter((ref): ref is OfficialReferral => Boolean(ref));
  const unique = referrals.filter((ref, index) => referrals.findIndex((other) => other.url === ref.url) === index);
  return {
    status: "NOT_COVERED",
    domain: "OTHER",
    reason: "UNSUPPORTED_DOMAIN_NOT_IMPLEMENTED",
    message: OUTSIDE_VERIFIED_COVERAGE_MESSAGE,
    officialReferrals: unique.length ? unique : GENERAL_WELFARE_REFERRALS,
    ...(components.length ? { components } : {}),
  };
}

/** The user asks only about a city's own local programme (central not requested or explicitly excluded). */
export function isLocalOnlyHousingQuery(goal: string): boolean {
  const intent = analyzeRequestIntent(goal);
  return intent.localOnly && !intent.housingNegated;
}

function asksHousing(intent: RequestIntent): boolean {
  return intent.mentions.some(
    (m) => m.polarity === "INTENT" && (m.topic === "HOUSING_SUBSIDY" || m.topic === "CENTRAL_RENT" || m.topic === "LOCAL_RENT_PROGRAM")
  );
}

function asksChildcare(intent: RequestIntent): boolean {
  return intent.childcareAllowance || intent.childcareSubsidy || intent.unsupported.includes("UNSUPPORTED_CHILDCARE");
}

/**
 * Domain routing by intent polarity: a policy word inside a negation ("育兒跟我無關") or a
 * status clause ("沒有請領托育補助") never routes the case into that domain.
 */
export function detectBenefitDomain(goal: string): BenefitDomain {
  const intent = analyzeRequestIntent(goal);
  const childcare = asksChildcare(intent);
  const housing = asksHousing(intent) && !intent.housingNegated;
  if (childcare) return "CHILDCARE";
  if (housing) return "HOUSING";
  if (intent.housing) return "HOUSING";
  if (intent.childcareContext) return "CHILDCARE";
  return "HOUSING";
}

export function isSupportedTaiwanCity(city: string | undefined): boolean {
  const normalized = normalizeCityName(city);
  return Boolean(normalized && (TAIWAN_CITIES as readonly string[]).includes(normalized));
}

const CHILDCARE_NOT_IMPLEMENTED_MESSAGE =
  "目前版本僅涵蓋「育有未滿2歲兒童育兒津貼」，尚未涵蓋托育補助、生育獎勵金、就學補助或育嬰留職停薪津貼，因此無法作成該項補助之資格判定。這不代表您無法申請，請以主管機關官方公告為準。";

const CHILDCARE_NOT_IMPLEMENTED_REFERRALS: OfficialReferral[] = [
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
];

const NLMA_REFERRAL: OfficialReferral = {
  label: "內政部國土管理署－300億元中央擴大租金補貼線上申請系統",
  agency: "內政部國土管理署",
  url: "https://has.nlma.gov.tw/subsidyOnline/",
};

/** Residence city for coverage: the extracted rental city (district-aware), else a literal city name. */
function housingCityOf(goal: string): string | undefined {
  const extracted = extractHousingFactsTyped(goal.normalize("NFKC")).facts.city;
  if (extracted?.state === "KNOWN_VALUE" && typeof extracted.value === "string") return extracted.value;
  const normalizedText = goal.replace(/台/g, "臺");
  return TAIWAN_CITIES.find((c) => normalizedText.includes(c));
}

export function assessQueryCoverage(goal: string): CoverageAssessment {
  const text = goal.toLowerCase();
  const intent = analyzeRequestIntent(goal);
  const extraComponents = notCoveredComponents(intent);
  const withComponents = (assessment: CoverageAssessment, components: CoverageComponent[]): CoverageAssessment =>
    components.length ? { ...assessment, components } : assessment;

  // ---- Childcare -----------------------------------------------------------
  if (detectBenefitDomain(goal) === "CHILDCARE") {
    const allowanceAsked = intent.childcareAllowance || (!intent.childcareSubsidy && !intent.unsupported.includes("UNSUPPORTED_CHILDCARE"));
    if (!allowanceAsked) {
      // Only a not-implemented childcare scheme is asked (e.g. 托育費用補助 only).
      return withComponents(
        {
          status: "NOT_COVERED",
          domain: "CHILDCARE",
          reason: "CHILDCARE_POLICY_NOT_IMPLEMENTED",
          message: CHILDCARE_NOT_IMPLEMENTED_MESSAGE,
          officialReferrals: CHILDCARE_NOT_IMPLEMENTED_REFERRALS,
        },
        [
          ...(intent.childcareSubsidy ? [{ ...CHILDCARE_SUBSIDY_COMPONENT, status: "NOT_COVERED" as const }] : []),
          ...extraComponents,
        ]
      );
    }
    // Supported allowance part stays evaluable; a co-asked subsidy is reported separately.
    const components: CoverageComponent[] = [
      {
        key: "CHILDCARE_ALLOWANCE_UNDER_2",
        label: "育有未滿2歲兒童育兒津貼（115年度）",
        status: "COVERED",
        message: "可進行資格預審、胎次金額試算與申辦導航。",
      },
      ...(intent.childcareSubsidy ? [{ ...CHILDCARE_SUBSIDY_COMPONENT, status: "NOT_COVERED" as const }] : []),
      ...extraComponents,
    ];
    return withComponents(
      {
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
      },
      components.length > 1 ? components : []
    );
  }

  // ---- Not housing and not childcare: another domain, never re-routed to rental ----
  const housingRequested = intent.housing && !intent.housingNegated;
  if (!housingRequested && (intent.unsupported.length > 0 || intent.housingNegated || intent.childcareNegated)) {
    return outsideVerifiedCoverage(intent);
  }

  // ---- Housing --------------------------------------------------------------
  if (
    // Explicit unsupported housing programme; only an explicit central request keeps a supported part.
    UNSUPPORTED_HOUSING_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase())) &&
    !intent.centralIntent
  ) {
    return {
      status: "NOT_COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "UNSUPPORTED_HOUSING_POLICY_NOT_IMPLEMENTED",
      message:
        "目前版本僅涵蓋「300億元中央擴大租金補貼（含雙北與桃園市受理導航）」、「臺北市臺北幸福租加碼」與「新北市青年租金補貼」，尚未涵蓋桃園市獨立地方租屋補助、原住民族專案租金補貼、社會住宅包租代管或購屋貸款補貼。請以主管機關官方公告為準。",
      officialReferrals: [
        NLMA_REFERRAL,
        {
          label: "桃園市政府住宅發展處官方網站",
          agency: "桃園市政府住宅發展處",
          url: "https://ohd.tycg.gov.tw/",
        },
      ],
    };
  }

  const matchedCity = housingCityOf(goal);
  if (matchedCity && !(ALL_COVERED_HOUSING_CITIES as readonly string[]).includes(matchedCity)) {
    // Asking only about the city's own scheme: nothing in scope can answer it.
    if (isLocalOnlyHousingQuery(goal)) {
      return withComponents(
        {
          status: "NOT_COVERED",
          domain: "RENTAL_SUBSIDY",
          reason: "UNSUPPORTED_CITY_HOUSING_POLICY_NOT_IMPLEMENTED",
          message: `目前版本尚未涵蓋${matchedCity}地方租屋補助或加碼，因此無法作成該縣市地方方案之資格判定。全國適用之中央租金補貼可另行預審。請以主管機關官方公告為準。`,
          officialReferrals: [NLMA_REFERRAL],
        },
        extraComponents
      );
    }
    // The 300億元中央擴大租金補貼 (R1) is a national programme accepted by every city/county
    // government, so its encoded conditions still apply; only the city's local layer is
    // outside coverage (reported per scenario as LOCAL_COVERAGE_BOUNDARY = NOT_COVERED).
    return {
      status: "COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "CENTRAL_ONLY_LOCAL_NOT_COVERED",
      message: `可預審全國適用之「300億元中央擴大租金補貼」部分條件；${matchedCity}地方租屋補助或加碼尚未涵蓋，不作成地方方案判定。`,
      officialReferrals: [NLMA_REFERRAL],
      components: [
        {
          key: "CENTRAL_RENT_115",
          label: "300億元中央擴大租金補貼（全國適用）",
          status: "COVERED",
          message: "可預審已實作之部分條件。",
        },
        {
          key: "LOCAL_RENT_PROGRAM",
          label: `${matchedCity}地方租屋補助或加碼`,
          status: "NOT_COVERED",
          message: `${matchedCity}地方方案尚未納入本系統，不作成地方方案判定；請以該縣市主管機關官方公告為準。`,
        },
        ...extraComponents,
      ],
    };
  }

  return withComponents(
    {
      status: "COVERED",
      domain: "RENTAL_SUBSIDY",
      reason: "RENTAL_SUBSIDY_IN_SCOPE",
      message: "目前版本可進行租屋補助的部分條件預審與申辦導航。",
      officialReferrals: [],
    },
    extraComponents.length
      ? [
          {
            key: "RENTAL_SUBSIDY",
            label: "租屋補助（已實作部分條件）",
            status: "COVERED",
            message: "可進行部分條件預審與申辦導航。",
          },
          ...extraComponents,
        ]
      : []
  );
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
    message: `目前版本尚未涵蓋${normalized}地方租屋補助或加碼，不作成地方方案判定（全國適用之中央方案另行預審）。請以該縣市主管機關官方公告為準。`,
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
  "已完成本系統目前已實作規則的檢查；此結果不代表完整法定資格核定，最終仍以主管機關審查為準。";
