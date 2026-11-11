import type { ApplicantProfile, AddressScenario, PolicyRule } from "../types";
import { buildChildcareDecisionPassport, buildDecisionPassport } from "../passport";
import { bindEvidence } from "../evidence";
import { detectConflicts, syntheticConflictClaims } from "../conflict";
import { evaluateScenario } from "../scenario";
import { evaluateChildcarePolicy, type ChildcareEvaluationResult } from "../childcare";
import { evaluateRules, getOverallStatus, type RuleEvaluationOptions } from "../rules";
import { aggregateEligibilityStatus, toEligibilityStatus } from "../status";
import { getPolicyCompleteness, PARTIAL_CHECK_NOTE } from "../coverage";
import {
  detectMissingFields,
  getQuestionForMissingField,
  isSupportedMissingField,
  SUPPORTED_MISSING_FIELDS,
} from "./missing-fields";
import centralRulesJson from "../policies/central-rent-115.json";
import taipeiRulesJson from "../policies/taipei-rent-115.json";
import newTaipeiRulesJson from "../policies/new-taipei-rent-115.json";
import taoyuanRulesJson from "../policies/taoyuan-rent-115.json";
import type { AgentToolName, SupportedMissingField, ToolExecutionResult } from "./types";

const centralRules = centralRulesJson as PolicyRule[];
const taipeiRules = taipeiRulesJson as PolicyRule[];
const newTaipeiRules = newTaipeiRulesJson as PolicyRule[];
const taoyuanRules = taoyuanRulesJson as PolicyRule[];

export const ALLOWED_TOOLS: AgentToolName[] = [
  "evaluate_central_rules",
  "evaluate_actual_scenario",
  "evaluate_what_if_scenario",
  "evaluate_childcare_rules",
  "detect_policy_conflict",
  "generate_decision_passport",
  "generate_childcare_passport",
  "get_policy_evidence",
  "request_missing_field",
  "request_human_confirmation",
  "complete",
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
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const evaluations = evaluateRules(centralRules, profile, options);
      const overallStatus = getOverallStatus(evaluations);
      // Central rules encode only a subset of official conditions, so a rule-level
      // PASS is reported as PARTIAL_CHECK, never as a complete PASS.
      const eligibilityStatus = toEligibilityStatus(
        overallStatus,
        getPolicyCompleteness("CENTRAL_RENT_115")
      );
      return {
        toolName,
        ok: true,
        status: eligibilityStatus,
        summary: `Central rules evaluated: ${eligibilityStatus}`,
        result: {
          evaluations,
          overallStatus,
          eligibilityStatus,
          coverageNote: eligibilityStatus === "PARTIAL_CHECK" ? PARTIAL_CHECK_NOTE : undefined,
        },
      };
    }

    case "evaluate_actual_scenario": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const scenario = (argumentsObject?.scenario ?? {}) as AddressScenario;
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const result = evaluateScenario(
        scenario,
        profile,
        {
          central: centralRules,
          taipei: taipeiRules,
          newTaipei: newTaipeiRules,
          taoyuan: taoyuanRules,
        },
        options
      );
      return {
        toolName,
        ok: true,
        // FAIL-first aggregation; never "some policy PASS => PASS".
        status: result.overallStatus,
        summary: `Actual scenario evaluated for ${scenario.city ?? "target city"}: ${result.overallStatus}`,
        result,
      };
    }

    case "evaluate_what_if_scenario": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const scenario = (argumentsObject?.scenario ?? {}) as AddressScenario;
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const result = evaluateScenario(
        scenario,
        profile,
        {
          central: centralRules,
          taipei: taipeiRules,
          newTaipei: newTaipeiRules,
          taoyuan: taoyuanRules,
        },
        options
      );
      return {
        toolName,
        ok: true,
        status: result.overallStatus,
        summary: `What-if scenario evaluated for ${scenario.city ?? "target city"}: ${result.overallStatus}`,
        result,
      };
    }

    case "evaluate_childcare_rules": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const result = evaluateChildcarePolicy(profile, options);
      return {
        toolName,
        ok: true,
        status: result.eligibilityStatus,
        summary: `Childcare rules evaluated: ${result.eligibilityStatus}${
          result.estimatedMonthlyBenefitNtd ? ` (${result.estimatedMonthlyBenefitNtd} NTD/month)` : ""
        }`,
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
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const passport = buildDecisionPassport(
        String(argumentsObject?.caseId ?? "CASE-P0-001"),
        (argumentsObject?.profile ?? {}) as ApplicantProfile,
        (argumentsObject?.actual ?? {}) as ReturnType<typeof evaluateScenario>,
        (argumentsObject?.whatIf ?? {}) as ReturnType<typeof evaluateScenario>,
        options
      );
      return {
        toolName,
        ok: true,
        // Report the passport's own aggregated verdict instead of a generic PASS,
        // so "passport generated" is never mistaken for "eligible".
        status: aggregateEligibilityStatus([passport.actual.overallStatus, passport.whatIf.overallStatus]),
        summary: `Decision passport generated for ${passport.caseId}`,
        result: passport,
      };
    }

    case "generate_childcare_passport": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const options = argumentsObject?.options as RuleEvaluationOptions | undefined;
      const childcareResult =
        (argumentsObject?.childcareResult as ChildcareEvaluationResult | undefined) ??
        evaluateChildcarePolicy(profile, options);
      const passport = buildChildcareDecisionPassport(
        String(argumentsObject?.caseId ?? "CASE-CHILDCARE-001"),
        profile,
        childcareResult
      );
      return {
        toolName,
        ok: true,
        status: passport.actual.overallStatus,
        summary: `Childcare decision passport generated for ${passport.caseId}: ${passport.actual.overallStatus}`,
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

    case "request_missing_field": {
      const profile = (argumentsObject?.profile ?? {}) as ApplicantProfile;
      const scenario = (argumentsObject?.scenario ?? undefined) as AddressScenario | undefined;
      const requestedField = argumentsObject?.field;
      const detected = detectMissingFields(profile, scenario, [...SUPPORTED_MISSING_FIELDS]);
      const field: SupportedMissingField = isSupportedMissingField(requestedField)
        ? requestedField
        : detected[0] ?? "ownsHome";
      const question = getQuestionForMissingField(field);
      return {
        toolName,
        ok: true,
        status: "UNCERTAIN",
        summary: `Missing field requested: ${field}`,
        result: {
          missingField: field,
          question,
        },
      };
    }

    case "request_human_confirmation": {
      const requestedField = argumentsObject?.field;
      const field: SupportedMissingField = isSupportedMissingField(requestedField) ? requestedField : "ownsHome";
      const question =
        typeof argumentsObject?.question === "string" && argumentsObject.question.trim()
          ? argumentsObject.question.trim()
          : getQuestionForMissingField(field);
      return {
        toolName,
        ok: true,
        status: "UNCERTAIN",
        summary: `Human confirmation requested for ${field}`,
        result: {
          missingField: field,
          question,
        },
      };
    }

    case "complete": {
      return {
        toolName,
        ok: true,
        // Completion marker never upgrades eligibility to PASS on its own.
        status: "PARTIAL_CHECK",
        summary: "Workflow completion requested",
        result: {
          completed: true,
        },
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
