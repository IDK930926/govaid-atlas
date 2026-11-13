import assert from "node:assert/strict";
import test from "node:test";
import { PARTIAL_CHECK_NOTE } from "./coverage";
import { toEligibilityStatus } from "./status";
import {
  getExecutedRuleSummaries,
  getMissingUserFieldLabels,
  getPolicyCoverageLimitation,
  getVerifiedRuleLabels,
  resultCopy,
  statusCopy,
  summarizeFailReasons,
} from "./ui-copy";

test("PARTIAL_CHECK keeps its enum and uses coverage-specific wording", () => {
  assert.equal(resultCopy.PARTIAL_CHECK.zh, "已完成系統可驗證項目");
  assert.equal(resultCopy.PARTIAL_CHECK.en, "PARTIAL_CHECK");
  assert.equal(statusCopy.PARTIAL_CHECK.zh, "已完成系統可驗證項目");
  assert.equal(toEligibilityStatus("PASS", "PARTIAL"), "PARTIAL_CHECK");

  const explanation = PARTIAL_CHECK_NOTE + getPolicyCoverageLimitation("CENTRAL_RENT_115");
  assert.ok(explanation.includes("主管機關"));
  assert.ok(!explanation.includes("尚未由本系統驗證"));
  assert.ok(!explanation.includes("缺少必要資料"));
});

test("verified and missing-field summaries only use actual rule results", () => {
  const evaluations = [
    {
      ruleId: "CENTRAL-115-HOME-001",
      status: "PASS" as const,
      reason: "ownsHome 通過規則",
      sourceId: "R1",
    },
    {
      ruleId: "CENTRAL-115-HOUSING-AID-001",
      status: "FAIL" as const,
      reason: "receivesOtherHousingAid 不符合規則",
      sourceId: "R1",
    },
    {
      ruleId: "TAIPEI-115-CENTRAL-001",
      status: "UNCERTAIN" as const,
      reason: "缺少必要資料：centralRentApproved",
      sourceId: "R6",
    },
  ];

  assert.deepEqual(getVerifiedRuleLabels(evaluations), ["名下住宅條件"]);
  assert.deepEqual(getExecutedRuleSummaries(evaluations), [
    "名下住宅條件：通過",
    "其他住宅補助條件：不符合",
  ]);
  assert.deepEqual(getMissingUserFieldLabels(evaluations), ["中央租金補貼是否已核准"]);
  assert.deepEqual(getVerifiedRuleLabels([]), []);
});

test("summarizeFailReasons lists unique, localized reasons for every failed rule", () => {
  assert.equal(
    summarizeFailReasons([
      {
        ruleId: "TAIPEI-115-REGISTERED-001",
        status: "FAIL",
        reason: "registeredCity 不符合規則",
        sourceId: "R6",
      },
      {
        ruleId: "TAIPEI-115-CENTRAL-001",
        status: "FAIL",
        reason: "centralRentApproved 不符合規則",
        sourceId: "R6",
      },
      {
        ruleId: "TAIPEI-115-REGISTERED-001",
        status: "FAIL",
        reason: "registeredCity 不符合規則",
        sourceId: "R6",
      },
      {
        ruleId: "OTHER-RULE",
        status: "PASS",
        reason: "rule passed",
        sourceId: "R1",
      },
    ]),
    "未設籍臺北市、中央租金補貼尚未核准"
  );

  assert.equal(
    summarizeFailReasons([
      {
        ruleId: "NEWTAIPEI-115-LOCAL-001",
        status: "FAIL",
        reason: "newTaipeiResidenceStudyWork 不符合規則",
        sourceId: "R7",
      },
    ]),
    "未符合新北市設籍、就學或就業條件"
  );
});
