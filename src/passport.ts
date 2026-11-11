import type {
  ApplicantProfile,
  ApplicationGuide,
  BenefitDomain,
  EligibilityStatus,
  EvidenceRecord,
  RuleEvaluation,
} from "./types";

import type {
  PolicyResult,
  ScenarioResult,
} from "./scenario";

import type {
  ChildcareEvaluationResult,
} from "./childcare";

import {
  getEvidence,
} from "./evidence";

import {
  getApplicationGuide,
  OFFICIAL_FINAL_DECISION_DISCLAIMER,
} from "./navigation";

import {
  aggregateEligibilityStatus,
  toEligibilityStatus,
} from "./status";

import {
  getPolicyCompleteness,
  PARTIAL_CHECK_NOTE,
} from "./coverage";

import type { RuleEvaluationOptions } from "./rules";

type DecisionStatus = EligibilityStatus;

export type PassportProgram = {
  policyId: string;
  programTitle?: string;
  status: DecisionStatus;
  estimatedMonthlyBenefitNtd?: number | null;
  benefitSummary?: string;
  ruleResults: RuleEvaluation[];
  passedConditions: string[];
  failedConditions: string[];
  missingConditions: string[];
  evidence: EvidenceRecord[];
  applicationGuide?: ApplicationGuide;
  coverageNote?: string;
};

export type PassportScenario = {
  type: "ACTUAL" | "WHAT_IF";
  address: string;
  city?: string;
  district?: string;
  monthlyRent: number;
  overallStatus: DecisionStatus;
  programs: PassportProgram[];
};

