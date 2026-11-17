// Compact, judge-readable view of the Agent's planning decision:
//   模型提案 (Proposal) → 系統驗證 (Validation) → 下一步 (Next state)
// Built only from the structured trace of the planning step. It never shows model reasoning,
// free-text model questions, tokens or raw codes, and never invents a proposal.
import { getQuestionForMissingField, isSupportedMissingField } from "./agent/missing-fields";
import type { AgentRun } from "./agent/types";
import { toolCopy } from "./ui-copy";

export type AgentDecisionKind =
  | "MODEL_ACCEPTED" // the model proposed, validation passed, the proposal was executed
  | "MODEL_REJECTED" // the model proposed, validation rejected it, system rules chose instead
  | "MODEL_UNAVAILABLE" // the model was called but returned no proposal (timeout / outage)
  | "SYSTEM_ONLY"; // no model call: deterministic workflow

export type AgentDecisionView = {
  kind: AgentDecisionKind;
  /** null when no model proposal exists (never fabricated). */
  proposal: string | null;
  validation: string;
  next: string;
  decidedBy: string;
};

/** "本人是否持有住宅？" → "本人是否持有住宅" (system wording for the field the model targeted). */
function askedFieldPhrase(field?: string): string | null {
  if (!field || !isSupportedMissingField(field)) return null;
  return getQuestionForMissingField(field).replace(/^請問(?:您)?/, "").replace(/[？?].*$/, "");
}

function proposalLabel(nextAction: string, toolName?: string, missingField?: string): string {
  const asked = askedFieldPhrase(missingField);
  switch (nextAction) {
    case "CALL_TOOL":
      if ((toolName === "request_missing_field" || toolName === "request_human_confirmation") && asked) return `詢問${asked}`;
      return `執行${toolName ? toolCopy[toolName]?.zh ?? "政策工具" : "政策工具"}`;
    case "ASK_HUMAN":
      return asked ? `詢問${asked}` : "詢問缺漏資料";
    case "COMPLETE":
      return "直接完成分析";
    case "HUMAN_REVIEW_REQUIRED":
      return "轉人工審查";
    default:
      return "其他動作";
  }
}

const REJECTION_COPY: Array<[RegExp, string]> = [
  [/^HUMAN_REVIEW_WITHOUT_VALIDATED_CONFLICT/, "未發現已驗證的政策衝突"],
  [/^PREMATURE_COMPLETE/, "尚未完成資格檢核，不得直接完成"],
  [/^CANNOT_COMPLETE_WITH_UNRESOLVED/, "仍有必要資料未確認"],
  [/^UNRESOLVED_MISSING_FIELD_BLOCKS/, "仍有必要資料未確認"],
  [/^NO_DISTINCT_WHAT_IF_SCENARIO/, "未設定可比較的搬遷情境"],
  [/^QUERY_OUTSIDE_COVERAGE/, "查詢超出目前涵蓋範圍"],
  [/^TOOL_NOT_IN_ALLOWLIST/, "工具不在允許清單"],
  [/^DUPLICATE_TOOL_CALL/, "狀態未變的重複呼叫"],
  [/^DOMAIN_MISMATCH/, "工具與補助領域不符"],
  [/^FIELD_ALREADY_KNOWN|^ASK_FOR_KNOWN_FIELD/, "該資料已由使用者提供，不得重問"],
  [/^NO_ASKABLE_FIELD/, "目前沒有需要再詢問的資料"],
  [/^UNSAFE_/, "試圖覆寫申請資料或資格結果"],
  [/^PASSPORT_REQUIRES/, "尚未完成情境評估"],
  [/^MISSING_HUMAN_QUESTION|^MISSING_TOOL_NAME|^INVALID_|^PROPOSAL_NOT_AN_OBJECT/, "提案格式不完整"],
];

function rejectionLabel(reason: string | null): string {
  if (!reason) return "不符合目前系統狀態";
  return REJECTION_COPY.find(([pattern]) => pattern.test(reason))?.[1] ?? "不符合目前系統狀態";
}

