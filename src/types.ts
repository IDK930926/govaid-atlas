export type CaseStatus =
  | "COLLECTING"
  | "MISSING_INFO"
  | "READY_TO_EVALUATE"
  | "EVALUATED"
  | "HUMAN_CONFIRMATION"
  | "CHECKLIST_READY";

export type ApplicantProfile = {
  age?: number;
  maritalStatus?: "single" | "married";
  childrenCount?: number;

  registeredCity?: string;

  monthlyIncome?: number | null;
  ownsHome?: boolean | null;
  receivesOtherHousingAid?: boolean | null;
  // 地方方案需要的條件
  centralRentApproved?: boolean | null;
  newTaipeiResidenceStudyWork?: boolean | null;
};

export type AddressScenario = {
  type: "ACTUAL" | "WHAT_IF";
  address: string;
  city?: string;
  district?: string;
  monthlyRent: number;
};

export type RuleStatus =
  | "PASS"
  | "FAIL"
  | "UNCERTAIN";

// User-facing eligibility claim. Wider than RuleStatus so the system can say
// "only part of the eligibility was checked" (PARTIAL_CHECK) or "this request is
// outside what the system currently covers" (NOT_COVERED) instead of PASS.
export type EligibilityStatus =
  | RuleStatus
  | "PARTIAL_CHECK"
  | "NOT_COVERED";

export type PolicyRule = {
  ruleId: string;
  program: string;
  field: keyof ApplicantProfile;
  operator: "equals" | "lte" | "gte";
  expected: string | number | boolean;
  required: boolean;
  sourceId: string;
  validFrom: string;
  validTo: string;
};

export type RuleEvaluation = {
  ruleId: string;
  status: RuleStatus;
  reason: string;
  sourceId: string;
};

export type EvidenceRecord = {
  sourceId: string;
  agency: string;
  policyName: string;
  url: string;
  lastVerifiedAt: string;
};

export type AuditEvent = {
  timestamp: string;
  actor: "USER" | "AGENT" | "RULE_ENGINE" | "SYSTEM" | "LLM";
  action: string;
  input?: unknown;
  output?: unknown;
  policyVersion?: string;
};

export type GovAidCase = {
  id: string;
  status: CaseStatus;
  applicant: ApplicantProfile;
  scenarios: AddressScenario[];
  missingFields: string[];
  evaluations: RuleEvaluation[];
  evidence: EvidenceRecord[];
  auditTrail: AuditEvent[];
};