export type DecisionPassport = {
  caseId: string;

  generatedAt: string;

  domain: BenefitDomain;

  applicantSnapshot: ApplicantProfile;

  actual: PassportScenario;

  whatIf: PassportScenario;

  childcare?: ChildcareEvaluationResult;

  applicationGuides: ApplicationGuide[];

  missingItems: string[];

  risks: string[];

  nextSteps: string[];

  disclaimer: string;
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function programStatus(
  policy: PolicyResult
): DecisionStatus {
  return (
    policy.eligibilityStatus ??
    toEligibilityStatus(
      policy.overallStatus,
      getPolicyCompleteness(policy.policyId)
    )
  );
}

function getScenarioStatus(
  policyResults: PolicyResult[]
): DecisionStatus {
  // FAIL > NOT_COVERED > UNCERTAIN > PARTIAL_CHECK > PASS
  return aggregateEligibilityStatus(
    policyResults.map(programStatus)
  );
}

function missingMessage(
  evaluation: RuleEvaluation
): string | null {
  if (
    evaluation.status !== "UNCERTAIN"
  ) {
    return null;
  }

  switch (evaluation.ruleId) {
    case "NEWTAIPEI-115-LOCAL-001":
      return "確認是否符合新北市設籍、就學或就業條件";

    case "TAIPEI-115-CENTRAL-001":
      return "確認中央租金補貼是否已核准";

    default:
      return evaluation.reason;
  }
}

function buildProgram(
  policy: PolicyResult,
  options?: RuleEvaluationOptions & { registeredCity?: string }
): PassportProgram {
  const status = programStatus(policy);
  const sourceIds = unique(
    policy.evaluations.map(
      (evaluation) =>
        evaluation.sourceId
    )
  );

  const evidence = sourceIds
    .map((sourceId) =>
      getEvidence(sourceId)
    )
    .filter(
      (
        item
      ): item is EvidenceRecord =>
        item !== undefined
    );

  const passedConditions = policy.evaluations
    .filter((ev) => ev.status === "PASS")
    .map((ev) => ev.reason);
  const failedConditions = policy.evaluations
    .filter((ev) => ev.status === "FAIL")
    .map((ev) => ev.reason);
  const missingConditions = policy.evaluations
    .map(missingMessage)
    .filter((item): item is string => item !== null);

  const applicationGuide =
    getApplicationGuide(policy.policyId, {
      ...options,
      status,
      missingItems: missingConditions,
    }) ?? undefined;

  return {
    policyId: policy.policyId,
    programTitle: applicationGuide?.programTitle ?? policy.policyId,
    status,
    estimatedMonthlyBenefitNtd: applicationGuide?.estimatedMonthlyBenefitNtd ?? null,
    benefitSummary: applicationGuide?.benefitAmountFormula,
    ruleResults: policy.evaluations,
    passedConditions,
    failedConditions,
    missingConditions,
    evidence:
      evidence.length > 0
        ? evidence
        : applicationGuide?.officialSources ?? [],
    applicationGuide,
    coverageNote: policy.coverageNote,
  };
}

function buildScenario(
  result: ScenarioResult,
  options?: RuleEvaluationOptions & { registeredCity?: string }
): PassportScenario {
  return {
    type: result.scenario.type,
    address: result.scenario.address,
    city: result.scenario.city,
    district: result.scenario.district,
    monthlyRent:
      result.scenario.monthlyRent,

    overallStatus:
      getScenarioStatus(
        result.policyResults
      ),

    programs:
      result.policyResults.map((policy) =>
        buildProgram(policy, options)
      ),
  };
}

function collectMissingItems(
  actual: ScenarioResult,
  whatIf: ScenarioResult
): string[] {
  const evaluations = [
    ...actual.policyResults.flatMap(
      (policy) => policy.evaluations
    ),

    ...whatIf.policyResults.flatMap(
      (policy) => policy.evaluations
    ),
  ];

  // 缺少縣市等無規則可評估的必要資訊（例如 LOCAL_COVERAGE_BOUNDARY）
  const unresolvedCoverage = [
    ...actual.policyResults,
    ...whatIf.policyResults,
  ]
    .filter(
      (policy) =>
        policy.eligibilityStatus === "UNCERTAIN" &&
        policy.evaluations.length === 0 &&
        typeof policy.coverageNote === "string"
    )
    .map((policy) => policy.coverageNote as string);

  return unique(
    [
      ...evaluations
        .map(missingMessage)
        .filter(
          (item): item is string =>
            item !== null
        ),
      ...unresolvedCoverage,
    ]
  );
}

export function buildDecisionPassport(
  caseId: string,
  applicant: ApplicantProfile,
  actualResult: ScenarioResult,
  whatIfResult: ScenarioResult,
  options?: RuleEvaluationOptions
): DecisionPassport {
  const actual =
    buildScenario(actualResult, {
      ...options,
      registeredCity: applicant.registeredCity,
    });

  const whatIf =
    buildScenario(whatIfResult, {
      ...options,
      registeredCity: applicant.registeredCity,
    });

  const missingItems =
    collectMissingItems(
      actualResult,
      whatIfResult
    );

  const risks: string[] = [];

  const statuses = [
    actual.overallStatus,
    whatIf.overallStatus,
    ...actual.programs.map((program) => program.status),
    ...whatIf.programs.map((program) => program.status),
  ];

  if (statuses.includes("UNCERTAIN")) {
    risks.push(
      "仍有必要條件尚未確認，不得輸出確定式資格結論"
    );
  }

  // 涵蓋範圍外 / 缺少縣市：誠實說明系統邊界，不代表使用者不符合資格
  const coverageNotes = unique(
    [
      ...actualResult.policyResults,
      ...whatIfResult.policyResults,
    ]
      .filter(
        (policy) =>
          policy.eligibilityStatus === "NOT_COVERED"
      )
      .map((policy) => policy.coverageNote)
      .filter(
        (note): note is string =>
          typeof note === "string"
      )
  );

  risks.push(...coverageNotes);

  if (
    [...actual.programs, ...whatIf.programs].some(
      (program) =>
        program.status === "PARTIAL_CHECK"
    )
  ) {
    risks.push(PARTIAL_CHECK_NOTE);
  }

  risks.push(
    "WHAT-IF 為假設搬遷情境，不代表目前已取得該地址之補助資格"
  );

  const applicationGuides = unique(
    [...actual.programs, ...whatIf.programs]
      .map((p) => p.applicationGuide)
      .filter((g): g is ApplicationGuide => g !== undefined)
      .map((g) => g.policyId)
  )
    .map((policyId) =>
      [...actual.programs, ...whatIf.programs].find(
        (p) => p.applicationGuide?.policyId === policyId
      )?.applicationGuide
    )
    .filter((g): g is ApplicationGuide => g !== undefined);

  const guideActionSteps = unique(
    applicationGuides.flatMap((guide) => guide.nextSteps)
  );

  const nextSteps = unique([
    ...missingItems,
    ...guideActionSteps,
    "確認所有使用者自述資料與租賃契約書載明事項",
    "依各方案應備文件清單備妥租約影本、存摺封面及戶籍／就學就業證明",
    "送件前再次查核受理機關最新官方公告版本",
  ]);

  return {
    caseId,

    generatedAt:
      new Date().toISOString(),

    domain: "HOUSING",

    applicantSnapshot: {
      ...applicant,
    },

    actual,

    whatIf,

    applicationGuides,

    missingItems,

    risks,

    nextSteps,

    disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
  };
}

export function buildChildcareDecisionPassport(
  caseId: string,
  applicant: ApplicantProfile,
  childcareResult: ChildcareEvaluationResult
): DecisionPassport {
  const guide = childcareResult.applicationGuide;
  const program: PassportProgram = {
    policyId: childcareResult.policyId,
    programTitle: childcareResult.programTitle,
    status: childcareResult.eligibilityStatus,
    estimatedMonthlyBenefitNtd: childcareResult.estimatedMonthlyBenefitNtd,
    benefitSummary:
      childcareResult.benefitTierLabel ?? guide.benefitAmountFormula,
    ruleResults: childcareResult.evaluations,
    passedConditions: childcareResult.passedConditions,
    failedConditions: childcareResult.failedConditions,
    missingConditions: childcareResult.missingConditions,
    evidence: childcareResult.evidence,
    applicationGuide: guide,
  };

  const scenario: PassportScenario = {
    type: "ACTUAL",
    address: applicant.childRegisteredCity
      ? `${applicant.childRegisteredCity}（兒童戶籍地）`
      : "全國適用（依兒童戶籍地公所受理）",
    city: applicant.childRegisteredCity ?? applicant.registeredCity,
    monthlyRent: 0,
    overallStatus: childcareResult.eligibilityStatus,
    programs: [program],
  };

  const risks: string[] = [...guide.warnings];
  if (childcareResult.eligibilityStatus === "UNCERTAIN") {
    risks.unshift("仍有育兒津貼必要條件尚未確認，請先補充缺漏欄位後再確認預審結果");
  }
  if (childcareResult.exclusionReasons.length > 0) {
    risks.unshift(...childcareResult.exclusionReasons);
  }

  const nextSteps = unique([
    ...childcareResult.missingConditions,
    ...guide.nextSteps,
  ]);

  return {
    caseId,
    generatedAt: new Date().toISOString(),
    domain: "CHILDCARE",
    applicantSnapshot: {
      ...applicant,
    },
    actual: scenario,
    whatIf: {
      ...scenario,
      type: "WHAT_IF",
    },
    childcare: childcareResult,
    applicationGuides: [guide],
    missingItems: [...childcareResult.missingConditions],
    risks: unique(risks),
    nextSteps,
    disclaimer: childcareResult.disclaimer,
  };
}
