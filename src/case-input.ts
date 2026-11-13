// Gate A — Arbitrary applicant cases for the competition UI.
//
// This module is the single source of truth for turning
//   (natural-language goal, selected preset, user-edited structured fields)
// into the exact ApplicantProfile / AddressScenario that the bounded Agent and the
// deterministic rule engine evaluate. The UI renders persona chips from the same
// draft it hands to the Agent, so "displayed persona" === "evaluated persona".
//
// Design rules:
// - Structured fields are the source of truth for eligibility facts.
// - Natural-language extraction is conservative: only clearly stated values are
//   extracted; anything ambiguous stays missing so the Human Gate asks.
// - User-edited fields always override extracted values and preset values.
// - Housing and childcare facts never leak across domains.
// - No eligibility logic lives here; the deterministic engine decides.

import { detectBenefitDomain, isSupportedTaiwanCity, normalizeCityName, TAIWAN_CITIES } from "./coverage";
import { validateMissingFieldInput } from "./agent/missing-fields";
import { resumeAgentWithFieldResponse, runAgenticGoldenCase } from "./agent/orchestrator";
import type { AgentRun, SupportedMissingField } from "./agent/types";
import type { ProviderPlannerResult } from "./agent/providers/types";
import type { AddressScenario, ApplicantProfile, BenefitDomain } from "./types";

// ---------------------------------------------------------------------------
// Field catalogue
// ---------------------------------------------------------------------------

export type HousingCaseField =
  | "city"
  | "registeredCity"
  | "age"
  | "monthlyIncome"
  | "monthlyRent"
  | "ownsHome"
  | "receivesOtherHousingAid"
  | "centralRentApproved"
  | "newTaipeiResidenceStudyWork";

export type ChildcareCaseField =
  | "childAgeMonths"
  | "birthOrder"
  | "childHasBirthOrInitialHouseholdRegistration"
  | "receivesPublicOrQuasiPublicChildcare"
  | "isGovernmentPlaced"
  | "childRegisteredCity";

export type CaseField = HousingCaseField | ChildcareCaseField;
export type CaseFieldValue = number | boolean | string;
export type FieldKind = "city" | "integer" | "number" | "boolean";

export type BooleanOption = { value: boolean; label: string };

export type FieldSpec = {
  field: CaseField;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  /** Yes/No answer labels, in display order. */
  booleanOptions?: BooleanOption[];
  /** False when the value is collected/displayed only and no encoded rule reads it. */
  affectsEligibility: boolean;
  note?: string;
};

const YES_NO: BooleanOption[] = [
  { value: true, label: "是" },
  { value: false, label: "否" },
];

export const FIELD_SPECS: Record<CaseField, FieldSpec> = {
  city: { field: "city", label: "租屋所在縣市", kind: "city", affectsEligibility: true },
  registeredCity: { field: "registeredCity", label: "申請人戶籍縣市", kind: "city", affectsEligibility: true },
  age: { field: "age", label: "申請人年齡", kind: "integer", min: 0, max: 130, unit: "歲", placeholder: "例如 28", affectsEligibility: true },
  monthlyIncome: {
    field: "monthlyIncome",
    label: "家庭平均月所得",
    kind: "number",
    min: 0,
    unit: "元",
    placeholder: "例如 42000",
    affectsEligibility: true,
  },
  monthlyRent: {
    field: "monthlyRent",
    label: "每月租金",
    kind: "number",
    min: 0,
    unit: "元",
    placeholder: "例如 13500",
    affectsEligibility: false,
    note: "僅供顯示與比較，目前規則不以租金判定資格",
  },
  ownsHome: {
    field: "ownsHome",
    label: "本人是否持有住宅",
    kind: "boolean",
    booleanOptions: [
      { value: false, label: "沒有自有住宅" },
      { value: true, label: "有自有住宅" },
    ],
    affectsEligibility: true,
  },
  receivesOtherHousingAid: {
    field: "receivesOtherHousingAid",
    label: "是否領有其他政府住宅補貼",
    kind: "boolean",
    booleanOptions: [
      { value: false, label: "否，未領有" },
      { value: true, label: "是，目前領有" },
    ],
    affectsEligibility: true,
  },
  centralRentApproved: {
    field: "centralRentApproved",
    label: "中央擴大租金補貼是否已核准",
    kind: "boolean",
    booleanOptions: [
      { value: true, label: "是，已核准" },
      { value: false, label: "否，尚未核准" },
    ],
    affectsEligibility: true,
  },
  newTaipeiResidenceStudyWork: {
    field: "newTaipeiResidenceStudyWork",
    label: "是否在新北市設籍、就學或就業",
    kind: "boolean",
    booleanOptions: [
      { value: true, label: "是，符合" },
      { value: false, label: "否，不符合" },
    ],
    affectsEligibility: true,
  },
  childAgeMonths: {
    field: "childAgeMonths",
    label: "兒童月齡",
    kind: "integer",
    min: 0,
    max: 240,
    unit: "個月",
    placeholder: "例如 18",
    affectsEligibility: true,
  },
  birthOrder: {
    field: "birthOrder",
    label: "兒童胎次（第幾名子女）",
    kind: "integer",
    min: 1,
    max: 20,
    unit: "胎",
    placeholder: "例如 2",
    affectsEligibility: true,
  },
  childHasBirthOrInitialHouseholdRegistration: {
    field: "childHasBirthOrInitialHouseholdRegistration",
    label: "是否已完成出生登記或初設戶籍登記",
    kind: "boolean",
    booleanOptions: [
      { value: true, label: "已完成登記" },
      { value: false, label: "尚未完成登記" },
    ],
    affectsEligibility: true,
  },
  receivesPublicOrQuasiPublicChildcare: {
    field: "receivesPublicOrQuasiPublicChildcare",
    label: "是否送托公托或準公共托育",
    kind: "boolean",
    booleanOptions: [
      { value: false, label: "未送托公托／準公共托育（自行照顧或一般托育）" },
      { value: true, label: "正在接受公托或準公共托育服務" },
    ],
    affectsEligibility: true,
  },
  isGovernmentPlaced: {
    field: "isGovernmentPlaced",
    label: "是否經政府公費安置收容",
    kind: "boolean",
    booleanOptions: [
      { value: false, label: "否，未經公費安置" },
      { value: true, label: "是，經公費安置收容" },
    ],
    affectsEligibility: true,
  },
  childRegisteredCity: {
    field: "childRegisteredCity",
    label: "兒童戶籍縣市",
    kind: "city",
    affectsEligibility: false,
    note: "用於申辦導航（受理機關），不影響資格判定",
  },
};

