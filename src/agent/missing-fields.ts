import type { AddressScenario, ApplicantProfile } from "../types";
import { isSupportedTaiwanCity, normalizeCityName } from "../coverage";
import type { AgentTraceStateSummary, SupportedMissingField } from "./types";

export const HOUSING_MISSING_FIELDS: readonly SupportedMissingField[] = [
  "ownsHome",
  "receivesOtherHousingAid",
  "city",
  "monthlyIncome",
  "age",
  "centralRentApproved",
  "newTaipeiResidenceStudyWork",
  "registeredCity",
] as const;

export const CHILDCARE_MISSING_FIELDS: readonly SupportedMissingField[] = [
  "childAgeMonths",
  "childHasBirthOrInitialHouseholdRegistration",
  "isGovernmentPlaced",
  "receivesPublicOrQuasiPublicChildcare",
  "birthOrder",
] as const;

export const SUPPORTED_MISSING_FIELDS: readonly SupportedMissingField[] = [
  ...HOUSING_MISSING_FIELDS,
  ...CHILDCARE_MISSING_FIELDS,
  "childRegisteredCity",
] as const;

export const MISSING_FIELD_QUESTIONS: Record<SupportedMissingField, string> = {
  ownsHome: "本人是否持有住宅？",
  receivesOtherHousingAid: "請問您目前是否領有其他政府住宅補貼？",
  city: "請問您的租屋所在地位於哪個縣市？",
  monthlyIncome: "請問您家庭成員平均每人每月所得約是多少？（非全戶合計）",
  age: "請問申請人目前的年齡是幾歲？",
  centralRentApproved: "請問您的中央擴大租金補貼是否已核准？",
  newTaipeiResidenceStudyWork: "請問您是否符合在新北市設籍、就學或就業之條件？",
  registeredCity: "請問您的戶籍設於哪個縣市？",
  childAgeMonths: "請問兒童目前的年齡是幾個月？（未滿2歲育兒津貼適用0至23個月）",
  childHasBirthOrInitialHouseholdRegistration: "請問兒童是否已完成出生登記或初設戶籍登記？",
  receivesPublicOrQuasiPublicChildcare: "請問兒童目前是否正在送托公共化或準公共托育服務（公托、準公共托嬰中心或準公共保母）？",
  isGovernmentPlaced: "請問兒童目前是否經政府公費安置收容？",
  birthOrder: "請問該名兒童為家中的第幾名子女（胎次：1、2 或 3 以上）？",
  childRegisteredCity: "請問兒童戶籍設於哪個縣市？",
};

export function isSupportedMissingField(value: unknown): value is SupportedMissingField {
  return typeof value === "string" && (SUPPORTED_MISSING_FIELDS as readonly string[]).includes(value);
}

export function getQuestionForMissingField(field: SupportedMissingField): string {
  return MISSING_FIELD_QUESTIONS[field];
}

export function isFieldMissing(
  field: SupportedMissingField,
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario
): boolean {
  switch (field) {
    case "city":
      return !actualScenario?.city || !actualScenario.city.trim();
    case "registeredCity":
      return !applicant.registeredCity || !applicant.registeredCity.trim();
    case "age":
      return applicant.age === undefined || applicant.age === null;
    case "monthlyIncome":
      return applicant.monthlyIncome === undefined || applicant.monthlyIncome === null;
    case "ownsHome":
      return applicant.ownsHome === undefined || applicant.ownsHome === null;
    case "receivesOtherHousingAid":
      return applicant.receivesOtherHousingAid === undefined || applicant.receivesOtherHousingAid === null;
    case "centralRentApproved":
      return applicant.centralRentApproved === undefined || applicant.centralRentApproved === null;
    case "newTaipeiResidenceStudyWork":
      return applicant.newTaipeiResidenceStudyWork === undefined || applicant.newTaipeiResidenceStudyWork === null;
    case "childAgeMonths":
      return applicant.childAgeMonths === undefined || applicant.childAgeMonths === null;
    case "childHasBirthOrInitialHouseholdRegistration":
      return (
        applicant.childHasBirthOrInitialHouseholdRegistration === undefined ||
        applicant.childHasBirthOrInitialHouseholdRegistration === null
      );
    case "receivesPublicOrQuasiPublicChildcare":
      return (
        applicant.receivesPublicOrQuasiPublicChildcare === undefined ||
        applicant.receivesPublicOrQuasiPublicChildcare === null
      );
    case "isGovernmentPlaced":
      return applicant.isGovernmentPlaced === undefined || applicant.isGovernmentPlaced === null;
    case "birthOrder":
      return applicant.birthOrder === undefined || applicant.birthOrder === null;
    case "childRegisteredCity":
      return !applicant.childRegisteredCity || !applicant.childRegisteredCity.trim();
  }
}

