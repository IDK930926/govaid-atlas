// Compact, judge-readable view of the Agent's planning decision:
//   模型提案 (Proposal) → 系統驗證 (Validation) → 下一步 (Next state)
// Built only from the structured trace of the planning step. It never shows model reasoning,
// free-text model questions, tokens or raw codes, and never invents a proposal.
import { getQuestionForMissingField } from "./agent/missing-fields";
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

function proposalLabel(nextAction: string, toolName?: string): string {
  switch (nextAction) {
    case "CALL_TOOL":
      return `執行${toolName ? toolCopy[toolName]?.zh ?? "政策工具" : "政策工具"}`;
    case "ASK_HUMAN":
      return "詢問缺漏資料";
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
  if (step.finalStatus === "NOT_COVERED" || step.coverageStatus === "NOT_COVERED") {
    return "停止判定，提供官方查詢管道";
  }
  if (step.finalStatus === "HUMAN_REVIEW_REQUIRED") {
    return "停止確定式判斷，轉人工審查";
  }
  const field = step.humanGate?.missingField;
  if (field) {
    // System wording for the field, never the model's free-text question.
    const question = getQuestionForMissingField(field as Parameters<typeof getQuestionForMissingField>[0]);
    const stillWaiting = run.status === "WAITING_FOR_HUMAN" && run.missingField === field;
    return stillWaiting ? `請你確認：${question}` : `已請你確認：${question}（已回答）`;
  }
  if (step.selectedTool) {
    return `執行${toolCopy[step.selectedTool]?.zh ?? "政策工具"}`;
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

  const label = proposalLabel(proposal.nextAction ?? "", proposal.toolName);
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