export const HOUSING_CASE_FIELDS: readonly HousingCaseField[] = [
  "city",
  "registeredCity",
  "age",
  "monthlyIncome",
  "monthlyRent",
  "ownsHome",
  "receivesOtherHousingAid",
  "centralRentApproved",
  "newTaipeiResidenceStudyWork",
];

export const CHILDCARE_CASE_FIELDS: readonly ChildcareCaseField[] = [
  "childAgeMonths",
  "birthOrder",
  "childHasBirthOrInitialHouseholdRegistration",
  "receivesPublicOrQuasiPublicChildcare",
  "isGovernmentPlaced",
  "childRegisteredCity",
];

export function fieldsForDomain(domain: BenefitDomain): readonly CaseField[] {
  return domain === "CHILDCARE" ? CHILDCARE_CASE_FIELDS : HOUSING_CASE_FIELDS;
}

export const SELECTABLE_CITIES: readonly string[] = TAIWAN_CITIES;

// ---------------------------------------------------------------------------
// Presets (the three one-click demo personas)
// ---------------------------------------------------------------------------

export const DUAL_CITY_ACTUAL_SCENARIO: AddressScenario = {
  type: "ACTUAL",
  address: "新北市永和區合成測試地址",
  city: "新北市",
  district: "永和區",
  monthlyRent: 13500,
};

export const WENSHAN_WHAT_IF_SCENARIO: AddressScenario = {
  type: "WHAT_IF",
  address: "臺北市文山區合成測試地址",
  city: "臺北市",
  district: "文山區",
  monthlyRent: 15500,
};

export const TAOYUAN_ACTUAL_SCENARIO: AddressScenario = {
  type: "ACTUAL",
  address: "桃園市桃園區中正路合成測試地址",
  city: "桃園市",
  district: "桃園區",
  monthlyRent: 12000,
};

export const PRESET_HOUSING_APPLICANT: ApplicantProfile = {
  age: 20,
  maritalStatus: "single",
  childrenCount: 0,
  registeredCity: "臺北市",
  ownsHome: null,
  receivesOtherHousingAid: false,
  monthlyIncome: null,
  centralRentApproved: null,
  newTaipeiResidenceStudyWork: null,
};

export const PRESET_TAOYUAN_APPLICANT: ApplicantProfile = {
  ...PRESET_HOUSING_APPLICANT,
  registeredCity: "桃園市",
  monthlyIncome: 38000,
  ownsHome: null,
};

export const PRESET_CHILDCARE_APPLICANT: ApplicantProfile = {
  maritalStatus: "married",
  childrenCount: 1,
  childAgeMonths: 10,
  childHasBirthOrInitialHouseholdRegistration: true,
  isGovernmentPlaced: false,
  receivesPublicOrQuasiPublicChildcare: null,
  birthOrder: 1,
  childRegisteredCity: "臺北市",
};

export type CasePreset = {
  id: string;
  label: string;
  goal: string;
  domain: BenefitDomain;
  applicant: ApplicantProfile;
  actualScenario: AddressScenario;
  whatIfScenario: AddressScenario;
};

export const DEFAULT_GOAL =
  "我目前住在新北市永和區，每月租金 13,500 元。如果搬到臺北市文山區、租金 15,500 元，我有哪些租屋補助可以考慮？還缺什麼資料？";

