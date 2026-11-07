import type { ApplicantProfile, AddressScenario, PolicyRule } from "../types";
import { buildDecisionPassport } from "../passport";
import { bindEvidence } from "../evidence";
import { detectConflicts, syntheticConflictClaims } from "../conflict";
import { evaluateScenario } from "../scenario";
import { evaluateRules, getOverallStatus } from "../rules";
import centralRulesJson from "../policies/central-rent-115.json";
import taipeiRulesJson from "../policies/taipei-rent-115.json";
import newTaipeiRulesJson from "../policies/new-taipei-rent-115.json";
import type { AgentToolName, ToolExecutionResult } from "./types";

const centralRules = centralRulesJson as PolicyRule[];
const taipeiRules = taipeiRulesJson as PolicyRule[];
const newTaipeiRules = newTaipeiRulesJson as PolicyRule[];

export const ALLOWED_TOOLS: AgentToolName[] = [
  "evaluate_central_rules",
  "evaluate_actual_scenario",
  "evaluate_what_if_scenario",
  "detect_policy_conflict",
  "generate_decision_passport",
  "get_policy_evidence",
];

export function listAllowedTools(): AgentToolName[] {
  return [...ALLOWED_TOOLS];
}

export function isAllowedToolName(name: string): name is AgentToolName {
  return (ALLOWED_TOOLS as string[]).includes(name);
}

export function callTool(
  toolName: string,
  argumentsObject?: Record<string, unknown>
): ToolExecutionResult {
  if (!isAllowedToolName(toolName)) {
    return {
      toolName,
      ok: false,
      status: "FAIL",
      summary: "AGENT_TOOL_DENIED",
      result: {
        reason: "Tool is not in the allowlist.",
      },
    };
  }

  switch (toolName) {
    case "evaluate_central_rules": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const evaluations = evaluateRules(centralRules, profile);
      const overallStatus = getOverallStatus(evaluations);
      return {
        toolName,
        ok: true,
        status: overallStatus,
        summary: `Central rules evaluated: ${overallStatus}`,
        result: {
          evaluations,
          overallStatus,
        },
      };
    }

    case "evaluate_actual_scenario": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const scenario = (argumentsObject?.scenario ?? {}) as AddressScenario;
      const result = evaluateScenario(scenario, profile, {
        central: centralRules,
        taipei: taipeiRules,
        newTaipei: newTaipeiRules,
      });
      return {
        toolName,
        ok: true,
        status: result.policyResults.some((policy) => policy.overallStatus === "UNCERTAIN")
          ? "UNCERTAIN"
          : "PASS",
        summary: `Actual scenario evaluated for ${scenario.city ?? "target city"}`,
        result,
      };
    }

    case "evaluate_what_if_scenario": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const scenario = (argumentsObject?.scenario ?? {}) as AddressScenario;
      const result = evaluateScenario(scenario, profile, {
        central: centralRules,
        taipei: taipeiRules,
        newTaipei: newTaipeiRules,
      });
      return {
        toolName,
        ok: true,
        status: result.policyResults.some((policy) => policy.overallStatus === "UNCERTAIN")
          ? "UNCERTAIN"
          : "PASS",
        summary: `What-if scenario evaluated for ${scenario.city ?? "target city"}`,
        result,
      };
    }

    case "detect_policy_conflict": {
      const claims = (argumentsObject?.claims ?? syntheticConflictClaims) as Array<{
        claimId: string;
        semanticKey: string;
        value: string | number | boolean;
        sourceId: string;
        sourceLabel: string;
        version: string;
        synthetic: boolean;
      }>;
      const result = detectConflicts(claims);
      return {
        toolName,
        ok: true,
        status: result.status === "CONFLICT" ? "HUMAN_REVIEW_REQUIRED" : "PASS",
        summary: result.reason,
        result,
      };
    }

    case "generate_decision_passport": {
      const passport = buildDecisionPassport(
        String(argumentsObject?.caseId ?? "CASE-P0-001"),
        (argumentsObject?.profile ?? {}) as ApplicantProfile,
        (argumentsObject?.actual ?? {}) as ReturnType<typeof evaluateScenario>,
        (argumentsObject?.whatIf ?? {}) as ReturnType<typeof evaluateScenario>
      );
      return {
        toolName,
        ok: true,
        status: "PASS",
        summary: `Decision passport generated for ${passport.caseId}`,
        result: passport,
      };
    }

    case "get_policy_evidence": {
      const evaluations = (argumentsObject?.evaluations ?? []) as Parameters<typeof bindEvidence>[0];
      const evidence = bindEvidence(evaluations);
      return {
        toolName,
        ok: true,
        status: evidence.length > 0 ? "PASS" : "UNCERTAIN",
        summary: `${evidence.length} evidence records bound`,
        result: evidence,
      };
    }

    default:
      return {
        toolName,
        ok: false,
        status: "FAIL",
        summary: "AGENT_TOOL_DENIED",
        result: {
          reason: "Unknown tool requested.",
        },
      };
  }
}
