import type {
  ApplicantProfile,
  PolicyRule,
  RuleEvaluation,
  RuleStatus,
} from "./types";

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

    default:
      return false;
  }
}

export function evaluateRule(
  rule: PolicyRule,
  profile: ApplicantProfile
): RuleEvaluation {
  const actualValue = profile[rule.field];

  // 必填資料不存在 → 不准猜，回傳 UNCERTAIN
  if (
    rule.required &&
    (actualValue === undefined || actualValue === null)
  ) {
    return {
      ruleId: rule.ruleId,
      status: "UNCERTAIN",
      reason: `缺少必要資料：${String(rule.field)}`,
      sourceId: rule.sourceId,
    };
  }

  const passed = compare(
    actualValue,
    rule.operator,
    rule.expected
  );

  return {
    ruleId: rule.ruleId,
    status: passed ? "PASS" : "FAIL",
    reason: passed
      ? `${String(rule.field)} 通過規則`
      : `${String(rule.field)} 不符合規則`,
    sourceId: rule.sourceId,
  };
}

export function evaluateRules(
  rules: PolicyRule[],
  profile: ApplicantProfile
): RuleEvaluation[] {
  return rules.map((rule) => evaluateRule(rule, profile));
}

export function getOverallStatus(
  evaluations: RuleEvaluation[]
): "PASS" | "FAIL" | "UNCERTAIN" {
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