export const CASE_PRESETS: readonly CasePreset[] = [
  {
    id: "housing-dual-city",
    label: "租屋補助（雙北搬遷比較）",
    goal: DEFAULT_GOAL,
    domain: "HOUSING",
    applicant: PRESET_HOUSING_APPLICANT,
    actualScenario: DUAL_CITY_ACTUAL_SCENARIO,
    whatIfScenario: WENSHAN_WHAT_IF_SCENARIO,
  },
  {
    id: "housing-taoyuan",
    label: "租屋補助（桃園市申辦導航）",
    goal: "我目前租屋在桃園市桃園區，每月租金 12,000 元，想查詢可申請的租屋補助與桃園市政府住宅發展處申辦方式。",
    domain: "HOUSING",
    applicant: PRESET_TAOYUAN_APPLICANT,
    actualScenario: TAOYUAN_ACTUAL_SCENARIO,
    whatIfScenario: WENSHAN_WHAT_IF_SCENARIO,
  },
  {
    id: "childcare-under2",
    label: "育兒津貼（未滿2歲育兒津貼）",
    goal: "我家寶寶目前 10 個月大，是家中第 1 胎，已完成出生戶籍登記，想確認未滿2歲育兒津貼資格、每月金額與線上申辦方式。",
    domain: "CHILDCARE",
    applicant: PRESET_CHILDCARE_APPLICANT,
    // Childcare never evaluates rental addresses; neutral placeholder only.
    actualScenario: { type: "ACTUAL", address: "", city: "臺北市", monthlyRent: 0 },
    whatIfScenario: { type: "WHAT_IF", address: "", city: "臺北市", monthlyRent: 0 },
  },
];

export function findPresetByGoal(goal: string): CasePreset | undefined {
  const trimmed = goal.trim();
  return CASE_PRESETS.find((preset) => preset.goal === trimmed);
}

// ---------------------------------------------------------------------------
// Conservative natural-language extraction
// ---------------------------------------------------------------------------

export type ExtractedFacts = Partial<Record<CaseField, CaseFieldValue>> & {
  whatIfCity?: string;
  whatIfMonthlyRent?: number;
  dualCityComparison?: boolean;
};

const CITY_TOKENS: string[] = (() => {
  const tokens = new Set<string>();
  for (const city of TAIWAN_CITIES) {
    tokens.add(city);
    tokens.add(city.slice(0, -1));
    if (city.startsWith("臺")) {
      tokens.add("台" + city.slice(1));
      tokens.add("台" + city.slice(1, -1));
    }
  }
  return [...tokens].sort((left, right) => right.length - left.length);
})();

const CITY_PATTERN = `(${CITY_TOKENS.join("|")})`;

/** Maps a matched token to a canonical city; returns undefined when ambiguous (e.g. 新竹 / 嘉義). */
export function toCanonicalCity(token: string): string | undefined {
  const normalized = normalizeCityName(token);
  if (!normalized) return undefined;
  if ((TAIWAN_CITIES as readonly string[]).includes(normalized)) return normalized;
  const candidates = TAIWAN_CITIES.filter((city) => city.slice(0, -1) === normalized);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function parseAmount(digits: string, wan?: string): number | undefined {
  const value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(wan ? value * 10000 : value);
}

const CHINESE_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseOrdinal(token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token);
  return CHINESE_DIGITS[token];
}

const RENT_PATTERN = /(?:月租|租金|房租)[^\d。，,；;]{0,6}(\d[\d,]*)\s*(萬)?/;

