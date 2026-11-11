import type { AddressScenario, ApplicantProfile } from "../types";
import { normalizeCityName } from "../coverage";
import type { AgentTraceStateSummary, SupportedMissingField } from "./types";

export const SUPPORTED_MISSING_FIELDS: readonly SupportedMissingField[] = [
  "ownsHome",
  "receivesOtherHousingAid",
  "city",
  "monthlyIncome",
  "age",
  "centralRentApproved",
  "newTaipeiResidenceStudyWork",
  "registeredCity",
] as const;

export const MISSING_FIELD_QUESTIONS: Record<SupportedMissingField, string> = {
  ownsHome: "本人是否持有住宅？",
  receivesOtherHousingAid: "請問您目前是否領有其他政府住宅補貼？",
  city: "請問您的租屋所在地位於哪個縣市？",
  monthlyIncome: "請問您的家庭平均月所得約是多少？",
  age: "請問申請人目前的年齡是幾歲？",
  centralRentApproved: "請問您的中央擴大租金補貼是否已核准？",
  newTaipeiResidenceStudyWork: "請問您是否符合在新北市設籍、就學或就業之條件？",
  registeredCity: "請問您的戶籍設於哪個縣市？",
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
  }
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

export function validateMissingFieldInput(
  field: SupportedMissingField,
  rawValue: unknown
): FieldValidationOutcome {
  switch (field) {
    case "ownsHome":
    case "receivesOtherHousingAid":
    case "centralRentApproved":
    case "newTaipeiResidenceStudyWork": {
      if (typeof rawValue === "boolean") {
        return { valid: true, value: rawValue };
      }
      if (typeof rawValue === "string") {
        const normalized = rawValue.trim().toLowerCase();
        if (["true", "yes", "1", "是", "有", "已核准", "符合"].includes(normalized)) {
          return { valid: true, value: true };
        }
        if (["false", "no", "0", "否", "沒有", "無", "未核准", "不符合"].includes(normalized)) {
          return { valid: true, value: false };
        }
      }
      return { valid: false, error: `INVALID_BOOLEAN_FOR_${field}` };
    }

    case "monthlyIncome": {
      const num = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : NaN;
      if (!Number.isFinite(num) || num < 0) {
        return { valid: false, error: "INVALID_MONTHLY_INCOME" };
      }
      return { valid: true, value: Math.round(num) };
    }

    case "age": {
      const num = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : NaN;
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 130) {
        return { valid: false, error: "INVALID_AGE" };
      }
      return { valid: true, value: num };
    }

    case "city":
    case "registeredCity": {
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        return { valid: false, error: `INVALID_CITY_FOR_${field}` };
      }
      const normalized = normalizeCityName(rawValue);
      if (!normalized) {
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

  if (field === "age" || field === "monthlyIncome") {
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
  const knownFields: string[] = [];
  const allMissing: string[] = [];

  for (const field of SUPPORTED_MISSING_FIELDS) {
    if (isFieldMissing(field, applicant, actualScenario)) {
      if (requiredFields.includes(field) || !SUPPORTED_MISSING_FIELDS.includes(field)) {
        allMissing.push(field);
      } else {
        allMissing.push(field);
      }
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
  return {
    age: applicant.age ?? null,
    registeredCity: applicant.registeredCity ?? null,
    ownsHome: applicant.ownsHome ?? null,
    receivesOtherHousingAid: applicant.receivesOtherHousingAid ?? null,
    monthlyIncomeProvided: applicant.monthlyIncome !== null && applicant.monthlyIncome !== undefined,
    centralRentApproved: applicant.centralRentApproved ?? null,
    newTaipeiResidenceStudyWork: applicant.newTaipeiResidenceStudyWork ?? null,
    actualCity: actualScenario?.city ?? null,
  };
}
