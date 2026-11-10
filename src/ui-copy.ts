import type {AgentStatus} from "./agent/types";

export type BilingualCopy = {zh: string; en: string};

// Presentation only. Raw state and rule semantics remain owned by the agent.
export const agentStatusCopy: Record<AgentStatus, BilingualCopy> = {
  IDLE: {zh: "待命", en: "Idle"},
  PLANNING: {zh: "規劃中", en: "Planning"},
  RUNNING_TOOL: {zh: "執行工具", en: "Running tool"},
  WAITING_FOR_HUMAN: {zh: "等待人工確認", en: "Waiting for human"},
  RESUMING: {zh: "繼續執行", en: "Resuming"},
  COMPLETED: {zh: "已完成", en: "Completed"},
  FAILED: {zh: "執行失敗", en: "Failed"},
  HUMAN_REVIEW_REQUIRED: {zh: "需要人工審查", en: "Human review required"},
};

// Main-surface wording for each agent status. Raw enums only appear in Audit / Debug.
export const statusDisplayCopy: Record<AgentStatus, string> = {
  IDLE: "準備開始",
  PLANNING: "分析中",
  RUNNING_TOOL: "正在執行政策工具",
  WAITING_FOR_HUMAN: "等待你的確認",
  RESUMING: "繼續分析",
  COMPLETED: "分析完成",
  FAILED: "分析未完成",
  HUMAN_REVIEW_REQUIRED: "需要人工審查",
};

// Rule-engine outcome wording. Semantics stay PASS / FAIL / UNCERTAIN; only the label changes.
export const resultCopy: Record<"PASS" | "FAIL" | "UNCERTAIN", BilingualCopy> = {
  PASS: {zh: "通過", en: "PASS"},
  FAIL: {zh: "不符合", en: "FAIL"},
  UNCERTAIN: {zh: "待確認", en: "UNCERTAIN"},
};

export const workflowSteps: {key: string; zh: string; en: string}[] = [
  {key: "goal", zh: "申請目標", en: "Goal"},
  {key: "analyze", zh: "Agent 分析", en: "Analyze"},
  {key: "human", zh: "人工確認", en: "Human Gate"},
  {key: "compare", zh: "情境比較", en: "Compare"},
  {key: "decision", zh: "決策護照", en: "Decision"},
];

export const statusCopy: Record<string, BilingualCopy> = {
  ...agentStatusCopy,
  PASS: {zh: "通過", en: "PASS"},
  FAIL: {zh: "不通過", en: "FAIL"},
  UNCERTAIN: {zh: "待確認", en: "UNCERTAIN"},
  PENDING: {zh: "等待中", en: "PENDING"},
  ACTIVE: {zh: "執行中", en: "ACTIVE"},
  DONE: {zh: "完成", en: "DONE"},
  BLOCKED: {zh: "受阻", en: "BLOCKED"},
  AVAILABLE: {zh: "可用", en: "AVAILABLE"},
  UNAVAILABLE: {zh: "無法使用", en: "UNAVAILABLE"},
  UNKNOWN: {zh: "檢查中", en: "CHECKING"},
  CLEAR: {zh: "無衝突", en: "Clear"},
  CONFLICT: {zh: "發現衝突", en: "Conflict"},
  CONTINUE: {zh: "繼續執行", en: "Continue"},
  ALLOWED: {zh: "允許存取", en: "Allowed"},
  ACCESS_DENIED: {zh: "拒絕存取", en: "Access denied"},
};

export const currentStepCopy: Record<AgentStatus, {title: BilingualCopy; description: BilingualCopy}> = {
  IDLE: {
    title: {zh: "準備開始", en: "Ready to begin"},
    description: {zh: "輸入申請目標，開始規劃補助導航。", en: "Enter a goal to start your benefit navigation."},
  },
  PLANNING: {
    title: agentStatusCopy.PLANNING,
    description: {zh: "Agent 正在理解目標並規劃工具執行順序。", en: "The agent is understanding the goal and planning tool execution."},
  },
  RUNNING_TOOL: {
    title: agentStatusCopy.RUNNING_TOOL,
    description: {zh: "依規則引擎與官方證據檢查必要條件。", en: "Checking required conditions against rules and official evidence."},
  },
  WAITING_FOR_HUMAN: {
    title: {zh: "需要人工確認", en: "Human confirmation required"},
    description: {zh: "必要條件尚未確認，Agent 已暫停推論。", en: "A required condition is still unknown, so the agent has paused."},
  },
  RESUMING: {
    title: agentStatusCopy.RESUMING,
    description: {zh: "已收到人工確認，重新執行規則檢查。", en: "Human input received; running the rules again."},
  },
  COMPLETED: {
    title: {zh: "決策護照已產出", en: "Decision passport ready"},
    description: {zh: "情境比較與政策依據已整理，未確認條件仍保留待確認狀態。", en: "Scenarios and evidence are ready; unknown conditions remain uncertain."},
  },
  FAILED: {
    title: agentStatusCopy.FAILED,
    description: {zh: "本次執行未能完成，請檢查除錯資訊後重試。", en: "This run could not finish. Check debug details before retrying."},
  },
  HUMAN_REVIEW_REQUIRED: {
    title: agentStatusCopy.HUMAN_REVIEW_REQUIRED,
    description: {zh: "政策資料需要人工查核，Agent 已停止確定式判斷。", en: "Policy information needs human review; definitive judgment has paused."},
  },
};