function extractHousingFacts(text: string, facts: ExtractedFacts): void {
  // Residence city (actual scenario). "搬到X" is a what-if, never the residence.
  const residence =
    new RegExp(`(?:住在|居住在|居住於|租屋在|租屋於|租在|住)\\s*${CITY_PATTERN}`).exec(text) ??
    new RegExp(`在\\s*${CITY_PATTERN}[^，。,；;]{0,8}租`).exec(text);
  if (residence) {
    const city = toCanonicalCity(residence[1]);
    if (city) facts.city = city;
  }

  const registered = new RegExp(`(?:戶籍(?:地)?(?:設)?(?:在|於|為|是)?|設籍(?:在|於)?)\\s*${CITY_PATTERN}`).exec(text);
  if (registered) {
    const city = toCanonicalCity(registered[1]);
    if (city) facts.registeredCity = city;
  }

  const move = new RegExp(`(?:搬到|搬去|搬至|搬往)\\s*${CITY_PATTERN}`).exec(text);
  const beforeMove = move ? text.slice(0, move.index) : text;
  if (move) {
    const city = toCanonicalCity(move[1]);
    if (city) {
      facts.whatIfCity = city;
      const afterMove = text.slice(move.index).split(/[。？?！!]/)[0];
      const whatIfRent = RENT_PATTERN.exec(afterMove);
      if (whatIfRent) {
        const amount = parseAmount(whatIfRent[1], whatIfRent[2]);
        if (amount !== undefined) facts.whatIfMonthlyRent = amount;
      }
    }
  }

  const rent = RENT_PATTERN.exec(beforeMove);
  if (rent) {
    const amount = parseAmount(rent[1], rent[2]);
    if (amount !== undefined) facts.monthlyRent = amount;
  }

  if (/雙北/.test(text)) {
    const hasDistinctCities = Boolean(facts.city && facts.whatIfCity && facts.city !== facts.whatIfCity);
    if (!hasDistinctCities) {
      facts.city = "臺北市";
      facts.whatIfCity = "新北市";
      facts.dualCityComparison = true;
    }
  }

  // Age: "28 歲", but not thresholds such as "未滿 2 歲" / "65 歲以上".
  for (const match of text.matchAll(/(\d{1,3})\s*歲/g)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 2), match.index ?? 0);
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 3);
    if (/滿|過|於/.test(before) || /^\s*(以上|以下|至|到|~|-|－|個月)/.test(after)) continue;
    const age = Number(match[1]);
    if (Number.isInteger(age) && age >= 0 && age <= 130) {
      facts.age = age;
      break;
    }
  }

  const income = /(?<!年)(?:月薪|月收入|月所得|每月收入|每月所得|月入|薪水)[^\d。，,；;]{0,6}(\d[\d,]*(?:\.\d+)?)\s*(萬)?/.exec(text);
  if (income) {
    const amount = parseAmount(income[1], income[2]);
    if (amount !== undefined) facts.monthlyIncome = amount;
  }

  // Home ownership: only explicit statements. Negation is checked first.
  if (/(?:沒有|沒|無|未持有|名下無|並無)(?:自有)?(?:房子|房屋|住宅|自宅|房產)(?!補)/.test(text)) {
    facts.ownsHome = false;
  } else if (/(?<![所領享具沒])(?:有|持有|擁有|名下有)(?:自有)?(?:房子|房屋|住宅|自宅|房產)(?!補)/.test(text)) {
    facts.ownsHome = true;
  }

  // Other housing aid: only explicit "receiving" statements (領/領取/請領).
  if (/(?:沒有|沒|未|無)(?:在)?(?:領|領取|請領)(?:其他)?(?:政府)?(?:住宅|租金|租屋)補(?:貼|助)/.test(text)) {
    facts.receivesOtherHousingAid = false;
  } else if (/(?<![沒未無])(?:有|正在|目前|已)(?:在)?(?:領|領取|請領)(?:其他)?(?:政府)?(?:住宅|租金|租屋)補(?:貼|助)/.test(text)) {
    facts.receivesOtherHousingAid = true;
  }
}

function extractChildcareFacts(text: string, facts: ExtractedFacts): void {
  const yearsMonths = /(\d{1,2})\s*歲\s*(?:又)?\s*(\d{1,2})\s*個月/.exec(text);
  if (yearsMonths) {
    facts.childAgeMonths = Number(yearsMonths[1]) * 12 + Number(yearsMonths[2]);
  } else {
    const months = /(\d{1,3})\s*個月/.exec(text);
    if (months) facts.childAgeMonths = Number(months[1]);
  }
  // A bare "1 歲" is ambiguous (12–23 months) and is intentionally not converted.

  const order = /第\s*([1-9]\d?|[一二兩三四五六七八九十])\s*(?:胎|個孩子|個小孩|個寶寶|名子女|名小孩|個子女)/.exec(text);
  if (order) {
    const value = parseOrdinal(order[1]);
    if (value !== undefined && value >= 1) facts.birthOrder = value;
  } else if (/頭胎/.test(text)) {
    facts.birthOrder = 1;
  }

  const registrationTerms = "(?:出生登記|出生戶籍登記|初設戶籍登記|初設戶籍|報戶口)";
  if (new RegExp(`(?:尚未|還沒|還未|沒有|未)(?:完成|辦理|辦好|辦)?${registrationTerms}`).test(text)) {
    facts.childHasBirthOrInitialHouseholdRegistration = false;
  } else if (new RegExp(`(?:已經|已|有)(?:完成|辦理|辦好|辦)?${registrationTerms}`).test(text)) {
    facts.childHasBirthOrInitialHouseholdRegistration = true;
  }

  const careTerms = "(?:公托|公共托育|公共化托育|準公共|公共化)";
  if (new RegExp(`(?:沒有|沒|未|並未|不是|無|非)(?:在)?(?:送托|送去|送|使用|接受|讀|念)?\\s*${careTerms}`).test(text)) {
    facts.receivesPublicOrQuasiPublicChildcare = false;
  } else if (new RegExp(`(?:有送托|有送|送托|送去|送|正在接受|接受|使用|讀|念)\\s*${careTerms}`).test(text)) {
    facts.receivesPublicOrQuasiPublicChildcare = true;
  }

  if (/(?:沒有|未|並未|非|無)(?:經)?(?:政府)?(?:公費)?安置/.test(text)) {
    facts.isGovernmentPlaced = false;
  } else if (/(?:經政府(?:公費)?安置|公費安置|安置(?:機構|收容)中)/.test(text)) {
    facts.isGovernmentPlaced = true;
  }

  const registered = new RegExp(`(?:戶籍(?:地)?(?:設)?(?:在|於|為|是)?|設籍(?:在|於)?)\\s*${CITY_PATTERN}`).exec(text);
  if (registered) {
    const city = toCanonicalCity(registered[1]);
    if (city) facts.childRegisteredCity = city;
  }
}

