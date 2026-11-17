import type { ApplicationGuide, EligibilityStatus } from "./types";

/**
 * Verdict-aware guidance contract (Gate 4D).
 *
 * One place decides what an application guide may say for a program's final verdict, so the
 * verdict, estimated amount, next steps, Decision Passport and risk copy cannot disagree:
 *
 * - APPLY        (PASS)                     normal application path.
 * - CONDITIONAL  (UNCERTAIN, PARTIAL_CHECK) steps stay concise; the passport carries ONE conditional
 *                                           notice (CONDITIONAL_GUIDANCE_NOTE) above them; never approval.
 * - STOPPED      (FAIL)                     no submit-now steps, no amount, no amount formula, no
 *                                           submission-procedure warnings; explain the blocking
 *                                           condition, keep the official contact as reference only and
 *                                           keep only the guide's informational stoppedNotes.
 * - REFERENCE_ONLY (NOT_COVERED)            guide content is reference only; no steps are generated here.
 */
export type GuidanceMode = "APPLY" | "CONDITIONAL" | "STOPPED" | "REFERENCE_ONLY";

export function guidanceModeFor(status: EligibilityStatus): GuidanceMode {
  switch (status) {
    case "PASS":
      return "APPLY";
    case "UNCERTAIN":
    case "PARTIAL_CHECK":
      return "CONDITIONAL";
    case "FAIL":
      return "STOPPED";
    default:
      return "REFERENCE_ONLY";
  }
}

/** One notice shown above the next steps when a pursuable program is not (yet) a preliminary PASS. */
export const CONDITIONAL_GUIDANCE_NOTE =
  "目前為初步／條件式結果，尚非核准；請先完成待確認條件，再依下列步驟辦理。";

/** Label for an official contact/link kept on a FAIL program: reference, not a recommendation. */
export const OFFICIAL_REFERENCE_LABEL = "官方資訊（僅供查證，非申請建議）";

export function stopStep(programTitle: string, failedConditions: string[]): string {
  const reason = failedConditions.length
    ? failedConditions.map((condition) => condition.replace(/。$/, "")).join("；")
    : "已編碼條件未通過";
  return `「${programTitle}」流程已停止：${reason}。本情境不建議送件申請此方案；如對判定有疑義，請洽受理機關確認。`;
}

export function officialReferenceStep(guide: Pick<ApplicationGuide, "contactInformation">): string {
  return `${OFFICIAL_REFERENCE_LABEL}：${guide.contactInformation}`;
}

export type VerdictGuideInput = {
  status: EligibilityStatus;
  failedConditions: string[];
  /** An answered condition that cannot be resolved must not show an amount even if not FAIL. */
  estimateBlocked?: boolean;
};

/**
 * Applies the verdict to a guide built from static policy content. The guide's documents,
 * methods, agency and official sources are kept (the UI shows them only when the mode allows),
 * but every field that recommends acting is rewritten to match the verdict.
 */
export function applyVerdictToGuide(guide: ApplicationGuide, input: VerdictGuideInput): ApplicationGuide {
  const mode = guidanceModeFor(input.status);
  if (mode === "STOPPED") {
    return {
      ...guide,
      estimatedMonthlyBenefitNtd: null,
      benefitAmountFormula: undefined,
      // Exactly one step: why the path stopped. The contact stays on the guide (reference only).
      nextSteps: [stopStep(guide.programTitle, input.failedConditions)],
      // Submission-procedure warnings ("須主動提出申請") contradict a stopped program; only notes the
      // guide marks as informational for a stopped program survive.
      warnings: [...(guide.stoppedNotes ?? [])],
    };
  }
  const estimatedMonthlyBenefitNtd = input.estimateBlocked ? null : guide.estimatedMonthlyBenefitNtd;
  return { ...guide, estimatedMonthlyBenefitNtd };
}

/**
 * The single conditional notice for a passport: shown when any program that can still be pursued is
 * UNCERTAIN or PARTIAL_CHECK. PASS-only, FAIL-only and NOT_COVERED-only passports carry no notice.
 */
export function passportGuidanceNote(pursuableStatuses: EligibilityStatus[]): string | undefined {
  return pursuableStatuses.some((status) => guidanceModeFor(status) === "CONDITIONAL")
    ? CONDITIONAL_GUIDANCE_NOTE
    : undefined;
}
