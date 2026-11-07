import type {
  AddressScenario,
  ApplicantProfile,
} from "./types";

import type {
  ConflictClaim,
} from "./conflict";

export type ExpectedStatus =
  | "PASS"
  | "FAIL"
  | "UNCERTAIN";

export type CentralBenchmarkCase = {
  id: string;
  name: string;
  category: "CENTRAL";
  profile: ApplicantProfile;
  expectedStatus: ExpectedStatus;
};

export type ScenarioBenchmarkCase = {
  id: string;
  name: string;
  category: "SCENARIO";
  profile: ApplicantProfile;
  scenario: AddressScenario;
  expectedPolicyId: string;
  expectedStatus: ExpectedStatus;
};

export type ConflictBenchmarkCase = {
  id: string;
  name: string;
  category: "CONFLICT";
  claims: ConflictClaim[];
  expectedStatus:
    | "CLEAR"
    | "CONFLICT";
  expectedResolution:
    | "CONTINUE"
    | "HUMAN_REVIEW_REQUIRED";
};

export type RecoveryBenchmarkCase = {
  id: string;
  name: string;
  category: "RECOVERY";
  before: ApplicantProfile;
  after: ApplicantProfile;
  expectedBefore: ExpectedStatus;
  expectedAfter: ExpectedStatus;
};

export type BenchmarkCase =
  | CentralBenchmarkCase
  | ScenarioBenchmarkCase
  | ConflictBenchmarkCase
  | RecoveryBenchmarkCase;

const baseProfile: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",

  ownsHome: false,
  receivesOtherHousingAid: false,
  monthlyIncome: null,

  centralRentApproved: null,
  newTaipeiResidenceStudyWork: null,
};

const actualNewTaipei:
  AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

const whatIfTaipei:
  AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

export const benchmarkCases:
  BenchmarkCase[] = [
  {
    id: "B01",
    name: "中央規則全部通過",
    category: "CENTRAL",
    profile: {
      ...baseProfile,
      ownsHome: false,
      receivesOtherHousingAid: false,
    },
    expectedStatus: "PASS",
  },

  {
    id: "B02",
    name: "持有住宅應判 FAIL",
    category: "CENTRAL",
    profile: {
      ...baseProfile,
      ownsHome: true,
    },
    expectedStatus: "FAIL",
  },

  {
    id: "B03",
    name: "接受其他住宅協助應判 FAIL",
    category: "CENTRAL",
    profile: {
      ...baseProfile,
      receivesOtherHousingAid: true,
    },
    expectedStatus: "FAIL",
  },

  {
    id: "B04",
    name: "住宅持有未知應判 UNCERTAIN",
    category: "CENTRAL",
    profile: {
      ...baseProfile,
      ownsHome: null,
    },
    expectedStatus: "UNCERTAIN",
  },

  {
    id: "B05",
    name: "其他住宅協助未知應判 UNCERTAIN",
    category: "CENTRAL",
    profile: {
      ...baseProfile,
      receivesOtherHousingAid: null,
    },
    expectedStatus: "UNCERTAIN",
  },

  {
    id: "B06",
    name: "新北地方條件未知",
    category: "SCENARIO",
    profile: {
      ...baseProfile,
      newTaipeiResidenceStudyWork: null,
    },
    scenario: actualNewTaipei,
    expectedPolicyId:
      "NEW_TAIPEI_RENT_115",
    expectedStatus: "UNCERTAIN",
  },

  {
    id: "B07",
    name: "新北地方條件確認通過",
    category: "SCENARIO",
    profile: {
      ...baseProfile,
      newTaipeiResidenceStudyWork: true,
    },
    scenario: actualNewTaipei,
    expectedPolicyId:
      "NEW_TAIPEI_RENT_115",
    expectedStatus: "PASS",
  },

  {
    id: "B08",
    name: "臺北中央核准狀態未知",
    category: "SCENARIO",
    profile: {
      ...baseProfile,
      registeredCity: "臺北市",
      centralRentApproved: null,
    },
    scenario: whatIfTaipei,
    expectedPolicyId:
      "TAIPEI_RENT_115",
    expectedStatus: "UNCERTAIN",
  },

  {
    id: "B09",
    name: "臺北地方方案前置條件通過",
    category: "SCENARIO",
    profile: {
      ...baseProfile,
      registeredCity: "臺北市",
      centralRentApproved: true,
    },
    scenario: whatIfTaipei,
    expectedPolicyId:
      "TAIPEI_RENT_115",
    expectedStatus: "PASS",
  },

  {
    id: "B10",
    name: "合成衝突應觸發人工審查",
    category: "CONFLICT",
    claims: [
      {
        claimId: "B10-A",
        semanticKey:
          "benchmark.syntheticEligibility",
        value: "ALLOW",
        sourceId: "SYN-A",
        sourceLabel: "合成來源 A",
        version: "TEST-V1",
        synthetic: true,
      },
      {
        claimId: "B10-B",
        semanticKey:
          "benchmark.syntheticEligibility",
        value: "DENY",
        sourceId: "SYN-B",
        sourceLabel: "合成來源 B",
        version: "TEST-V2",
        synthetic: true,
      },
    ],
    expectedStatus: "CONFLICT",
    expectedResolution:
      "HUMAN_REVIEW_REQUIRED",
  },

  {
    id: "B11",
    name: "一致規則不應誤報衝突",
    category: "CONFLICT",
    claims: [
      {
        claimId: "B11-A",
        semanticKey:
          "benchmark.syntheticEligibility",
        value: "ALLOW",
        sourceId: "SYN-A",
        sourceLabel: "合成來源 A",
        version: "TEST-V1",
        synthetic: true,
      },
      {
        claimId: "B11-B",
        semanticKey:
          "benchmark.syntheticEligibility",
        value: "ALLOW",
        sourceId: "SYN-B",
        sourceLabel: "合成來源 B",
        version: "TEST-V2",
        synthetic: true,
      },
    ],
    expectedStatus: "CLEAR",
    expectedResolution:
      "CONTINUE",
  },

  {
    id: "B12",
    name: "補資料後可由 UNCERTAIN 恢復為 PASS",
    category: "RECOVERY",
    before: {
      ...baseProfile,
      ownsHome: null,
    },
    after: {
      ...baseProfile,
      ownsHome: false,
    },
    expectedBefore:
      "UNCERTAIN",
    expectedAfter:
      "PASS",
  },
];