// ---------------------------------------------------------------------------
// Gate 4C — canonical Human-Gate field state.
// One contract decides whether a field may be asked, used by the planner validator, the
// deterministic selector, the post-tool gate and the resume paths alike.
//   KNOWN    — normalized state holds a value (true, false, a number or a city). Never re-asked.
//   UNKNOWN  — no value; may be asked with the canonical question.
//   CONFLICT — no value because the user's text contradicts itself / is ambiguous; may be asked
//              only with the explicit clarification wording supplied by the input layer.
// ---------------------------------------------------------------------------

export type GateFieldState = "KNOWN" | "UNKNOWN" | "CONFLICT";

export function getFieldState(
  field: SupportedMissingField,
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario,
  clarifications?: Partial<Record<SupportedMissingField, string>>
): GateFieldState {
  if (!isFieldMissing(field, applicant, actualScenario)) return "KNOWN";
  return clarifications?.[field] ? "CONFLICT" : "UNKNOWN";
}

export function isFieldAskable(
  field: SupportedMissingField,
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario
): boolean {
  return getFieldState(field, applicant, actualScenario) !== "KNOWN";
}

/** Planner / tool-argument field aliases (case- and separator-insensitive). */
const FIELD_ALIASES: Record<string, SupportedMissingField> = {
  ownshome: "ownsHome",
  applicantownshome: "ownsHome",
  hasownedhome: "ownsHome",
  ownhome: "ownsHome",
  hashome: "ownsHome",
  homeownership: "ownsHome",
  ownsproperty: "ownsHome",
  hasproperty: "ownsHome",
  ownshouse: "ownsHome",
  receivesotherhousingaid: "receivesOtherHousingAid",
  otherhousingaid: "receivesOtherHousingAid",
  receivesotheraid: "receivesOtherHousingAid",
  otheraid: "receivesOtherHousingAid",
  otherhousingsubsidy: "receivesOtherHousingAid",
  hasotherhousingsubsidy: "receivesOtherHousingAid",
  city: "city",
  rentalcity: "city",
  rentcity: "city",
  currentcity: "city",
  residencecity: "city",
  location: "city",
  monthlyincome: "monthlyIncome",
  income: "monthlyIncome",
  percapitaincome: "monthlyIncome",
  age: "age",
  applicantage: "age",
  centralrentapproved: "centralRentApproved",
  newtaipeiresidencestudywork: "newTaipeiResidenceStudyWork",
  registeredcity: "registeredCity",
  householdregistrationcity: "registeredCity",
  childagemonths: "childAgeMonths",
  childage: "childAgeMonths",
  childhasbirthorinitialhouseholdregistration: "childHasBirthOrInitialHouseholdRegistration",
  childregistration: "childHasBirthOrInitialHouseholdRegistration",
  childhouseholdregistration: "childHasBirthOrInitialHouseholdRegistration",
  isgovernmentplaced: "isGovernmentPlaced",
  governmentplacement: "isGovernmentPlaced",
  receivespublicorquasipublicchildcare: "receivesPublicOrQuasiPublicChildcare",
  publicchildcare: "receivesPublicOrQuasiPublicChildcare",
  quasipublicchildcare: "receivesPublicOrQuasiPublicChildcare",
  birthorder: "birthOrder",
  childregisteredcity: "childRegisteredCity",
};

/** Maps a planner-supplied field name (canonical or alias) to the canonical field, if any. */
export function normalizeFieldName(value: unknown): SupportedMissingField | undefined {
  if (typeof value !== "string") return undefined;
  if (isSupportedMissingField(value)) return value;
  return FIELD_ALIASES[value.replace(/[\s_\-.]/g, "").toLowerCase()];
}

