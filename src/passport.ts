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
import { humanizeRuleReason } from "./ui-copy";
import {
  applyVerdictToGuide,
  guidanceModeFor,
  officialReferenceStep,
  passportGuidanceNote,
  stopStep,
} from "./guidance";

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

export const WHAT_IF_RISK_NOTE =
  "WHAT-IF 為假設搬遷情境，不代表目前已取得該地址之補助資格";

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

  /** One conditional notice shown above nextSteps (UNCERTAIN / PARTIAL_CHECK); absent otherwise. */
  guidanceNote?: string;

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

    case "NEWTAIPEI-115-HOME-001":
      return "確認自有住宅（含家庭成員持有）是否位於新北市、臺北市、桃園市或基隆市；位於上述縣市即不符合新北青年租金補貼";

    default:
      return humanizeRuleReason(evaluation);
  }
}

export { stopStep } from "./guidance";

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

  // Public passport wording; raw reasons stay in ruleResults for the audit trail.
  const passedConditions = policy.evaluations
    .filter((ev) => ev.status === "PASS")
    .map(humanizeRuleReason);
  const failedConditions = [
    ...policy.evaluations
      .filter((ev) => ev.status === "FAIL")
      .map(humanizeRuleReason),
    // Upstream dependency FAIL (e.g. local program requiring central approval).
    ...(policy.blockedByPolicyId && policy.coverageNote ? [policy.coverageNote] : []),
  ];
  const ineligible = status === "FAIL";
  // A failed program has nothing left to fill in: never ask for data to "complete" it.
  const missingConditions = ineligible
    ? []
    : policy.evaluations
        .map(missingMessage)
        .filter((item): item is string => item !== null);

  const baseGuide =
    getApplicationGuide(policy.policyId, {
      ...options,
      status,
      missingItems: missingConditions,
    }) ?? undefined;

  // Verdict-aware guide (src/guidance.ts): FAIL keeps agency/contact/evidence for reference but no
  // submission steps or amount; UNCERTAIN/PARTIAL_CHECK get one passport-level guidanceNote.
  // An answered condition that cannot be resolved (PolicyRule.mismatchStatus) must not show an amount.
  const estimateBlocked = policy.evaluations.some((evaluation) => evaluation.blocksEstimate);
  const applicationGuide = baseGuide
    ? applyVerdictToGuide(baseGuide, {
        status,
        failedConditions,
        estimateBlocked,
      })
    : undefined;

  return {
    policyId: policy.policyId,
    programTitle: applicationGuide?.programTitle ?? policy.policyId,
    status,
    estimatedMonthlyBenefitNtd: ineligible || estimateBlocked ? null : applicationGuide?.estimatedMonthlyBenefitNtd ?? null,
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
  // Missing data for a program that already FAILed can never make it claimable.
  const evaluations = [
    ...actual.policyResults,
    ...whatIf.policyResults,
  ]
    .filter((policy) => policy.eligibilityStatus !== "FAIL")
    .flatMap((policy) => policy.evaluations);

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

  risks.push(WHAT_IF_RISK_NOTE);

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

  const allPrograms = [...actual.programs, ...whatIf.programs];
  const failedPrograms = allPrograms.filter((program) => program.status === "FAIL");
  // A program is still worth pursuing only if it is neither FAIL nor outside coverage.
  const pursuablePrograms = allPrograms.filter(
    (program) =>
      program.status !== "FAIL" &&
      program.status !== "NOT_COVERED" &&
      program.policyId !== "LOCAL_COVERAGE_BOUNDARY"
  );
  const pursuablePolicyIds = new Set(pursuablePrograms.map((program) => program.policyId));

  // Why the path stopped comes first, once per failed program.
  const stopSteps = unique(
    failedPrograms.map((program) => stopStep(program.programTitle ?? program.policyId, program.failedConditions))
  );

  // Submission steps only for programs that can still be pursued in some scenario.
  const guideActionSteps = unique(
    applicationGuides
      .filter((guide) => pursuablePolicyIds.has(guide.policyId))
      .flatMap((guide) => guide.nextSteps)
  );

  const upstreamNotes = unique(
    [...actualResult.policyResults, ...whatIfResult.policyResults]
      .filter((policy) => policy.blockedByPolicyId && typeof policy.coverageNote === "string")
      .map((policy) => policy.coverageNote as string)
  );
  risks.push(...upstreamNotes);

  const genericSubmissionSteps = [
    "確認所有使用者自述資料與租賃契約書載明事項",
    "依各方案應備文件清單備妥租約影本、存摺封面及戶籍／就學就業證明",
    "送件前再次查核受理機關最新官方公告版本",
  ];

  const nextSteps = unique(
    pursuablePrograms.length > 0
      ? [
          ...stopSteps,
          ...missingItems,
          ...guideActionSteps,
          ...genericSubmissionSteps,
        ]
      : [
          ...stopSteps,
          "目前情境下沒有可繼續申辦的已涵蓋方案；若實際條件與本次輸入不同，請更正資料後重新分析",
        ]
  );

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

    guidanceNote: passportGuidanceNote(pursuablePrograms.map((program) => program.status)),

    disclaimer: OFFICIAL_FINAL_DECISION_DISCLAIMER,
  };
}

export function buildChildcareDecisionPassport(
  caseId: string,
  applicant: ApplicantProfile,
  childcareResult: ChildcareEvaluationResult
): DecisionPassport {
  const status = childcareResult.eligibilityStatus;
  const ineligible = guidanceModeFor(status) === "STOPPED";
  // Same verdict-aware contract as the housing passport (src/guidance.ts).
  const guide = applyVerdictToGuide(childcareResult.applicationGuide, {
    status,
    failedConditions: childcareResult.failedConditions,
  });
  const program: PassportProgram = {
    policyId: childcareResult.policyId,
    programTitle: childcareResult.programTitle,
    status,
    estimatedMonthlyBenefitNtd: ineligible ? null : childcareResult.estimatedMonthlyBenefitNtd,
    benefitSummary: ineligible
      ? undefined
      : childcareResult.benefitTierLabel ?? guide.benefitAmountFormula,
    ruleResults: childcareResult.evaluations,
    passedConditions: childcareResult.passedConditions,
    failedConditions: childcareResult.failedConditions,
    // A failed program has nothing left to fill in.
    missingConditions: ineligible ? [] : childcareResult.missingConditions,
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
    overallStatus: status,
    programs: [program],
  };

  const risks: string[] = [...guide.warnings];
  if (status === "UNCERTAIN") {
    risks.unshift("仍有育兒津貼必要條件尚未確認，請先補充缺漏欄位後再確認預審結果");
  }
  if (childcareResult.exclusionReasons.length > 0) {
    risks.unshift(...childcareResult.exclusionReasons);
  }

  const missingItems = ineligible ? [] : [...childcareResult.missingConditions];
  const nextSteps = unique(
    ineligible
      ? [...guide.nextSteps, officialReferenceStep(guide)]
      : [...missingItems, ...guide.nextSteps]
  );

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
    missingItems,
    risks: unique(risks),
    nextSteps,
    guidanceNote: passportGuidanceNote(ineligible ? [] : [status]),
    disclaimer: childcareResult.disclaimer,
  };
}
