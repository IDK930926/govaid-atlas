// What each evaluation figure in the governance panel actually measures. Presentation only:
// no result is recalculated here, and nothing unmeasured is ever shown as a percentage.

export type EvaluationScopeRow = {
  key: "ruleEngineRegression" | "syntheticBenchmark" | "agentEndToEnd" | "humanBaseline" | "fieldValidation";
  label: string;
  en: string;
  value: string;
  status: "MEASURED" | "PENDING" | "NOT_MEASURED";
  note: string;
};

export function evaluationScopeRows(input: {
  regressionPassed: number;
  regressionTotal: number;
  benchmarkCaseCount: number;
  manualBaseline: string;
}): EvaluationScopeRow[] {
  const manualPending = input.manualBaseline === "PENDING";
  return [
    {
      key: "ruleEngineRegression",
      label: "規則引擎回歸測試",
      en: "Rule-engine regression",
      value: `${input.regressionPassed}/${input.regressionTotal}`,
      status: "MEASURED",
      note: "確定性規則引擎對合成案例的狀態判定；不含 LLM 規劃。",
    },
    {
      key: "syntheticBenchmark",
      label: "合成案例對照（上方表格）",
      en: "Synthetic benchmark",
      value: `${input.benchmarkCaseCount} 案`,
      status: "MEASURED",
      note: "GovAid Atlas 欄位為規則引擎評估；Gold 答案依目前實作撰寫，尚待獨立審查。不是真實世界準確率。",
    },
    {
      key: "agentEndToEnd",
      label: "Agent 端到端成功率",
      en: "Agent end-to-end success",
      value: "NOT MEASURED",
      status: "NOT_MEASURED",
      note: "本面板未納入含 LLM 規劃與人工確認的完整流程成功率，因此不顯示百分比。",
    },
    {
      key: "humanBaseline",
      label: "人工基準（官方網站 vs. GovAid）",
      en: "Human baseline",
      value: manualPending ? "PENDING" : input.manualBaseline,
      status: manualPending ? "PENDING" : "MEASURED",
      note: "人工查詢官方網站之對照組。",
    },
    {
      key: "fieldValidation",
      label: "場域驗證（真實使用者）",
      en: "Field validation",
      value: "PENDING",
      status: "PENDING",
      note: "真實使用者試用與回饋尚未完成。",
    },
  ];
}
