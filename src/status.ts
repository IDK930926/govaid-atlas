import type { EligibilityStatus, RuleStatus } from "./types";

// Single source of truth for combining eligibility statuses.
// Priority (highest wins):
//   FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS
// - Any explicit FAIL makes the whole result FAIL.
// - NOT_COVERED / UNCERTAIN / PARTIAL_CHECK can never be upgraded to PASS.
// - An empty list means nothing was verified, which is UNCERTAIN, never PASS.
const PRIORITY: EligibilityStatus[] = [
  "FAIL",
  "NOT_COVERED",
  "UNCERTAIN",
  "PARTIAL_CHECK",
  "PASS",
];

export function aggregateEligibilityStatus(
  statuses: EligibilityStatus[]
): EligibilityStatus {
  if (statuses.length === 0) {
    return "UNCERTAIN";
  }

  for (const status of PRIORITY) {
    if (statuses.includes(status)) {
      return status;
    }
  }

  return "UNCERTAIN";
}

// Rule completeness of an encoded policy in this repository.
// PARTIAL means only a subset of the official eligibility conditions is encoded,
// so a rule-level PASS may only be reported as PARTIAL_CHECK.
export type PolicyCompleteness = "COMPLETE" | "PARTIAL";

export function toEligibilityStatus(
  ruleStatus: RuleStatus,
  completeness: PolicyCompleteness
): EligibilityStatus {
  if (ruleStatus === "PASS" && completeness !== "COMPLETE") {
    return "PARTIAL_CHECK";
  }
  return ruleStatus;
}

// Only a verified, complete PASS may ever be presented as an affirmative result.
export function isAffirmative(status: EligibilityStatus): boolean {
  return status === "PASS";
}
