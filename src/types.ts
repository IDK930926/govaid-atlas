export type CaseStatus =
  | "COLLECTING"
  | "MISSING_INFO"
  | "READY_TO_EVALUATE"
  | "EVALUATED"
  | "HUMAN_CONFIRMATION"
  | "CHECKLIST_READY";

export type BenefitDomain = "HOUSING" | "CHILDCARE";

export type ChildcareProfile = {
  /** Child's age in months (0..23 for under-2 allowance; >= 24 is over age boundary). */
  childAgeMonths?: number | null;
  /** Whether the child has completed birth registration or initial household registration in R.O.C. */
  childHasBirthOrInitialHouseholdRegistration?: boolean | null;
  /** Whether the child is currently receiving public or quasi-public childcare services. */
  receivesPublicOrQuasiPublicChildcare?: boolean | null;
  /** Whether the child is placed in government-funded residential care. */
  isGovernmentPlaced?: boolean | null;
  /** Birth order among the parents' children (1 = 1st child, 2 = 2nd child, 3+ = 3rd or above). */
  birthOrder?: number | null;
  /** Optional city where the child's household registration is located. */
  childRegisteredCity?: string;
};

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

  // 育兒津貼領域欄位（僅於 CHILDCARE 流程使用，不混入租屋規則）
  childAgeMonths?: number | null;
  childHasBirthOrInitialHouseholdRegistration?: boolean | null;
  receivesPublicOrQuasiPublicChildcare?: boolean | null;
  isGovernmentPlaced?: boolean | null;
  birthOrder?: number | null;
  childRegisteredCity?: string;
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
  operator: "equals" | "lte" | "gte" | "lt";
  expected: string | number | boolean;
  required: boolean;
  sourceId: string;
  validFrom: string;
  validTo: string;
  /**
   * Use only when the official condition is narrower than the profile field can express
   * (e.g. the field records home ownership but not where the home is). A mismatch is then
   * UNCERTAIN with this reason instead of FAIL, and blocks any subsidy estimate.
   */
  mismatchStatus?: "UNCERTAIN";
  mismatchReason?: string;
};

export type RuleEvaluation = {
  ruleId: string;
  status: RuleStatus;
  reason: string;
  sourceId: string;
  /** Set when an answered field cannot be resolved against the rule's scope (see PolicyRule.mismatchStatus). */
  blocksEstimate?: boolean;
};

export type EvidenceRecord = {
  sourceId: string;
  agency: string;
  policyName: string;
  url: string;
  lastVerifiedAt: string;
  /** Version label of the official programme this record documents (e.g. annual edition). */
  policyVersion?: string;
  /** Provenance of the version this record replaced, kept for auditability. */
  supersedes?: string;
  /** Additional official references backing the primary URL (e.g. Gazette record, programme page). */
  supportingReferences?: { label: string; url: string }[];
};

export type ApplicationAvailabilityStatus =
  | "OPEN"
  | "CLOSED"
  | "ROLLING"
  | "UNKNOWN";

export type PolicyValidityStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "NOT_YET_EFFECTIVE"
  | "HISTORICAL_MODE"
  | "UNKNOWN";

export type RequiredDocumentItem = {
  documentId: string;
  title: string;
  required: boolean;
  conditionNote?: string;
  sourceId: string;
  verificationStatus: "VERIFIED" | "VERIFY_WITH_AGENCY";
};

export type ApplicationGuide = {
  policyId: string;
  programTitle: string;
  domain: BenefitDomain;
  jurisdiction: string;
  administeringAgency: string;
  applicationStatus: ApplicationAvailabilityStatus;
  applicationPeriod: string;
  deadlineDate?: string | null;
  validityStatus: PolicyValidityStatus;
  validFrom: string;
  validTo: string;
  estimatedMonthlyBenefitNtd?: number | null;
  benefitAmountFormula?: string;
  requiredDocuments: RequiredDocumentItem[];
  applicationMethods: string[];
  onlineApplicationUrl: string | null;
  formUrl: string | null;
  officeInformation: string;
  contactInformation: string;
  officialSources: EvidenceRecord[];
  exclusions: string[];
  nextSteps: string[];
  warnings: string[];
  /** Informational notes still valid when the program is FAIL (never a recommendation to apply). */
  stoppedNotes?: string[];
  disclaimer: string;
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