/**
 * Extracts only clearly stated facts from the user's goal. Never guesses.
 * Only fields that belong to the given domain are returned.
 */
export function extractFactsFromGoal(goal: string, domain: BenefitDomain): ExtractedFacts {
  const facts: ExtractedFacts = {};
  const text = goal.normalize("NFKC");
  if (domain === "CHILDCARE") {
    extractChildcareFacts(text, facts);
  } else {
    extractHousingFacts(text, facts);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Validation of user-entered structured values
// ---------------------------------------------------------------------------

export type CaseFieldValidation = { valid: boolean; value?: CaseFieldValue; error?: string };

const FIELD_ERROR_MESSAGES: Record<CaseField, string> = {
  city: "請從清單選擇臺灣的縣市。",
  registeredCity: "請從清單選擇臺灣的縣市。",
  age: "年齡須為 0 到 130 之間的整數。",
  monthlyIncome: "月所得須為 0 以上的數字（例如 42000）。",
  monthlyRent: "月租須為 0 以上的數字（例如 13500）。",
  ownsHome: "請選擇「有」或「沒有」。",
  receivesOtherHousingAid: "請選擇「是」或「否」。",
  centralRentApproved: "請選擇「是」或「否」。",
  newTaipeiResidenceStudyWork: "請選擇「是」或「否」。",
  childAgeMonths: "兒童月齡須為 0 到 240 之間的整數（單位：個月）。",
  birthOrder: "胎次須為 1 到 20 之間的整數。",
  childHasBirthOrInitialHouseholdRegistration: "請選擇「已完成」或「尚未完成」。",
  receivesPublicOrQuasiPublicChildcare: "請選擇是否送托公托或準公共托育。",
  isGovernmentPlaced: "請選擇「是」或「否」。",
  childRegisteredCity: "請從清單選擇臺灣的縣市。",
};

export function fieldErrorMessage(field: CaseField): string {
  return FIELD_ERROR_MESSAGES[field];
}

function isAgentField(field: CaseField): field is CaseField & SupportedMissingField {
  return field !== "monthlyRent";
}

/**
 * Validates a single structured value. An empty string means "explicitly left blank"
 * and is valid (the field becomes missing and the Human Gate will ask if required).
 */
export function validateCaseFieldInput(field: CaseField, raw: string | boolean | number): CaseFieldValidation {
  if (typeof raw === "string" && raw.trim() === "") {
    return { valid: true, value: undefined };
  }
  const spec = FIELD_SPECS[field];
  let candidate: unknown = raw;
  if (spec.kind === "boolean" && typeof raw === "string") {
    candidate = raw === "true" ? true : raw === "false" ? false : raw;
    if (typeof candidate !== "boolean") {
      return { valid: false, error: fieldErrorMessage(field) };
    }
  }

  if (isAgentField(field)) {
    const outcome = validateMissingFieldInput(field, candidate);
    return outcome.valid
      ? { valid: true, value: outcome.value }
      : { valid: false, error: fieldErrorMessage(field) };
  }

  // monthlyRent (collected for display/comparison only, not in SupportedMissingField)
  const text = typeof raw === "number" ? String(raw) : String(raw).trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) {
    return { valid: false, error: fieldErrorMessage(field) };
  }
  return { valid: true, value: Math.round(Number(text.replace(/,/g, ""))) };
}

/** Serialises a value for a form control ("" = not provided). */
export function toInputString(value: CaseFieldValue | null | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

// ---------------------------------------------------------------------------
// Draft building (UI state -> Agent input)
// ---------------------------------------------------------------------------

export type FieldSource = "preset" | "extracted" | "edited" | "missing";
export type CaseEditField = CaseField | "whatIfCity";
export type CaseEdits = Partial<Record<CaseField, string>> & { whatIfCity?: string };
export type CaseEditsByDomain = Record<BenefitDomain, CaseEdits>;

export const EMPTY_CASE_EDITS: CaseEditsByDomain = { HOUSING: {}, CHILDCARE: {} };

export type CaseDraft = {
  goal: string;
  domain: BenefitDomain;
  preset: CasePreset | null;
  fields: readonly CaseField[];
  values: Partial<Record<CaseField, CaseFieldValue>>;
  sources: Partial<Record<CaseField, FieldSource>>;
  errors: Partial<Record<CaseEditField, string>>;
  applicant: ApplicantProfile;
  actualScenario: AddressScenario;
  whatIfScenario: AddressScenario;
  /** True when no relocation was stated; the what-if column then mirrors the actual address. */
  whatIfMirrorsActual: boolean;
  requiredFields?: SupportedMissingField[];
  valid: boolean;
};

function presetValue(preset: CasePreset, field: CaseField): CaseFieldValue | undefined {
  if (field === "city") return preset.actualScenario.city || undefined;
  if (field === "monthlyRent") return preset.actualScenario.monthlyRent > 0 ? preset.actualScenario.monthlyRent : undefined;
  const value = preset.applicant[field as keyof ApplicantProfile];
  return value === null || value === undefined ? undefined : (value as CaseFieldValue);
}

function shortCity(city: string): string {
  return city.replace(/[市縣]$/, "");
}

function buildHousingCase(
  goal: string,
  preset: CasePreset | null,
  values: Partial<Record<CaseField, CaseFieldValue>>,
  extracted: ExtractedFacts,
  whatIfCityOverride?: string
): Pick<CaseDraft, "applicant" | "actualScenario" | "whatIfScenario" | "whatIfMirrorsActual" | "requiredFields"> {
  const applicant: ApplicantProfile = {};
  if (preset) {
    // Non-editable demographic context of the synthetic persona (display only).
    if (preset.applicant.maritalStatus) applicant.maritalStatus = preset.applicant.maritalStatus;
    if (preset.applicant.childrenCount !== undefined) applicant.childrenCount = preset.applicant.childrenCount;
  }
  applicant.age = typeof values.age === "number" ? values.age : undefined;
  applicant.registeredCity = typeof values.registeredCity === "string" ? values.registeredCity : undefined;
  applicant.monthlyIncome = typeof values.monthlyIncome === "number" ? values.monthlyIncome : null;
  applicant.ownsHome = typeof values.ownsHome === "boolean" ? values.ownsHome : null;
  applicant.receivesOtherHousingAid =
    typeof values.receivesOtherHousingAid === "boolean" ? values.receivesOtherHousingAid : null;
  applicant.centralRentApproved = typeof values.centralRentApproved === "boolean" ? values.centralRentApproved : null;
  applicant.newTaipeiResidenceStudyWork =
    typeof values.newTaipeiResidenceStudyWork === "boolean" ? values.newTaipeiResidenceStudyWork : null;

  const city = typeof values.city === "string" ? values.city : undefined;
  const monthlyRent = typeof values.monthlyRent === "number" ? values.monthlyRent : 0;

  let actualScenario: AddressScenario;
  if (preset && preset.actualScenario.city === city) {
    actualScenario = { ...preset.actualScenario, monthlyRent };
  } else {
    actualScenario = {
      type: "ACTUAL",
      address: city ? `${city}（自訂案例，未提供詳細地址）` : "",
      city,
      monthlyRent,
    };
  }

  let whatIfScenario: AddressScenario;
  let whatIfMirrorsActual = false;
  if (whatIfCityOverride) {
    whatIfScenario = {
      type: "WHAT_IF",
      address: `${whatIfCityOverride}（搬遷假設，未提供詳細地址）`,
      city: whatIfCityOverride,
      monthlyRent: extracted.dualCityComparison
        ? monthlyRent
        : preset?.whatIfScenario.monthlyRent ?? (extracted.whatIfCity ? extracted.whatIfMonthlyRent ?? 0 : monthlyRent),
    };
  } else if (preset) {
    whatIfScenario = { ...preset.whatIfScenario };
  } else if (extracted.whatIfCity) {
    whatIfScenario = {
      type: "WHAT_IF",
      address: `${extracted.whatIfCity}（搬遷假設，未提供詳細地址）`,
      city: extracted.whatIfCity,
      monthlyRent: extracted.dualCityComparison ? monthlyRent : extracted.whatIfMonthlyRent ?? 0,
    };
  } else {
    whatIfScenario = { ...actualScenario, type: "WHAT_IF" };
    whatIfMirrorsActual = true;
  }

  // Data-collection requirement only (no new eligibility logic): the encoded Taoyuan
  // rule TAOYUAN-115-INCOME-001 reads monthlyIncome, so ask for it instead of skipping.
  const requiredFields: SupportedMissingField[] = ["ownsHome", "receivesOtherHousingAid"];
  if (city === "桃園市") requiredFields.push("monthlyIncome");

  void goal;
  return { applicant, actualScenario, whatIfScenario, whatIfMirrorsActual, requiredFields };
}

function buildChildcareCase(
  preset: CasePreset | null,
  values: Partial<Record<CaseField, CaseFieldValue>>
): Pick<CaseDraft, "applicant" | "actualScenario" | "whatIfScenario" | "whatIfMirrorsActual" | "requiredFields"> {
  const applicant: ApplicantProfile = {};
  if (preset) {
    if (preset.applicant.maritalStatus) applicant.maritalStatus = preset.applicant.maritalStatus;
    if (preset.applicant.childrenCount !== undefined) applicant.childrenCount = preset.applicant.childrenCount;
  }
  applicant.childAgeMonths = typeof values.childAgeMonths === "number" ? values.childAgeMonths : null;
  applicant.birthOrder = typeof values.birthOrder === "number" ? values.birthOrder : null;
  applicant.childHasBirthOrInitialHouseholdRegistration =
    typeof values.childHasBirthOrInitialHouseholdRegistration === "boolean"
      ? values.childHasBirthOrInitialHouseholdRegistration
      : null;
  applicant.receivesPublicOrQuasiPublicChildcare =
    typeof values.receivesPublicOrQuasiPublicChildcare === "boolean"
      ? values.receivesPublicOrQuasiPublicChildcare
      : null;
  applicant.isGovernmentPlaced = typeof values.isGovernmentPlaced === "boolean" ? values.isGovernmentPlaced : null;
  if (typeof values.childRegisteredCity === "string") {
    applicant.childRegisteredCity = values.childRegisteredCity;
  }

  // Childcare never evaluates rental addresses: neutral placeholder, no housing facts.
  const city = applicant.childRegisteredCity;
  return {
    applicant,
    actualScenario: { type: "ACTUAL", address: "", city, monthlyRent: 0 },
    whatIfScenario: { type: "WHAT_IF", address: "", city, monthlyRent: 0 },
    whatIfMirrorsActual: true,
    requiredFields: undefined,
  };
}

/**
 * Builds the exact case the Agent will evaluate.
 * Precedence per field: user edit > extracted from goal > preset > missing.
 * Extraction is skipped for an unmodified preset goal (the preset is authoritative).
 */
export function buildCaseDraft(goal: string, editsByDomain: CaseEditsByDomain = EMPTY_CASE_EDITS): CaseDraft {
  const trimmed = goal.trim();
  const preset = findPresetByGoal(trimmed) ?? null;
  const domain: BenefitDomain = preset?.domain ?? detectBenefitDomain(trimmed);
  const fields = fieldsForDomain(domain);
  const extracted = preset ? {} : extractFactsFromGoal(trimmed, domain);
  const edits = editsByDomain[domain] ?? {};

  const values: Partial<Record<CaseField, CaseFieldValue>> = {};
  const sources: Partial<Record<CaseField, FieldSource>> = {};
  const errors: Partial<Record<CaseEditField, string>> = {};

  for (const field of fields) {
    const raw = edits[field];
    if (raw !== undefined) {
      const validation = validateCaseFieldInput(field, raw);
      if (!validation.valid) {
        errors[field] = validation.error;
        sources[field] = "edited";
        continue;
      }
      if (validation.value === undefined) {
        sources[field] = "missing";
        continue;
      }
      values[field] = validation.value;
      sources[field] = "edited";
      continue;
    }
    const fromGoal = extracted[field];
    if (fromGoal !== undefined) {
      values[field] = fromGoal;
      sources[field] = "extracted";
      continue;
    }
    const fromPreset = preset ? presetValue(preset, field) : undefined;
    if (fromPreset !== undefined) {
      values[field] = fromPreset;
      sources[field] = "preset";
      continue;
    }
    sources[field] = "missing";
  }

  const rawWhatIfCity = edits.whatIfCity;
  const whatIfCityValidation = rawWhatIfCity === undefined
    ? undefined
    : validateCaseFieldInput("city", rawWhatIfCity);
  if (whatIfCityValidation && !whatIfCityValidation.valid) {
    errors.whatIfCity = whatIfCityValidation.error ?? fieldErrorMessage("city");
  }
  const whatIfCityOverride = typeof whatIfCityValidation?.value === "string"
    ? whatIfCityValidation.value
    : undefined;

  const built = domain === "CHILDCARE"
    ? buildChildcareCase(preset, values)
    : buildHousingCase(trimmed, preset, values, extracted, whatIfCityOverride);

  return {
    goal: trimmed,
    domain,
    preset,
    fields,
    values,
    sources,
    errors,
    ...built,
    valid: Object.keys(errors).length === 0,
  };
}

// ---------------------------------------------------------------------------
// Persona chips (rendered from the evaluated profile)
// ---------------------------------------------------------------------------

export type PersonaChip = { key: string; label: string; pending?: boolean };

export function buildPersonaChips(
  domain: BenefitDomain,
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario
): PersonaChip[] {
  if (domain === "CHILDCARE") {
    const chips: PersonaChip[] = [];
    chips.push(typeof applicant.childAgeMonths === "number"
      ? { key: "childAgeMonths", label: `兒童 ${applicant.childAgeMonths} 個月` }
      : { key: "childAgeMonths", label: "兒童月齡：待確認", pending: true });
    chips.push(typeof applicant.birthOrder === "number"
      ? { key: "birthOrder", label: `第 ${applicant.birthOrder} 胎` }
      : { key: "birthOrder", label: "胎次：待確認", pending: true });
    const reg = applicant.childHasBirthOrInitialHouseholdRegistration;
    chips.push({ key: "registration", label: `出生登記：${reg === true ? "已完成" : reg === false ? "未完成" : "待確認"}`, pending: reg == null });
    const care = applicant.receivesPublicOrQuasiPublicChildcare;
    chips.push({ key: "care", label: `公托／準公共：${care === true ? "送托中" : care === false ? "未送托" : "待確認"}`, pending: care == null });
    const placed = applicant.isGovernmentPlaced;
    chips.push({ key: "placed", label: `公費安置：${placed === true ? "是" : placed === false ? "否" : "待確認"}`, pending: placed == null });
    if (applicant.childRegisteredCity) {
      chips.push({ key: "childRegisteredCity", label: `兒童戶籍：${applicant.childRegisteredCity}` });
    }
    return chips;
  }

  const chips: PersonaChip[] = [];
  chips.push(typeof applicant.age === "number"
    ? { key: "age", label: `${applicant.age} 歲` }
    : { key: "age", label: "年齡：待確認", pending: true });
  if (applicant.maritalStatus) {
    chips.push({ key: "marital", label: applicant.maritalStatus === "single" ? "單身" : "已婚" });
  }
  chips.push(applicant.registeredCity
    ? { key: "registeredCity", label: `${shortCity(applicant.registeredCity)}戶籍` }
    : { key: "registeredCity", label: "戶籍：未填", pending: true });
  const place = actualScenario?.city
    ? `${shortCity(actualScenario.city)}${(actualScenario.district ?? "").replace(/區$/, "")}`
    : "";
  chips.push(place
    ? { key: "city", label: `目前租屋：${place}` }
    : { key: "city", label: "租屋縣市：待確認", pending: true });
  if (actualScenario && actualScenario.monthlyRent > 0) {
    chips.push({ key: "rent", label: `月租：${actualScenario.monthlyRent.toLocaleString()}` });
  }
  if (typeof applicant.monthlyIncome === "number") {
    chips.push({ key: "income", label: `月所得：${applicant.monthlyIncome.toLocaleString()}` });
  }
  chips.push({
    key: "ownsHome",
    label: `自有住宅：${applicant.ownsHome === true ? "有" : applicant.ownsHome === false ? "沒有" : "待確認"}`,
    pending: applicant.ownsHome == null,
  });
  return chips;
}

// ---------------------------------------------------------------------------
// Agent entry points used by the UI
// ---------------------------------------------------------------------------

/** Starts the bounded Agent with exactly the draft's structured profile. */
export function startCaseRun(draft: CaseDraft, plannerResult?: ProviderPlannerResult): AgentRun {
  return runAgenticGoldenCase(
    draft.goal,
    { ...draft.applicant },
    { ...draft.actualScenario },
    { ...draft.whatIfScenario },
    plannerResult,
    {
      includePassport: true,
      ...(draft.requiredFields ? { requiredFields: [...draft.requiredFields] } : {}),
    }
  );
}

/** Returns the control spec for a Human Gate field, or null when genuinely unsupported. */
export function getGateControl(field: string | undefined): FieldSpec | null {
  if (!field) return null;
  return (FIELD_SPECS as Record<string, FieldSpec | undefined>)[field] ?? null;
}

export type GateSubmission = {
  ok: boolean;
  run: AgentRun;
  error?: string;
};

/**
 * Submits a Human Gate answer. The orchestrator re-validates every value; invalid
 * input keeps the run in WAITING_FOR_HUMAN (and is recorded in the trace) and a
 * readable error is returned for the UI.
 */
export function submitHumanGateAnswer(
  run: AgentRun,
  rawValue: string | number | boolean,
  options?: { whatIfMirrorsActual?: boolean; includePassport?: boolean }
): GateSubmission {
  const field = run.missingField;
  if (run.status !== "WAITING_FOR_HUMAN" || !field) {
    return { ok: false, run, error: "目前沒有等待回答的問題。" };
  }
  const control = getGateControl(field);
  if (!control) {
    return { ok: false, run, error: "此欄位目前不支援線上回答。" };
  }

  const candidate = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  const local = validateMissingFieldInput(field, candidate);

  let whatIfOverride: AddressScenario | undefined;
  if (local.valid && field === "city" && options?.whatIfMirrorsActual && run.state?.whatIfScenario) {
    const city = String(local.value);
    whatIfOverride = {
      ...run.state.whatIfScenario,
      city,
      district: undefined,
      address: `${city}（自訂案例，未提供詳細地址）`,
    };
  }

  const next = resumeAgentWithFieldResponse(run, field, candidate, undefined, whatIfOverride, {
    includePassport: options?.includePassport ?? true,
  });
  if (!local.valid || next.errorCode) {
    return { ok: false, run: next, error: fieldErrorMessage(field as CaseField) };
  }
  return { ok: true, run: next };
}
