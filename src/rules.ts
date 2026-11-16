import type {
  ApplicantProfile,
  PolicyRule,
  PolicyValidityStatus,
  RuleEvaluation,
  RuleStatus,
} from "./types";

export const DEFAULT_POLICY_REFERENCE_DATE = "2026-11-11";

export type RuleEvaluationOptions = {
  asOfDate?: string;
  allowHistorical?: boolean;
};

export function evaluatePolicyValidity(
  validFrom: string,
  validTo: string,
  options?: RuleEvaluationOptions
): {
  isValidNow: boolean;
  validityStatus: PolicyValidityStatus;
  asOfDate: string;
  validFrom: string;
  validTo: string;
} {
  const asOfDate =
    options?.asOfDate ??
    (typeof process !== "undefined" ? process.env?.GOVAID_AS_OF_DATE : undefined) ??
    DEFAULT_POLICY_REFERENCE_DATE;

  if (!validFrom || !validTo) {
    return {
      isValidNow: false,
      validityStatus: "UNKNOWN",
      asOfDate,
      validFrom,
      validTo,
    };
  }

  if (asOfDate < validFrom) {
    return {
      isValidNow: false,
      validityStatus: "NOT_YET_EFFECTIVE",
      asOfDate,
      validFrom,
      validTo,
    };
  }

  if (asOfDate > validTo) {
    return {
      isValidNow: Boolean(options?.allowHistorical),
      validityStatus: options?.allowHistorical ? "HISTORICAL_MODE" : "EXPIRED",
      asOfDate,
      validFrom,
      validTo,
    };
  }

  return {
    isValidNow: true,
    validityStatus: "ACTIVE",
    asOfDate,
    validFrom,
    validTo,
  };
}

function compare(
  actual: unknown,
  operator: PolicyRule["operator"],
  expected: PolicyRule["expected"]
): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;

    case "lte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual <= expected
      );

    case "gte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual >= expected
      );

    case "lt":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected
      );

    default:
      return false;
  }
}

export function evaluateRule(
  rule: PolicyRule,
  profile: ApplicantProfile,
  options?: RuleEvaluationOptions
): RuleEvaluation {
  const validity = evaluatePolicyValidity(rule.validFrom, rule.validTo, options);
  if (validity.validityStatus === "EXPIRED") {
    return {
      ruleId: rule.ruleId,
      status: "FAIL",
      reason: `政策有效期間已屆滿（${rule.validFrom} 至 ${rule.validTo}），過期政策不得作為現行有效資格通過依據`,
      sourceId: rule.sourceId,
    };
  }

  if (validity.validityStatus === "NOT_YET_EFFECTIVE") {
    return {
      ruleId: rule.ruleId,
      status: "UNCERTAIN",
      reason: `政策尚未生效（生效期間：${rule.validFrom} 至 ${rule.validTo}）`,
      sourceId: rule.sourceId,
    };
  }

  const historicalPrefix =
    validity.validityStatus === "HISTORICAL_MODE"
      ? "[歷史政策模式 / HISTORICAL_MODE] "
      : "";

  const actualValue = profile[rule.field];

  // 必填資料不存在 → 不准猜，回傳 UNCERTAIN
  if (
    rule.required &&
    (actualValue === undefined || actualValue === null)
  ) {
    return {
      ruleId: rule.ruleId,
      status: "UNCERTAIN",
      reason: `${historicalPrefix}缺少必要資料：${String(rule.field)}`,
      sourceId: rule.sourceId,
    };
  }

  // 非必填但若使用者已提供數值則執行檢查；未提供時保留供 PARTIAL_CHECK 提醒
  if (
    !rule.required &&
    (actualValue === undefined || actualValue === null)
  ) {
    return {
      ruleId: rule.ruleId,
      status: "PASS",
      reason: `${historicalPrefix}${String(rule.field)} 尚未提供（將於主管機關實質審查時核對上限 ${String(rule.expected)}）`,
      sourceId: rule.sourceId,
    };
  }

  // 針對年齡月份等非負數值檢查
  if (rule.field === "childAgeMonths" && typeof actualValue === "number" && actualValue < 0) {
    return {
      ruleId: rule.ruleId,
      status: "FAIL",
      reason: `${historicalPrefix}childAgeMonths 不符合規則（年齡月數不得為負數）`,
      sourceId: rule.sourceId,
    };
  }

  const passed = compare(
    actualValue,
    rule.operator,
    rule.expected
  );

  if (!passed && rule.mismatchStatus === "UNCERTAIN") {
    return {
      ruleId: rule.ruleId,
      status: "UNCERTAIN",
      reason: `${historicalPrefix}${rule.mismatchReason ?? `${String(rule.field)} 需進一步確認`}`,
      sourceId: rule.sourceId,
      blocksEstimate: true,
    };
  }

  return {
    ruleId: rule.ruleId,
    status: passed ? "PASS" : "FAIL",
    reason: passed
      ? `${historicalPrefix}${String(rule.field)} 通過規則`
      : `${historicalPrefix}${String(rule.field)} 不符合規則`,
    sourceId: rule.sourceId,
  };
}

export function evaluateRules(
  rules: PolicyRule[],
  profile: ApplicantProfile,
  options?: RuleEvaluationOptions
): RuleEvaluation[] {
  return rules.map((rule) => evaluateRule(rule, profile, options));
}

export function getOverallStatus(
  evaluations: RuleEvaluation[]
): RuleStatus {
  const statuses =
    evaluations.map(
      (item) => item.status
    );

  // 沒有任何規則被評估 → 沒有證據，不得視為 PASS
  if (statuses.length === 0) {
    return "UNCERTAIN";
  }

  if (statuses.includes("FAIL")) {
    return "FAIL";
  }

  if (statuses.includes("UNCERTAIN")) {
    return "UNCERTAIN";
  }

  return "PASS";
}
