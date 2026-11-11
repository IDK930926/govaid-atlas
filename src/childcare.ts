import childcareRulesJson from "./policies/childcare-allowance-115.json";
import { getEvidence } from "./evidence";
import { getApplicationGuide, OFFICIAL_FINAL_DECISION_DISCLAIMER } from "./navigation";
import { evaluatePolicyValidity, evaluateRules, getOverallStatus, type RuleEvaluationOptions } from "./rules";
import { toEligibilityStatus } from "./status";
import { getPolicyCompleteness } from "./coverage";
import type {
  ApplicantProfile,
  ApplicationGuide,
  ChildcareProfile,
  EligibilityStatus,
  EvidenceRecord,
  PolicyRule,
  RuleEvaluation,
  RuleStatus,
} from "./types";

const childcareRules = childcareRulesJson as PolicyRule[];

export const CHILDCARE_POLICY_ID = "CHILDCARE_ALLOWANCE_UNDER_2_115";

export type ChildcareEvaluationResult = {
  policyId: string;
  programTitle: string;
  domain: "CHILDCARE";
  overallStatus: RuleStatus;
  eligibilityStatus: EligibilityStatus;
  estimatedMonthlyBenefitNtd: number | null;
  benefitTierLabel: string | null;
  evaluations: RuleEvaluation[];
  passedConditions: string[];
  failedConditions: string[];
  missingConditions: string[];
  exclusionReasons: string[];
  evidence: EvidenceRecord[];
  applicationGuide: ApplicationGuide;
  disclaimer: string;
};

/**
 * Verified benefit tiers from 《育有未滿二歲兒童育兒津貼申領作業要點》第四點:
 * - 1st child: NT$5,000 / month
 * - 2nd child: NT$6,000 / month
 * - 3rd+ child: NT$7,000 / month
 */
export function calculateChildcareMonthlyBenefit(
  birthOrder: number | null | undefined,
  eligibilityStatus: EligibilityStatus
): { amountNtd: number | null; label: string | null } {
  if (eligibilityStatus !== "PASS" && eligibilityStatus !== "PARTIAL_CHECK") {
    return { amountNtd: null, label: null };
  }
  if (typeof birthOrder !== "number" || !Number.isInteger(birthOrder) || birthOrder < 1) {
    return { amountNtd: null, label: null };
  }
  if (birthOrder === 1) {
    return { amountNtd: 5000, label: "第 1 名子女：每月新臺幣 5,000 元" };
  }
  if (birthOrder === 2) {
    return { amountNtd: 6000, label: "第 2 名子女：每月新臺幣 6,000 元" };
  }
  return { amountNtd: 7000, label: `第 ${birthOrder} 名（第 3 名以上）子女：每月新臺幣 7,000 元` };
}

function describeChildcareRuleCondition(evaluation: RuleEvaluation, profile: ChildcareProfile): string {
  switch (evaluation.ruleId) {
    case "CHILDCARE-115-AGE-001":
      if (evaluation.status === "PASS") {
        return `兒童年齡未滿 2 歲（目前 ${profile.childAgeMonths} 個月，符合未滿 24 個月規定）`;
      }
      if (evaluation.status === "FAIL") {
        return typeof profile.childAgeMonths === "number" && profile.childAgeMonths >= 24
          ? `兒童年齡已滿 2 歲（目前 ${profile.childAgeMonths} 個月，超過未滿 24 個月上限；滿 2 歲至未滿 5 歲請改查詢教育部 2 至 4 歲育兒津貼或就學補助）`
          : evaluation.reason;
      }
      return "待確認兒童年齡（月齡須未滿 24 個月）";

    case "CHILDCARE-115-REG-001":
      if (evaluation.status === "PASS") {
        return "兒童已完成出生登記或初設戶籍登記";
      }
      if (evaluation.status === "FAIL") {
        return "兒童尚未完成出生登記或初設戶籍登記（須先向戶政事務所完成登記始得核發）";
      }
      return "待確認兒童是否已完成出生登記或初設戶籍登記";

    case "CHILDCARE-115-PLACEMENT-001":
      if (evaluation.status === "PASS") {
        return "兒童未經政府公費安置收容";
      }
      if (evaluation.status === "FAIL") {
        return "排除條件：兒童目前經政府公費安置收容，依規定不得領取育兒津貼";
      }
      return "待確認兒童是否經政府公費安置收容";

    case "CHILDCARE-115-CARE-001":
      if (evaluation.status === "PASS") {
        return "兒童未接受公共化或準公共托育服務（符合未重複請領托育補助規定）";
      }
      if (evaluation.status === "FAIL") {
        return "排除條件：兒童正在接受公共化或準公共托育服務（公托、準公共托嬰中心或準公共保母），依規定不得同時領取未滿2歲育兒津貼";
      }
      return "待確認兒童是否正在接受公共化或準公共托育服務";

    case "CHILDCARE-115-ORDER-001":
      if (evaluation.status === "PASS") {
        return `已確認兒童出生排序（第 ${profile.birthOrder} 名子女）`;
      }
      if (evaluation.status === "FAIL") {
        return "出生排序（胎次）數值無效（須為第 1 名以上之正整數）";
      }
      return "待確認兒童為家中第幾名子女（胎次影響每月核發金額 5,000 / 6,000 / 7,000 元）";

    default:
      return evaluation.reason;
  }
}