// Free-text question → field. The cloud planner schema carries only `humanQuestion`, so the
// validator must recognise which field a question targets. Order: specific before generic.
const QUESTION_FIELD_PATTERNS: Array<[SupportedMissingField, RegExp]> = [
  ["childHasBirthOrInitialHouseholdRegistration", /出生登記|初設戶籍/],
  ["childRegisteredCity", /(?:兒童|孩子|小孩|寶寶|幼兒)[^？?。]{0,6}戶籍[^？?。]{0,6}(?:縣市|哪)/],
  ["isGovernmentPlaced", /公費安置|安置收容|政府安置/],
  ["receivesPublicOrQuasiPublicChildcare", /公共化|準公共|公托|托嬰中心|送托|托育服務|保母/],
  ["birthOrder", /胎次|第幾(?:名|個|胎)/],
  ["childAgeMonths", /(?:兒童|孩子|小孩|寶寶|幼兒)[^？?。]{0,8}(?:幾個月|月齡|年齡|多大|幾歲)/],
  ["centralRentApproved", /核准|核定|已獲[^？?。]{0,6}中央/],
  ["newTaipeiResidenceStudyWork", /新北[^？?。]{0,8}(?:設籍|就學|就業|居住)/],
  ["receivesOtherHousingAid", /其他[^？?。]{0,8}(?:政府)?(?:住宅|租屋|租金)?(?:補貼|補助)|(?:領|請領|享有)[^？?。]{0,6}(?:住宅|租屋|租金)(?:補貼|補助)/],
  ["ownsHome", /持有住宅|自有(?:住宅|房屋|房產|房子|屋)|名下[^？?。]{0,8}(?:住宅|房屋|房產|房子|不動產)|(?:擁有|有沒有|是否有)[^？?。]{0,4}(?:住宅|房屋|房產|房子)/],
  ["registeredCity", /戶籍(?:[^？?。]{0,8}(?:縣市|哪裡))?/],
  ["monthlyIncome", /所得|收入|月薪|薪資/],
  ["age", /年齡|幾歲|出生年/],
  ["city", /縣市|哪(?:個|一個)?城市|租屋[^？?。]{0,6}(?:在哪|地點|位置|所在)|居住[^？?。]{0,4}(?:地|縣市)/],
];

export function inferFieldsFromQuestion(question: unknown): SupportedMissingField[] {
  if (typeof question !== "string" || !question.trim()) return [];
  const text = question.normalize("NFKC");
  const found: SupportedMissingField[] = [];
  const spans: Array<[number, number]> = [];
  for (const [field, pattern] of QUESTION_FIELD_PATTERNS) {
    const global = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(global)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A generic match inside a more specific earlier match ("戶籍" within "初設戶籍") is not
      // a separate request.
      if (spans.some(([s, e]) => start >= s && end <= e)) continue;
      spans.push([start, end]);
      if (!found.includes(field)) found.push(field);
    }
  }
  return found;
}

export type RequestedFieldResolution = {
  /** Canonical fields the proposal targets (explicit name/alias first, else inferred from text). */
  fields: SupportedMissingField[];
  source: "EXPLICIT" | "ALIAS" | "QUESTION_TEXT" | "NONE";
  /** A field name the proposal supplied that maps to no supported field. */
  unrecognized?: string;
};

/** Resolves which field(s) a planner ASK / request_missing_field proposal actually targets. */
export function resolveRequestedFields(proposal: {
  missingField?: unknown;
  toolArguments?: unknown;
  humanQuestion?: unknown;
}): RequestedFieldResolution {
  const args = (proposal.toolArguments && typeof proposal.toolArguments === "object"
    ? proposal.toolArguments
    : {}) as Record<string, unknown>;
  const named = [proposal.missingField, args.field, args.missingField].filter(
    (value) => typeof value === "string" && value.trim()
  ) as string[];
  for (const name of named) {
    const field = normalizeFieldName(name);
    if (field) return { fields: [field], source: isSupportedMissingField(name) ? "EXPLICIT" : "ALIAS" };
  }
  const questionText = proposal.humanQuestion ?? args.question;
  const inferred = inferFieldsFromQuestion(questionText);
  if (inferred.length) return { fields: inferred, source: "QUESTION_TEXT", ...(named[0] ? { unrecognized: named[0] } : {}) };
  return { fields: [], source: "NONE", ...(named[0] ? { unrecognized: named[0] } : {}) };
}