function nextLabel(run: AgentRun): string {
  const step = run.trace[0];
  // Only a whole-request coverage stop ends the analysis. A local layer outside coverage
  // (step.coverageStatus) while the central / supported part continues is NOT a stop.
  if (step.finalStatus === "NOT_COVERED" || run.status === "NOT_COVERED") {
    return "停止判定，提供官方查詢管道";
  }
  if (step.finalStatus === "HUMAN_REVIEW_REQUIRED") {
    return "停止確定式判斷，轉人工審查";
  }
  const localNote = step.coverageStatus === "NOT_COVERED" ? "（地方方案未涵蓋，中央部分繼續）" : "";
  const field = step.humanGate?.missingField;
  if (field) {
    // System wording for the gate (canonical or the system's clarification), never the model's free text.
    const question =
      step.humanGate?.question ?? getQuestionForMissingField(field as Parameters<typeof getQuestionForMissingField>[0]);
    const stillWaiting = run.status === "WAITING_FOR_HUMAN" && run.missingField === field;
    return stillWaiting ? `請你確認：${question}` : `已請你確認：${question}（已回答）`;
  }
  if (step.selectedTool) {
    return `執行${toolCopy[step.selectedTool]?.zh ?? "政策工具"}${localNote}`;
  }
  return step.finalStatus === "COMPLETED" ? "完成分析" : "繼續執行";
}

export function describeAgentDecision(run: AgentRun): AgentDecisionView | null {
  const step = run.trace[0];
  if (!step) return null;
  const proposal = step.plannerProposal;
  const next = nextLabel(run);

  if (!proposal || step.provider === "DETERMINISTIC") {
    return {
      kind: "SYSTEM_ONLY",
      proposal: null,
      validation: "未呼叫模型",
      next,
      decidedBy: "系統規則",
    };
  }

  if (proposal.nextAction === "PROVIDER_ERROR") {
    const timedOut = /TIMEOUT/i.test(step.rejectionReason ?? "");
    return {
      kind: "MODEL_UNAVAILABLE",
      proposal: null,
      validation: timedOut ? "模型逾時，未提供提案" : "模型暫不可用，未提供提案",
      next,
      decidedBy: "系統規則（備援）",
    };
  }

  // Name the model's targeted field only when it is what the gate asks, or when the proposal was
  // rejected (e.g. 該資料已由使用者提供); an accepted-but-redirected ask stays generic.
  const rejected = step.validationResult === "REJECTED" || Boolean(step.proposalRejected);
  const namedField =
    rejected || step.humanGate?.missingField === proposal.missingField ? proposal.missingField : undefined;
  const label = proposalLabel(proposal.nextAction ?? "", proposal.toolName, namedField);
  if (step.validationResult === "REJECTED" || step.proposalRejected) {
    return {
      kind: "MODEL_REJECTED",
      proposal: label,
      validation: `駁回：${rejectionLabel(step.rejectionReason)}`,
      next,
      decidedBy: "系統規則",
    };
  }

  return {
    kind: "MODEL_ACCEPTED",
    proposal: label,
    validation: "通過",
    next,
    decidedBy: "採用模型提案",
  };
}

/**
 * Scope-explicit model usage for the CURRENT case only, derived from its own trace.
 * The provider/model configured for the deployment is a separate fact (目前可用模型) and a
 * planner latency may only be shown for this case when this case's model call returned a plan.
 */
export type CaseModelUse = {
  /** e.g. "本案決策：未呼叫模型" */
  label: string;
  /** true only when this case received a model plan (so a planner latency belongs to it). */
  modelPlanned: boolean;
};

export function describeCaseModelUse(run: AgentRun): CaseModelUse | null {
  const view = describeAgentDecision(run);
  if (!view) return null;
  switch (view.kind) {
    case "SYSTEM_ONLY":
      return { label: "本案決策：未呼叫模型（系統規則）", modelPlanned: false };
    case "MODEL_UNAVAILABLE":
      return { label: "本案決策：模型未提供提案，改用系統規則", modelPlanned: false };
    case "MODEL_REJECTED":
      return { label: "本案決策：已呼叫模型，提案經驗證駁回", modelPlanned: true };
    default:
      return { label: "本案決策：已呼叫模型並採用提案", modelPlanned: true };
  }
}