export function extractChildcareProfile(input: ApplicantProfile | ChildcareProfile): ChildcareProfile {
  return {
    childAgeMonths: input.childAgeMonths,
    childHasBirthOrInitialHouseholdRegistration: input.childHasBirthOrInitialHouseholdRegistration,
    receivesPublicOrQuasiPublicChildcare: input.receivesPublicOrQuasiPublicChildcare,
    isGovernmentPlaced: input.isGovernmentPlaced,
    birthOrder: input.birthOrder,
    childRegisteredCity:
      input.childRegisteredCity ?? ("registeredCity" in input ? input.registeredCity : undefined),
  };
}

export function evaluateChildcarePolicy(
  inputProfile: ChildcareProfile | ApplicantProfile,
  options?: RuleEvaluationOptions
): ChildcareEvaluationResult {
  const profile = extractChildcareProfile(inputProfile);
  const applicantForRules: ApplicantProfile = {
    childAgeMonths: profile.childAgeMonths,
    childHasBirthOrInitialHouseholdRegistration: profile.childHasBirthOrInitialHouseholdRegistration,
    receivesPublicOrQuasiPublicChildcare: profile.receivesPublicOrQuasiPublicChildcare,
    isGovernmentPlaced: profile.isGovernmentPlaced,
    birthOrder: profile.birthOrder,
    childRegisteredCity: profile.childRegisteredCity,
  };

  const evaluations = evaluateRules(childcareRules, applicantForRules, options).map((ev) => ({
    ...ev,
    reason: describeChildcareRuleCondition(ev, profile),
  }));

  const overallStatus = getOverallStatus(evaluations);
  const validity = evaluatePolicyValidity("2026-01-01", "2026-12-31", options);

  // Never allow an expired policy to produce a current PASS.
  const eligibilityStatus: EligibilityStatus =
    !validity.isValidNow
      ? "FAIL"
      : toEligibilityStatus(overallStatus, getPolicyCompleteness(CHILDCARE_POLICY_ID));

  const passedConditions = evaluations
    .filter((ev) => ev.status === "PASS")
    .map((ev) => ev.reason);
  const failedConditions = evaluations
    .filter((ev) => ev.status === "FAIL")
    .map((ev) => ev.reason);
  const missingConditions = evaluations
    .filter((ev) => ev.status === "UNCERTAIN")
    .map((ev) => ev.reason);

  const exclusionReasons = evaluations
    .filter(
      (ev) =>
        ev.status === "FAIL" &&
        (ev.ruleId === "CHILDCARE-115-CARE-001" ||
          ev.ruleId === "CHILDCARE-115-PLACEMENT-001" ||
          ev.ruleId === "CHILDCARE-115-AGE-001")
    )
    .map((ev) => ev.reason);

  const { amountNtd, label } = calculateChildcareMonthlyBenefit(profile.birthOrder, eligibilityStatus);

  const evidenceRecord = getEvidence("R8");
  const evidence = evidenceRecord ? [evidenceRecord] : [];

  const applicationGuide = getApplicationGuide(CHILDCARE_POLICY_ID, {
    ...options,
    status: eligibilityStatus,
    estimatedMonthlyBenefitNtd: amountNtd,
    missingItems: missingConditions,
    registeredCity: profile.childRegisteredCity,
  })!;

  return {
    policyId: CHILDCARE_POLICY_ID,
    programTitle: "育有未滿2歲兒童育兒津貼",
    domain: "CHILDCARE",
    overallStatus,
    eligibilityStatus,
    estimatedMonthlyBenefitNtd: amountNtd,
    benefitTierLabel: label,
    evaluations,
    passedConditions,
    failedConditions,
    missingConditions,
    exclusionReasons,
    evidence,
    applicationGuide,
    disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
  };
}