/**
 * Canonical "which field may the Human Gate ask next": the preferred field when it is still
 * unknown, else the first unknown required field. Returns undefined when nothing is askable —
 * callers must then continue deterministically instead of asking a known field.
 */
export function selectAskableField(
  applicant: ApplicantProfile,
  actualScenario: AddressScenario | undefined,
  requiredFields: SupportedMissingField[],
  preferred?: SupportedMissingField | Array<SupportedMissingField | undefined>
): SupportedMissingField | undefined {
  const preferredList = (Array.isArray(preferred) ? preferred : [preferred]).filter(Boolean) as SupportedMissingField[];
  for (const field of preferredList) {
    if (isFieldAskable(field, applicant, actualScenario)) return field;
  }
  return detectMissingFields(applicant, actualScenario, requiredFields)[0];
}

export function detectMissingFields(
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario,
  requiredFields: SupportedMissingField[] = ["ownsHome", "receivesOtherHousingAid"]
): SupportedMissingField[] {
  const missing: SupportedMissingField[] = [];
  for (const field of requiredFields) {
    if (isFieldMissing(field, applicant, actualScenario) && !missing.includes(field)) {
      missing.push(field);
    }
  }
  return missing;
}

export type FieldValidationOutcome = {
  valid: boolean;
  value?: boolean | number | string;
  error?: string;
};

// Strict numeric parsing for user-entered strings: only plain decimal digits
// (optionally with thousands separators and, when allowed, a decimal part).
// Rejects hex ("0x10"), exponent ("1e3"), signs, whitespace-only and mixed text,
// so nonsense input is never silently coerced into a number.
function parseStrictNumber(rawValue: unknown, allowDecimal: boolean): number {
  if (typeof rawValue === "number") {
    return rawValue;
  }
  if (typeof rawValue !== "string") {
    return NaN;
  }
  const trimmed = rawValue.trim();
  const pattern = allowDecimal
    ? /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
    : /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;
  if (!pattern.test(trimmed)) {
    return NaN;
  }
  return Number(trimmed.replace(/,/g, ""));
}

export function validateMissingFieldInput(
  field: SupportedMissingField,
  rawValue: unknown
): FieldValidationOutcome {
  switch (field) {
    case "ownsHome":
    case "receivesOtherHousingAid":
    case "centralRentApproved":
    case "newTaipeiResidenceStudyWork":
    case "childHasBirthOrInitialHouseholdRegistration":
    case "receivesPublicOrQuasiPublicChildcare":
    case "isGovernmentPlaced": {
      if (typeof rawValue === "boolean") {
        return { valid: true, value: rawValue };
      }
      if (typeof rawValue === "string") {
        const normalized = rawValue.trim().toLowerCase();
        if (["true", "yes", "1", "是", "有", "已核准", "符合", "已完成", "已登記"].includes(normalized)) {
          return { valid: true, value: true };
        }
        if (["false", "no", "0", "否", "沒有", "無", "未核准", "不符合", "未完成", "未送托"].includes(normalized)) {
          return { valid: true, value: false };
        }
      }
      return { valid: false, error: `INVALID_BOOLEAN_FOR_${field}` };
    }

    case "monthlyIncome": {
      const num = parseStrictNumber(rawValue, true);
      if (!Number.isFinite(num) || num < 0) {
        return { valid: false, error: "INVALID_MONTHLY_INCOME" };
      }
      return { valid: true, value: Math.round(num) };
    }

    case "age": {
      const num = parseStrictNumber(rawValue, false);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 130) {
        return { valid: false, error: "INVALID_AGE" };
      }
      return { valid: true, value: num };
    }

    case "childAgeMonths": {
      const num = parseStrictNumber(rawValue, false);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 240) {
        return { valid: false, error: "INVALID_CHILD_AGE_MONTHS" };
      }
      return { valid: true, value: num };
    }

    case "birthOrder": {
      const num = parseStrictNumber(rawValue, false);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 20) {
        return { valid: false, error: "INVALID_BIRTH_ORDER" };
      }
      return { valid: true, value: num };
    }

    case "city":
    case "registeredCity":
    case "childRegisteredCity": {
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        return { valid: false, error: `INVALID_CITY_FOR_${field}` };
      }
      const normalized = normalizeCityName(rawValue);
      if (!normalized || !isSupportedTaiwanCity(normalized)) {
        return { valid: false, error: `INVALID_CITY_FOR_${field}` };
      }
      return { valid: true, value: normalized };
    }
  }
}

