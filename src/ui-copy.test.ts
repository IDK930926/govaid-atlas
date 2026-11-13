import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFailReasons } from "./ui-copy";

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
