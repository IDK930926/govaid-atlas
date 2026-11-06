import type {
  ApplicantProfile,
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

type DecisionStatus =
  | "PASS"
  | "FAIL"
  | "UNCERTAIN";

export type PassportProgram = {
  policyId: string;
  status: DecisionStatus;
  ruleResults: RuleEvaluation[];
  evidence: EvidenceRecord[];
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

function getScenarioStatus(
  policyResults: PolicyResult[]
): DecisionStatus {
  const statuses =
    policyResults.map(
      (policy) => policy.overallStatus
    );

  if (statuses.includes("FAIL")) {
  return "FAIL";
}

  if (statuses.includes("UNCERTAIN")) {
    return "UNCERTAIN";
  }

  return "PASS";
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
    status: policy.overallStatus,
    ruleResults: policy.evaluations,
    evidence,
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

  return unique(
    evaluations
      .map(missingMessage)
      .filter(
        (item): item is string =>
          item !== null
      )
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

  if (
    actual.overallStatus ===
      "UNCERTAIN" ||
    whatIf.overallStatus ===
      "UNCERTAIN"
  ) {
    risks.push(
      "仍有必要條件尚未確認，不得輸出確定式資格結論"
    );
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