export function applyValidatedFieldUpdate(
  applicant: ApplicantProfile,
  actualScenario: AddressScenario,
  field: SupportedMissingField,
  validatedValue: boolean | number | string
): { applicant: ApplicantProfile; actualScenario: AddressScenario } {
  if (field === "city") {
    const cityStr = String(validatedValue);
    return {
      applicant: { ...applicant },
      actualScenario: {
        ...actualScenario,
        city: cityStr,
        address: actualScenario.address || `${cityStr}合成測試地址`,
      },
    };
  }

  if (field === "registeredCity") {
    return {
      applicant: { ...applicant, registeredCity: String(validatedValue) },
      actualScenario: { ...actualScenario },
    };
  }

  if (field === "childRegisteredCity") {
    return {
      applicant: { ...applicant, childRegisteredCity: String(validatedValue) },
      actualScenario: { ...actualScenario },
    };
  }

  if (
    field === "age" ||
    field === "monthlyIncome" ||
    field === "childAgeMonths" ||
    field === "birthOrder"
  ) {
    return {
      applicant: { ...applicant, [field]: Number(validatedValue) },
      actualScenario: { ...actualScenario },
    };
  }

  return {
    applicant: { ...applicant, [field]: Boolean(validatedValue) },
    actualScenario: { ...actualScenario },
  };
}

export function summarizeSafeState(
  status: string,
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario,
  whatIfScenario?: AddressScenario,
  completedTools: string[] = [],
  requiredFields: SupportedMissingField[] = ["ownsHome", "receivesOtherHousingAid"]
): AgentTraceStateSummary {
  const isChildcareContext = requiredFields.some((f) =>
    (CHILDCARE_MISSING_FIELDS as readonly string[]).includes(f)
  );
  const fieldsToInspect = isChildcareContext
    ? CHILDCARE_MISSING_FIELDS
    : HOUSING_MISSING_FIELDS;

  const knownFields: string[] = [];
  const allMissing: string[] = [];

  for (const field of fieldsToInspect) {
    if (isFieldMissing(field, applicant, actualScenario)) {
      allMissing.push(field);
    } else {
      knownFields.push(field);
    }
  }

  return {
    status,
    knownFields,
    missingFields: allMissing,
    actualCity: actualScenario?.city,
    whatIfCity: whatIfScenario?.city,
    completedTools: [...completedTools],
  };
}

export function summarizeSafeSnapshot(
  applicant: ApplicantProfile,
  actualScenario?: AddressScenario
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    age: applicant.age ?? null,
    registeredCity: applicant.registeredCity ?? null,
    ownsHome: applicant.ownsHome ?? null,
    receivesOtherHousingAid: applicant.receivesOtherHousingAid ?? null,
    monthlyIncomeProvided: applicant.monthlyIncome !== null && applicant.monthlyIncome !== undefined,
    centralRentApproved: applicant.centralRentApproved ?? null,
    newTaipeiResidenceStudyWork: applicant.newTaipeiResidenceStudyWork ?? null,
    actualCity: actualScenario?.city ?? null,
  };

  if (
    applicant.childAgeMonths !== undefined ||
    applicant.childHasBirthOrInitialHouseholdRegistration !== undefined ||
    applicant.receivesPublicOrQuasiPublicChildcare !== undefined ||
    applicant.isGovernmentPlaced !== undefined ||
    applicant.birthOrder !== undefined
  ) {
    snapshot.childAgeMonths = applicant.childAgeMonths ?? null;
    snapshot.childHasBirthOrInitialHouseholdRegistration =
      applicant.childHasBirthOrInitialHouseholdRegistration ?? null;
    snapshot.receivesPublicOrQuasiPublicChildcare =
      applicant.receivesPublicOrQuasiPublicChildcare ?? null;
    snapshot.isGovernmentPlaced = applicant.isGovernmentPlaced ?? null;
    snapshot.birthOrder = applicant.birthOrder ?? null;
  }

  return snapshot;
}
