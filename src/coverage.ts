import type { PolicyCompleteness } from "./status";

// Explicit coverage boundary for the current GovAid Atlas version.
// Anything outside this boundary must be reported as NOT_COVERED (or missing
// information), never silently routed to another rule set and never as PASS.

export type CoverageDomain = "RENTAL_SUBSIDY" | "CHILDCARE";

// Placeholder for official guidance. Intentionally empty until verified official
// sources are added; URLs must never be guessed.
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

// Keywords that indicate a childcare / parenting benefit request. The repository
// has no childcare policy rules, so such requests are outside coverage.
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
  "childcare",
  "child care",
  "parental leave",
];

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
    return {
      status: "NOT_COVERED",
      domain: "CHILDCARE",
      reason: "CHILDCARE_POLICY_NOT_IMPLEMENTED",
      message:
        "目前版本尚未涵蓋育兒／托育相關補助，因此無法作成資格判定。這不代表您無法申請，請以主管機關官方公告為準。",
      officialReferrals: [],
    };
  }

  return {
    status: "COVERED",
    domain: "RENTAL_SUBSIDY",
    reason: "RENTAL_SUBSIDY_IN_SCOPE",
    message: "目前版本可進行租屋補助的部分條件預審。",
    officialReferrals: [],
  };
}

export function assessCityCoverage(city: string | undefined): CityCoverage {
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

  return {
    status: "NOT_COVERED",
    city: normalized,
    message: `目前版本尚未完整涵蓋${normalized}此類補助，因此無法作成完整資格判定。請以該縣市主管機關官方公告為準。`,
  };
}

// Completeness of the encoded policies. Every policy in src/policies/ currently
// encodes only a subset of the official eligibility conditions (no income,
// property or household rules), so a rule-level PASS is only a partial check.
export const POLICY_COMPLETENESS: Record<string, PolicyCompleteness> = {
  CENTRAL_RENT_115: "PARTIAL",
  NEW_TAIPEI_RENT_115: "PARTIAL",
  TAIPEI_RENT_115: "PARTIAL",
};

export function getPolicyCompleteness(policyId: string): PolicyCompleteness {
  return POLICY_COMPLETENESS[policyId] ?? "PARTIAL";
}

export const PARTIAL_CHECK_NOTE =
  "本系統目前僅檢查已編碼的部分條件；所得、財產、年齡、家戶等其他資格條件尚未由本系統驗證，最終資格以主管機關審查為準。";
