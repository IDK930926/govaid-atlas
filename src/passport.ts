import type {
  ApplicantProfile,
  EligibilityStatus,
  EvidenceRecord,
  RuleEvaluation,
} from "./types";

import type {
  PolicyResult,
  ScenarioResult,
} from "./scenario";

import {
  getEvidence,
} from "./evidence";

import {
  aggregateEligibilityStatus,
  toEligibilityStatus,
} from "./status";

import {
  getPolicyCompleteness,
  PARTIAL_CHECK_NOTE,
} from "./coverage";

type DecisionStatus = EligibilityStatus;

export type PassportProgram = {
  policyId: string;
  status: DecisionStatus;
  ruleResults: RuleEvaluation[];
  evidence: EvidenceRecord[];
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

  applicantSnapshot: ApplicantProfile;

  actual: PassportScenario;

  whatIf: PassportScenario;

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

function buildProgram(
  policy: PolicyResult
): PassportProgram {
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

  return {
    policyId: policy.policyId,
    status: programStatus(policy),
    ruleResults: policy.evaluations,
    evidence,
    coverageNote: policy.coverageNote,
  };
}

function buildScenario(
  result: ScenarioResult
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
      result.policyResults.map(
        buildProgram
      ),
  };
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
  whatIfResult: ScenarioResult
): DecisionPassport {
  const actual =
    buildScenario(actualResult);

  const whatIf =
    buildScenario(whatIfResult);

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

  const nextSteps = [
    ...missingItems,

    "確認所有使用者自述資料",

    "依 Decision Passport 檢查應備文件",

    "送件前再次查核最新官方政策版本",
  ];

  return {
    caseId,

    generatedAt:
      new Date().toISOString(),

    applicantSnapshot: {
      ...applicant,
    },

    actual,

    whatIf,

    missingItems,

    risks,

    nextSteps,

    disclaimer:
      "GovAid Atlas 僅提供資格預審與申辦導航；最終資格與補助金額以主管機關審查核定為準。",
  };
}