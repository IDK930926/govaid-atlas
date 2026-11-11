import rulesJson from "./policies/central-rent-115.json";
import taipeiRulesJson
  from "./policies/taipei-rent-115.json";

import newTaipeiRulesJson
  from "./policies/new-taipei-rent-115.json";

import type {
  ApplicantProfile,
  PolicyRule,
  AuditEvent,
} from "./types";

import {
  evaluateRules,
  getOverallStatus,
} from "./rules";

import {
  bindEvidence,
} from "./evidence";

import {
  evaluateScenario,
} from "./scenario";

import type {
  AddressScenario,
} from "./types";

import {
  buildDecisionPassport,
} from "./passport";

const rules = rulesJson as PolicyRule[];

const taipeiRules =
  taipeiRulesJson as PolicyRule[];

const newTaipeiRules =
  newTaipeiRulesJson as PolicyRule[];

// -----------------------------
// Audit Trail
// -----------------------------

const auditTrail: AuditEvent[] = [];

function audit(
  actor: AuditEvent["actor"],
  action: string,
  input?: unknown,
  output?: unknown,
  policyVersion = "CENTRAL-RENT-115"
) {

  auditTrail.push({
    timestamp: new Date().toISOString(),
    actor,
    action,
    input,
    output,
    policyVersion,
  });
}

// -----------------------------
// 初始申請人
// -----------------------------

const applicant: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",

  // 故意未知
  ownsHome: null,

  receivesOtherHousingAid: false,
  monthlyIncome: null,

  centralRentApproved: null,
  newTaipeiResidenceStudyWork: null,

};

console.log(
  "\n=== GovAid Atlas P0 Golden Case ===\n"
);

// -----------------------------
// Phase 1：第一次評估
// -----------------------------

audit(
  "USER",
  "CASE_CREATED",
  applicant
);

const firstEvaluation =
  evaluateRules(rules, applicant);

const firstStatus =
  getOverallStatus(firstEvaluation);

audit(
  "RULE_ENGINE",
  "INITIAL_EVALUATION",
  applicant,
  {
    evaluations: firstEvaluation,
    overallStatus: firstStatus,
  }
);

console.log("STEP 1：初次資格預審");
console.table(firstEvaluation);

console.log(
  "Overall Status:",
  firstStatus
);

// -----------------------------
// Agent 發現缺資料
// -----------------------------

if (firstStatus === "UNCERTAIN") {
  console.log(
    "\n⚠️ Agent 暫停：缺少住宅持有資訊"
  );

  audit(
    "AGENT",
    "HUMAN_CONFIRMATION_REQUIRED",
    {
      missingField: "ownsHome",
    }
  );
}

// -----------------------------
// Phase 2：模擬使用者補資料
// -----------------------------

console.log(
  "\nSTEP 2：使用者補充資料"
);

applicant.ownsHome = false;

console.log(
  "使用者確認：本人目前無自有住宅"
);

audit(
  "USER",
  "FIELD_CONFIRMED",
  {
    field: "ownsHome",
    value: false,
  }
);

// -----------------------------
// Phase 3：重新評估
// -----------------------------

const secondEvaluation =
  evaluateRules(rules, applicant);

const secondStatus =
  getOverallStatus(secondEvaluation);

const evidenceBoundResults =
  bindEvidence(secondEvaluation);

audit(
  "RULE_ENGINE",
  "RE_EVALUATION",
  applicant,
  {
    evaluations: secondEvaluation,
    overallStatus: secondStatus,
  }
);

console.log(
  "\nSTEP 3：重新執行 Rules Engine"
);

console.table(secondEvaluation);

console.log(
  "Overall Status:",
  secondStatus
);

console.log(
  "\n=== Evidence Binding ==="
);

for (const result of evidenceBoundResults) {
  console.log(
    `\nRule: ${result.ruleId}`
  );

  console.log(
    `Status: ${result.status}`
  );

  if (result.evidence) {
    console.log(
      `Source: ${result.evidence.sourceId}`
    );

    console.log(
      `Agency: ${result.evidence.agency}`
    );

    console.log(
      `Policy: ${result.evidence.policyName}`
    );

    console.log(
      `Verified: ${result.evidence.lastVerifiedAt}`
    );

    console.log(
      `URL: ${result.evidence.url}`
    );
  } else {
    console.log(
      "⚠️ Evidence missing"
    );
  }
}

// -----------------------------
// Phase 4：ACTUAL vs WHAT-IF
// -----------------------------

const actualScenario: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfScenario: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

console.log(
  "\n=== ACTUAL vs WHAT-IF ==="
);

// 真正執行 ACTUAL 情境
const actualResult =
  evaluateScenario(
    actualScenario,
    applicant,
    {
      central: rules,
      taipei: taipeiRules,
      newTaipei: newTaipeiRules,
    }
  );

// 真正執行 WHAT-IF 情境
const whatIfResult =
  evaluateScenario(
    whatIfScenario,
    applicant,
    {
      central: rules,
      taipei: taipeiRules,
      newTaipei: newTaipeiRules,
    }
  );

// 寫入 Audit Trail
audit(
  "SYSTEM",
  "ACTUAL_SCENARIO_EVALUATED",
  actualScenario,
  actualResult,
  "CENTRAL-RENT-115 + NEW-TAIPEI-RENT-115"
);

audit(
  "SYSTEM",
  "WHAT_IF_SCENARIO_EVALUATED",
  whatIfScenario,
  whatIfResult,
  "CENTRAL-RENT-115 + TAIPEI-RENT-115"
);

// -----------------------------
// ACTUAL 結果
// -----------------------------

console.log("\n[ACTUAL]");

console.log(
  `${actualResult.scenario.city}${actualResult.scenario.district}`
);

console.log(
  `Rent: ${actualResult.scenario.monthlyRent}`
);

for (const policy of actualResult.policyResults) {
  console.log(
    `${policy.policyId}: ${policy.eligibilityStatus} (rules: ${policy.overallStatus})`
  );

  console.table(policy.evaluations);
}

// -----------------------------
// WHAT-IF 結果
// -----------------------------

console.log("\n[WHAT-IF]");

console.log(
  `${whatIfResult.scenario.city}${whatIfResult.scenario.district}`
);

console.log(
  `Rent: ${whatIfResult.scenario.monthlyRent}`
);

for (const policy of whatIfResult.policyResults) {
  console.log(
    `${policy.policyId}: ${policy.eligibilityStatus} (rules: ${policy.overallStatus})`
  );

  console.table(policy.evaluations);
}

// -----------------------------
// Phase 5：Decision Passport
// -----------------------------

const passport =
  buildDecisionPassport(
    "CASE-P0-001",
    applicant,
    actualResult,
    whatIfResult
  );

audit(
  "SYSTEM",
  "DECISION_PASSPORT_GENERATED",
  {
    caseId: "CASE-P0-001",
  },
  passport,
  "MULTI-POLICY"
);

console.log(
  "\n=== Decision Passport ==="
);

console.log(
  JSON.stringify(
    passport,
    null,
    2
  )
);

// -----------------------------
// Audit Trail
// -----------------------------

console.log(
  "\n=== Audit Trail ==="
);

console.table(
  auditTrail.map((event) => ({
    time: event.timestamp,
    actor: event.actor,
    action: event.action,
    policyVersion: event.policyVersion,
  }))
);