export const toolCopy: Record<string, BilingualCopy> = {
  evaluate_central_rules: {zh: "中央補助規則檢查", en: "Central rules"},
  evaluate_actual_scenario: {zh: "實際情境評估", en: "Actual scenario"},
  evaluate_what_if_scenario: {zh: "假設情境評估", en: "What-if scenario"},
  detect_policy_conflict: {zh: "政策衝突檢查", en: "Conflict check"},
  generate_decision_passport: {zh: "產出決策護照", en: "Decision passport"},
  get_policy_evidence: {zh: "取得政策依據", en: "Policy evidence"},
};

export const roleCopy: Record<string, BilingualCopy> = {
  APPLICANT: {zh: "申請人", en: "Applicant"},
  REVIEWER: {zh: "審查人員", en: "Reviewer"},
  POLICY_ADMIN: {zh: "政策管理員", en: "Policy admin"},
};

export const benchmarkCopy: Record<string, BilingualCopy> = {
  statusAccuracy: {zh: "狀態正確率", en: "Status Accuracy"},
  evidenceCoverage: {zh: "證據覆蓋率", en: "Evidence Coverage"},
  unsupportedClaim: {zh: "無依據主張", en: "Unsupported Claims"},
  unsafeCertainty: {zh: "過度確定率", en: "Unsafe Certainty"},
};

export const actorCopy: Record<string, BilingualCopy> = {
  USER: {zh: "使用者", en: "User"},
  AGENT: {zh: "代理", en: "Agent"},
  SYSTEM: {zh: "系統", en: "System"},
  RULE_ENGINE: {zh: "規則引擎", en: "Rules"},
  LLM: {zh: "語言模型", en: "LLM"},
};

export const auditCopy: Record<string, BilingualCopy> = {
  CASE_CREATED: {zh: "建立案件", en: "Case created"},
  INITIAL_EVALUATION: {zh: "初步規則檢查", en: "Initial evaluation"},
  HUMAN_CONFIRMATION_REQUIRED: {zh: "要求人工確認", en: "Human confirmation required"},
  FIELD_CONFIRMED: {zh: "已確認資料", en: "Field confirmed"},
  ROLE_CHANGED: {zh: "切換角色", en: "Role changed"},
  ACCESS_DENIED: statusCopy.ACCESS_DENIED,
  MASKED_PROFILE_ACCESSED: {zh: "存取遮罩資料", en: "Masked profile accessed"},
  SENSITIVE_PROFILE_ACCESSED: {zh: "存取個人資料", en: "Profile accessed"},
  ACTUAL_SCENARIO_EVALUATED: {zh: "實際情境評估完成", en: "Actual scenario evaluated"},
  WHAT_IF_SCENARIO_EVALUATED: {zh: "假設情境評估完成", en: "What-if scenario evaluated"},
  DECISION_PASSPORT_GENERATED: {zh: "產出決策護照", en: "Passport generated"},
  POLICY_CONFLICT_CHECK: {zh: "政策衝突檢查", en: "Policy conflict check"},
  HUMAN_REVIEW_REQUIRED: statusCopy.HUMAN_REVIEW_REQUIRED,
  AGENT_RUN_STARTED: {zh: "代理啟動", en: "Agent started"},
  AGENT_PLAN_CREATED: {zh: "建立執行計畫", en: "Plan created"},
  AGENT_LLM_CALL_COMPLETED: {zh: "模型推論完成", en: "Model call completed"},
  AGENT_LLM_CALL_FAILED: {zh: "模型推論失敗", en: "Model call failed"},
  AGENT_TOOL_REQUESTED: {zh: "呼叫工具", en: "Tool requested"},
  AGENT_TOOL_COMPLETED: {zh: "工具執行完成", en: "Tool completed"},
  AGENT_WAITING_FOR_HUMAN: {zh: "等待人工確認", en: "Waiting for human"},
  AGENT_RESUMED: {zh: "恢復代理執行", en: "Agent resumed"},
  AGENT_COMPLETED: {zh: "代理執行完成", en: "Agent completed"},
  AGENT_PROVIDER_SELECTED: {zh: "選定模型供應者", en: "Provider selected"},
  AGENT_PROVIDER_CALL_STARTED: {zh: "開始呼叫模型", en: "Provider call started"},
  AGENT_PROVIDER_CALL_COMPLETED: {zh: "模型呼叫完成", en: "Provider call completed"},
  AGENT_PROVIDER_CALL_FAILED: {zh: "模型呼叫失敗", en: "Provider call failed"},
  AGENT_PROVIDER_FALLBACK: {zh: "切換備援模型", en: "Provider fallback"},
  AGENT_PROVIDER_UNAVAILABLE: {zh: "模型皆無法使用", en: "Provider unavailable"},
  DETERMINISTIC_WORKFLOW_COMPLETED: {zh: "規則式安全流程完成", en: "Deterministic workflow completed"},
};
