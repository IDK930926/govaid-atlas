// Gate 4B — typed, span-based fact extraction for free-text case goals.
//
// RAW TEXT → clauses (separator-aware, never splits "14,500") → field-local cues
//          → NormalizedFact { state, value, spans, source } → CONFLICT detection.
//
// Contract:
// - A fact is extracted only from an explicit, clause-local statement (or a stated
//   district that maps to exactly one city). Anything hedged ("可能", "不確定",
//   "是否") stays UNKNOWN so the Human Gate asks.
// - `false` is a known value: "沒有自有住宅" is KNOWN_FALSE, never "missing".
// - Contradictory explicit statements become CONFLICT (value withheld) and carry a
//   clarification question that says why it is asked again.
// - Numbers are field-local: a value must follow its own cue inside one clause, is
//   range-checked, and is never concatenated with a neighbouring number.
// - No eligibility logic lives here.

import { TAIWAN_CITIES, normalizeCityName } from "./taiwan-cities";

export type FactState = "KNOWN_TRUE" | "KNOWN_FALSE" | "KNOWN_VALUE" | "UNKNOWN" | "CONFLICT";
export type FactSource = "EXPLICIT" | "IMPLIED" | "DISTRICT_INFERENCE";
export type FactSpan = { start: number; end: number; text: string };
export type FactValue = number | boolean | string;

export type NormalizedFact = {
  field: string;
  state: FactState;
  value?: FactValue;
  /** Conflicting candidate values (state === "CONFLICT"). */
  candidates?: FactValue[];
  spans: FactSpan[];
  source: FactSource;
  /** Clarification wording for CONFLICT / withheld values (says why it is asked). */
  clarification?: string;
  note?: string;
};

export type FactMap = Record<string, NormalizedFact>;

// ---------------------------------------------------------------------------
// Clause segmentation
// ---------------------------------------------------------------------------

export type Clause = { start: number; end: number; text: string };

const HARD_SEPARATORS = new Set(["，", "。", "；", ";", "！", "!", "？", "?", "\n", "：", "︰"]);
const SENTENCE_SEPARATORS = new Set(["。", "！", "!", "？", "?", "\n", "；", ";"]);

/** True when the ASCII comma at `index` is a thousands separator ("14,500"), not a clause break ("14500,38"). */
function isThousandsComma(text: string, index: number): boolean {
  if (!/\d/.test(text[index - 1] ?? "")) return false;
  const group = text.slice(index + 1, index + 4);
  if (!/^\d{3}$/.test(group)) return false;
  if (/\d/.test(text[index + 4] ?? "")) return false;
  // The digits before the comma must themselves form a valid leading group (1–3 digits,
  // or a previous ",ddd" group). "14500,380" is not a thousands-grouped number.
  let start = index - 1;
  while (start >= 0 && /\d/.test(text[start])) start -= 1;
  const lead = index - 1 - start;
  if (lead <= 3) return true;
  return false;
}

function segment(text: string, separators: Set<string>): Clause[] {
  const clauses: Clause[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i];
    const isBreak =
      i === text.length ||
      separators.has(ch) ||
      (ch === "," && !isThousandsComma(text, i));
    if (isBreak) {
      if (i > start) clauses.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return clauses;
}

export function splitClauses(text: string): Clause[] {
  return segment(text, HARD_SEPARATORS);
}

export function splitSentences(text: string): Clause[] {
  return segment(text, SENTENCE_SEPARATORS);
}

// ---------------------------------------------------------------------------
// Amount parsing (field-local)
// ---------------------------------------------------------------------------

const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseCnSmall(token: string): number | undefined {
  // 一 .. 九十九 (enough for 萬 multipliers such as 一萬, 兩萬, 十二萬).
  if (!token) return undefined;
  if (/^[一二兩三四五六七八九]$/.test(token)) return CN_DIGIT[token];
  const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(token);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  return undefined;
}

export type ParsedAmount = { value: number; start: number; end: number; text: string };

/**
 * Parses ONE amount starting exactly at `index`. Accepts plain digits, strictly grouped
 * thousands ("14,500"), decimals, "1萬4500", "1.5萬", "一萬五", "兩萬". Never consumes a
 * comma that is not a valid thousands separator, so "14500,38" yields 14500.
 */
export function parseAmountAt(text: string, index: number): ParsedAmount | undefined {
  const rest = text.slice(index);
  // Arabic with optional 萬 suffix and remainder.
  const arabic = /^(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?(?:\s*(萬)\s*(\d{1,4})?|\s*(千))?/.exec(rest);
  if (arabic) {
    const whole = Number(arabic[1].replace(/,/g, ""));
    const frac = arabic[2] ? Number(`0.${arabic[2]}`) : 0;
    let value = whole + frac;
    if (arabic[3]) {
      value *= 10000;
      if (arabic[4]) {
        const tail = arabic[4];
        // "1萬5" → 15000 (colloquial thousands), "1萬4500" → 14500.
        value += tail.length === 1 ? Number(tail) * 1000 : Number(tail);
      }
    } else if (arabic[5]) {
      value *= 1000;
    }
    return { value: Math.round(value), start: index, end: index + arabic[0].length, text: arabic[0] };
  }
  const cn = /^([一二兩三四五六七八九十]{1,3})萬(?:([一二兩三四五六七八九])(千)?)?/.exec(rest);
  if (cn) {
    const head = parseCnSmall(cn[1]);
    if (head === undefined) return undefined;
    const value = head * 10000 + (cn[2] ? CN_DIGIT[cn[2]] * 1000 : 0);
    return { value, start: index, end: index + cn[0].length, text: cn[0] };
  }
  return undefined;
}

/** Units that mark a number as belonging to a DIFFERENT field. */
const FOREIGN_UNIT = /^\s*(?:歲|個月|月大|年|胎|小時|人|口|坪|%|％|次|天|週|周|間|戶)/;

type CueOptions = {
  /** Max characters allowed between cue and number. */
  maxGap?: number;
  /** Characters that must not appear in the gap (another field's cue). */
  forbiddenGap?: RegExp;
};

/** Finds an amount right after `cue` within one clause; returns undefined if the gap is not field-local. */
function amountAfterCue(clause: Clause, cue: RegExp, options: CueOptions = {}): (ParsedAmount & { cueStart: number }) | undefined {
  const maxGap = options.maxGap ?? 8;
  const global = new RegExp(cue.source, cue.flags.includes("g") ? cue.flags : cue.flags + "g");
  for (const match of clause.text.matchAll(global)) {
    const afterCue = (match.index ?? 0) + match[0].length;
    for (let gap = 0; gap <= maxGap && afterCue + gap < clause.text.length; gap += 1) {
      const ch = clause.text[afterCue + gap];
      if (/[\d一二兩三四五六七八九十]/.test(ch)) {
        const gapText = clause.text.slice(afterCue, afterCue + gap);
        if (options.forbiddenGap && options.forbiddenGap.test(gapText)) break;
        // Chinese numerals are only amounts when followed by 萬 (一萬五). Otherwise keep scanning.
        const parsed = parseAmountAt(clause.text, afterCue + gap);
        if (!parsed) {
          if (/\d/.test(ch)) break;
          continue;
        }
        if (FOREIGN_UNIT.test(clause.text.slice(parsed.end))) break;
        return {
          ...parsed,
          start: clause.start + parsed.start,
          end: clause.start + parsed.end,
          cueStart: clause.start + (match.index ?? 0),
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Taiwan district gazetteer (municipalities + 區-level cities)
// ---------------------------------------------------------------------------

const DISTRICTS: Record<string, string[]> = {
  臺北市: ["中正", "大同", "中山", "松山", "大安", "萬華", "信義", "士林", "北投", "內湖", "南港", "文山"],
  新北市: [
    "板橋", "三重", "中和", "永和", "新莊", "新店", "樹林", "鶯歌", "三峽", "淡水", "汐止", "瑞芳", "土城", "蘆洲", "五股",
    "泰山", "林口", "深坑", "石碇", "坪林", "三芝", "石門", "八里", "平溪", "雙溪", "貢寮", "金山", "萬里", "烏來",
  ],
  桃園市: ["桃園", "中壢", "大溪", "楊梅", "蘆竹", "大園", "龜山", "八德", "龍潭", "平鎮", "新屋", "觀音", "復興"],
  臺中市: [
    "中", "東", "南", "西", "北", "北屯", "西屯", "南屯", "太平", "大里", "霧峰", "烏日", "豐原", "后里", "石岡",
    "東勢", "和平", "新社", "潭子", "大雅", "神岡", "大肚", "沙鹿", "龍井", "梧棲", "清水", "大甲", "外埔", "大安",
  ],
  臺南市: [
    "中西", "東", "南", "北", "安平", "安南", "永康", "歸仁", "新化", "左鎮", "玉井", "楠西", "南化", "仁德", "關廟", "龍崎",
    "官田", "麻豆", "佳里", "西港", "七股", "將軍", "學甲", "北門", "新營", "後壁", "白河", "東山", "六甲", "下營", "柳營",
    "鹽水", "善化", "大內", "山上", "新市", "安定",
  ],
  高雄市: [
    "楠梓", "左營", "鼓山", "三民", "鹽埕", "前金", "新興", "苓雅", "前鎮", "旗津", "小港", "鳳山", "林園", "大寮", "大樹",
    "大社", "仁武", "鳥松", "岡山", "橋頭", "燕巢", "田寮", "阿蓮", "路竹", "湖內", "茄萣", "永安", "彌陀", "梓官", "旗山",
    "美濃", "六龜", "甲仙", "杉林", "內門", "茂林", "桃源", "那瑪夏",
  ],
  基隆市: ["仁愛", "信義", "中正", "中山", "安樂", "暖暖", "七堵"],
  新竹市: ["東", "北", "香山"],
  嘉義市: ["東", "西"],
};

/** Bare names (without 區) that are ordinary words or city names; they only count with 區 or a city prefix. */
const NO_BARE = new Set([
  "中", "東", "南", "西", "北", "桃園", "中正", "中山", "信義", "仁愛", "大同", "太平", "和平", "清水", "安定", "山上",
  "大內", "將軍", "北門", "永安", "新興", "大樹", "仁德", "復興", "觀音", "東山", "新屋", "新市", "中西", "鹽水", "彌陀",
  "橋頭", "大肚", "樹林", "深坑", "石門", "安樂", "暖暖", "金山", "萬里", "泰山", "香山", "龍井", "大安",
]);

const DISTRICT_INDEX: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [city, names] of Object.entries(DISTRICTS)) {
    for (const name of names) {
      const list = index.get(name) ?? [];
      list.push(city);
      index.set(name, list);
    }
  }
  return index;
})();

const DISTRICT_NAMES = [...DISTRICT_INDEX.keys()].sort((a, b) => b.length - a.length);

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

/** Canonical city candidates for a city token ("新竹" → [新竹市, 新竹縣]). */
function cityCandidates(token: string): string[] {
  if (token === "北市") return ["臺北市"];
  const normalized = normalizeCityName(token);
  if (!normalized) return [];
  if ((TAIWAN_CITIES as readonly string[]).includes(normalized)) return [normalized];
  return TAIWAN_CITIES.filter((city) => city.slice(0, -1) === normalized);
}

export function districtCities(name: string): string[] {
  return DISTRICT_INDEX.get(name.replace(/區$/, "")) ?? [];
}

const NOT_A_PLACE_AFTER = /^(?:路|街|大道|國小|國中|高中|大學|站|里|村|捷運|醫院|公園|堂|鄉|鎮|號|段|巷|線|港口)/;

export type LocationRole = "RENTAL" | "REGISTRATION" | "MOVE" | "WORK_STUDY" | "PROPERTY" | "PROGRAM" | "LOCATION";

export type LocationMention = {
  start: number;
  end: number;
  text: string;
  cityHint: string[];
  district?: string;
  city?: string;
  role: LocationRole;
};

function findRawLocations(text: string): Array<Omit<LocationMention, "role" | "city"> & { districtCandidates: string[] }> {
  const found: Array<Omit<LocationMention, "role" | "city"> & { districtCandidates: string[] }> = [];
  const cityAlt = [...CITY_TOKENS, "北市"].map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const districtAlt = DISTRICT_NAMES.join("|");
  const pattern = new RegExp(`(?:(${cityAlt})\\s*(?:(${districtAlt})(區)?)?)|(?:(${districtAlt})(區))|(${districtAlt})`, "g");
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const [whole, cityTok, cityDistrict, cityDistrictSuffix, soloDistrictWithSuffix, , bareDistrict] = match;
    if (cityTok) {
      // "北市" must not be the tail of "新北市" / "臺北市".
      if (cityTok === "北市" && /[新臺台]$/.test(text.slice(0, index))) continue;
      let district: string | undefined;
      let length = whole.length;
      if (cityDistrict) {
        const candidates = districtCities(cityDistrict);
        const hint = cityCandidates(cityTok);
        const fits = candidates.filter((city) => hint.includes(city));
        const singleChar = cityDistrict.length === 1;
        if (fits.length > 0 && (!singleChar || cityDistrictSuffix) && !NOT_A_PLACE_AFTER.test(text.slice(index + whole.length))) {
          district = cityDistrict;
        } else {
          length = cityTok.length;
        }
      }
      found.push({
        start: index,
        end: index + length,
        text: text.slice(index, index + length),
        cityHint: cityCandidates(cityTok),
        district: district ? `${district}區` : undefined,
        districtCandidates: district ? districtCities(district) : [],
      });
      continue;
    }
    const name = soloDistrictWithSuffix ?? bareDistrict;
    if (!name) continue;
    if (bareDistrict && (NO_BARE.has(bareDistrict) || NOT_A_PLACE_AFTER.test(text.slice(index + whole.length)))) continue;
    found.push({
      start: index,
      end: index + whole.length,
      text: whole,
      cityHint: [],
      district: `${name}區`,
      districtCandidates: districtCities(name),
    });
  }
  return found;
}

const WITHDRAWN = /撤回|不再納入|不再看|不再考慮|不納入|取消|不算|作廢/;

function classifyRole(text: string, clause: Clause, start: number, end: number): LocationRole | "WITHDRAWN" {
  const before = text.slice(clause.start, start);
  const after = text.slice(end, clause.end);
  if (WITHDRAWN.test(clause.text)) return "WITHDRAWN";
  // "本次改查桃園中壢" / "改成只看桃園市" / "只比較台北中正…" name the current case's place.
  if (/(?:改查|改成只看|改成|改看|改為|換成|只看|只比較|改問)\s*$/.test(before)) return "RENTAL";
  if (/(?:戶籍|設籍|籍)(?:地)?(?:設)?(?:在|於|為|是)?\s*$/.test(before) || /^\s*(?:的)?戶籍/.test(after) || /^[^，。]{0,6}(?:登記|設(?:有)?)戶籍/.test(after)) {
    return "REGISTRATION";
  }
  if (/(?:搬到|搬去|搬至|搬往)\s*$/.test(before)) return "MOVE";
  const clauseText = clause.text;
  if (/^(?:市|縣)?(?:政府|市府|縣府)?(?:自辦|自己的|地方|的地方|青年|市)?[^，。]{0,6}?(?:租補|租金補貼|租金加碼|加碼|方案|租屋補助)/.test(after) && !/^\s*(?:\S{0,3})?租(?!補|金補|金加碼|屋補)/.test(after)) {
    return "PROGRAM";
  }
  if (/^[^，。]{0,4}(?:名下)?(?:有|持有|擁有)[^，。租]{0,14}(?:住宅|房子|房屋|房產|自宅)/.test(after) || /名下\s*(?:在)?\s*$/.test(before)) {
    return "PROPERTY";
  }
  const rentalWord = /租(?!補|金補|金加碼|屋補)/;
  if (/(?:住在|居住在|居住於|住|租屋在|租屋於|租在|租)\s*$/.test(before) || rentalWord.test(after) || (rentalWord.test(clauseText) && !/^\s*(?:上班|工作)/.test(after))) {
    return "RENTAL";
  }
  if (/^\s*(?:上班|工作|唸書|念書|讀書|就學|就業|就讀)/.test(after) || /(?:工作在|就讀於|上班在)\s*$/.test(before)) {
    return "WORK_STUDY";
  }
  return "LOCATION";
}

export function extractLocations(text: string): LocationMention[] {
  return extractAllLocations(text).filter((loc): loc is LocationMention => loc.role !== ("WITHDRAWN" as LocationRole));
}

function extractAllLocations(text: string): Array<Omit<LocationMention, "role"> & { role: LocationRole | "WITHDRAWN" }> {
  const raw = findRawLocations(text);
  const clauses = splitClauses(text);
  const hintCities = new Set<string>();
  for (const item of raw) {
    if (item.cityHint.length === 1) hintCities.add(item.cityHint[0]);
    else if (!item.cityHint.length && item.districtCandidates.length === 1) hintCities.add(item.districtCandidates[0]);
  }
  return raw.map((item) => {
    const clause = clauses.find((c) => item.start >= c.start && item.start < c.end) ?? { start: 0, end: text.length, text };
    let city: string | undefined;
    if (item.cityHint.length && item.districtCandidates.length) {
      const fits = item.districtCandidates.filter((candidate) => item.cityHint.includes(candidate));
      city = fits.length === 1 ? fits[0] : undefined;
    } else if (item.cityHint.length) {
      city = item.cityHint.length === 1 ? item.cityHint[0] : undefined;
    } else if (item.districtCandidates.length === 1) {
      city = item.districtCandidates[0];
    } else if (item.districtCandidates.length > 1) {
      // Ambiguous district (中山區 → 臺北市／基隆市): resolve only from another explicit city in the text.
      const fits = item.districtCandidates.filter((candidate) => hintCities.has(candidate));
      city = fits.length === 1 ? fits[0] : undefined;
    }
    return {
      start: item.start,
      end: item.end,
      text: item.text,
      cityHint: item.cityHint,
      district: city ? item.district : undefined,
      city,
      role: classifyRole(text, clause, item.start, item.end),
    };
  });
}

// ---------------------------------------------------------------------------
// Polarity helpers
// ---------------------------------------------------------------------------

const HEDGE = /(?:是否|有沒有|有無|不確定|不知道|不清楚|沒弄清楚|弄不清|說不清|可能|也許|或許|還沒(?:有)?確認|尚未確認|未確認|還沒查|口頭)/;

function hedgedBefore(text: string, clause: Clause, index: number): boolean {
  return HEDGE.test(text.slice(clause.start, index));
}

type Hit = { start: number; end: number; text: string };

function clauseHits(text: string, pattern: RegExp, guard?: (hit: Hit, clause: Clause) => boolean): Hit[] {
  const hits: Hit[] = [];
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const clause of splitClauses(text)) {
    for (const match of clause.text.matchAll(global)) {
      const hit = { start: clause.start + (match.index ?? 0), end: clause.start + (match.index ?? 0) + match[0].length, text: match[0] };
      if (hedgedBefore(text, clause, hit.start)) continue;
      if (guard && !guard(hit, clause)) continue;
      hits.push(hit);
    }
  }
  return hits;
}

function booleanFact(
  field: string,
  positive: Hit[],
  negative: Hit[],
  clarification: string,
  source: FactSource = "EXPLICIT"
): NormalizedFact | undefined {
  if (positive.length && negative.length) {
    return { field, state: "CONFLICT", candidates: [true, false], spans: [...negative, ...positive], source, clarification };
  }
  if (positive.length) return { field, state: "KNOWN_TRUE", value: true, spans: positive, source };
  if (negative.length) return { field, state: "KNOWN_FALSE", value: false, spans: negative, source };
  return undefined;
}

/**
 * A field the user mentions but explicitly hedges ("可能還有另一筆住宅補助，沒弄清楚",
 * "口頭說是準公共，我還沒查簽約"). It stays UNKNOWN, but it is the salient open question,
 * so the Human Gate asks it first.
 */
function markHedged(text: string, facts: FactMap, field: string, mention: RegExp, exclude?: RegExp): void {
  if (facts[field]) return;
  for (const sentence of splitSentences(text)) {
    const hit = mention.exec(sentence.text);
    if (!hit || !HEDGE.test(sentence.text)) continue;
    if (exclude && exclude.test(sentence.text.slice(Math.max(0, hit.index - 3), hit.index + hit[0].length + 3))) continue;
    const start = sentence.start + hit.index;
    facts[field] = { field, state: "UNKNOWN", spans: [{ start, end: start + hit[0].length, text: hit[0] }], source: "EXPLICIT", note: "HEDGED" };
    return;
  }
}

/** Fields the user mentioned but hedged, in text order. */
export function hedgedFields(facts: FactMap): string[] {
  return Object.values(facts)
    .filter((fact) => fact.state === "UNKNOWN" && fact.note === "HEDGED")
    .sort((left, right) => (left.spans[0]?.start ?? 0) - (right.spans[0]?.start ?? 0))
    .map((fact) => fact.field);
}

function quote(spans: FactSpan[], index: number): string {
  return spans[index]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Housing facts
// ---------------------------------------------------------------------------

const RENT_CUE = /(?:月租|租金|房租|租屋|租房|一個月|租)(?!補|約|客|戶|賃|金補|金加碼|屋補)/;
const INCOME_CUE = /(?:月薪|月收入|月所得|月入|月收|薪水|薪資|所得|收入)/;
const OTHER_FIELD_CUE = /(?:歲|年齡|租|所得|收入|月入|月薪|薪)/;

const HOME_NOUN = "(?:房子|房屋|房產|住宅|自宅|自有屋|屋|房)";
const OWNS_HOME_FALSE = new RegExp(`(?:沒有|沒|無|未持有|並無|不持有|名下無)(?:任何)?(?:自有|自己的)?${HOME_NOUN}(?![租補貼間東客價])`);
const OWNS_HOME_TRUE = /(?<![沒無未自])(?:持有|擁有|有)(?:一|1|兩|2)?(?:間|棟|戶|整間|套)?[^，。；租,沒無未不]{0,14}?(?:住宅|房子|房屋|房產|自宅|自有屋)(?![租補貼])|(?<![沒無未是否自])有房(?![租補貼間])/;
const OTHER_AID_FALSE = /(?:沒有|沒|未曾|未|無|並未|不曾)(?:有)?(?:在)?(?:領|領取|請領|申請|享有|接受)?(?:過)?(?:任何)?(?:其他|另外|別的)?(?:的)?(?:政府)?(?:住宅|租金|租屋|房租)?(?:補助|補貼|協助)/;
const OTHER_AID_TRUE = /(?<![沒未無])(?:現領|正在領|目前(?:每月)?(?:都)?(?:在)?領|有在領|有領|已領|領有|仍在領|還在領)(?:取)?[^，。；,]{0,8}?(?:租金補貼|住宅補貼|住宅補助|租屋補助|租補|租金補助|住宅協助)/;

function extractAge(text: string, facts: FactMap): void {
  for (const clause of splitClauses(text)) {
    const explicit = /年齡\s*(?:為|是|:)?\s*(\d{1,3})(?!\d)/.exec(clause.text);
    if (explicit) {
      const age = Number(explicit[1]);
      if (age >= 0 && age <= 130) {
        const start = clause.start + (explicit.index ?? 0);
        facts.age = { field: "age", state: "KNOWN_VALUE", value: age, spans: [{ start, end: start + explicit[0].length, text: explicit[0] }], source: "EXPLICIT" };
        return;
      }
    }
    for (const match of clause.text.matchAll(/(\d{1,3})\s*歲/g)) {
      const index = match.index ?? 0;
      const before = clause.text.slice(Math.max(0, index - 2), index);
      const after = clause.text.slice(index + match[0].length, index + match[0].length + 3);
      if (/(?:未滿|不滿|年滿|超過|高於|低於|以上|以下)$/.test(before) || (/滿$/.test(before) && !/(?:剛|已)滿$/.test(before))) continue;
      if (/^\s*(?:以上|以下|至|到|~|-|－|個月|半)/.test(after)) continue;
      if (/\d|,/.test(clause.text[index - 1] ?? "")) continue;
      const age = Number(match[1]);
      if (age >= 0 && age <= 130) {
        const start = clause.start + index;
        facts.age = { field: "age", state: "KNOWN_VALUE", value: age, spans: [{ start, end: start + match[0].length, text: match[0] }], source: "EXPLICIT" };
        return;
      }
    }
  }
}

function extractIncome(text: string, facts: FactMap): void {
  for (const clause of splitClauses(text)) {
    const hit = amountAfterCue(clause, INCOME_CUE, { maxGap: 8, forbiddenGap: /租|歲/ });
    if (!hit) continue;
    const span = { start: hit.cueStart, end: hit.end, text: text.slice(hit.cueStart, hit.end) };
    if (hit.value < 0 || hit.value > 5_000_000) {
      facts.monthlyIncome = { field: "monthlyIncome", state: "UNKNOWN", spans: [span], source: "EXPLICIT", note: "IMPLAUSIBLE_VALUE" };
      return;
    }
    const perPerson = /人均|每人|平均每人|每個人/.test(clause.text);
    const householdTotal = /全戶|全家|合計|總共|一共|總所得|總收入|家戶總/.test(clause.text);
    if (householdTotal && !perPerson) {
      // "全戶每月所得90000" is a household total, not the per-person average the rules use.
      facts.monthlyIncome = { field: "monthlyIncome", state: "UNKNOWN", spans: [span], source: "EXPLICIT", note: "HOUSEHOLD_TOTAL_NOT_PER_PERSON" };
      return;
    }
    facts.monthlyIncome = { field: "monthlyIncome", state: "KNOWN_VALUE", value: hit.value, spans: [span], source: "EXPLICIT" };
    return;
  }
}

type RentHit = ParsedAmount & { cueStart: number };

function rentHits(text: string, from = 0, to = text.length): RentHit[] {
  const hits: RentHit[] = [];
  for (const clause of splitClauses(text)) {
    if (clause.end <= from || clause.start >= to) continue;
    const scoped: Clause = {
      start: Math.max(clause.start, from),
      end: Math.min(clause.end, to),
      text: text.slice(Math.max(clause.start, from), Math.min(clause.end, to)),
    };
    let cursor: Clause = scoped;
    // Several cue+amount pairs can live in one clause ("台北中正月租14500與新北新莊月租10800").
    for (let guard = 0; guard < 4; guard += 1) {
      const hit = amountAfterCue(cursor, RENT_CUE, { maxGap: 8, forbiddenGap: /所得|收入|月入|薪|歲|年齡|補/ });
      if (!hit) break;
      hits.push(hit);
      // Listed second amount: "分別月租11000和15500".
      const tail = text.slice(hit.end, scoped.end);
      const listed = /^\s*(?:元)?\s*(?:和|與|跟|、|及)\s*/.exec(tail);
      if (listed) {
        const second = parseAmountAt(text, hit.end + listed[0].length);
        if (second && !FOREIGN_UNIT.test(text.slice(second.end))) {
          hits.push({ ...second, cueStart: hit.cueStart });
        }
      }
      const nextStart = hit.end;
      if (nextStart >= scoped.end) break;
      cursor = { start: nextStart, end: scoped.end, text: text.slice(nextStart, scoped.end) };
    }
  }
  return hits.filter((hit) => hit.value >= 500 && hit.value <= 300_000);
}

function extractHousingBooleans(text: string, facts: FactMap): void {
  const ownsFalse = clauseHits(text, OWNS_HOME_FALSE);
  const ownsTrue = clauseHits(text, OWNS_HOME_TRUE, (hit) => !/租/.test(hit.text));
  const owns = booleanFact("ownsHome", ownsTrue, ownsFalse, "");
  if (owns) {
    if (owns.state === "CONFLICT") {
      owns.clarification = `你前面同時提到「${quote(ownsFalse, 0)}」與「${quote(ownsTrue, 0)}」，請確認：本人或依法列計的家庭成員目前是否持有住宅？`;
    }
    facts.ownsHome = owns;
  }

  const aidFalse = clauseHits(text, OTHER_AID_FALSE, (hit) => !/托育|育兒/.test(text.slice(Math.max(0, hit.start - 2), hit.end)));
  const aidTrue = clauseHits(text, OTHER_AID_TRUE);
  const aid = booleanFact("receivesOtherHousingAid", aidTrue, aidFalse, "");
  if (aid) {
    if (aid.state === "CONFLICT") {
      aid.clarification = `你前面同時提到「${quote(aidFalse, 0)}」與「${quote(aidTrue, 0)}」，請確認：目前是否正在領取其他政府住宅補貼或租金補貼？`;
    }
    facts.receivesOtherHousingAid = aid;
  }
}

export type HousingExtraction = {
  facts: FactMap;
  locations: LocationMention[];
  whatIfCity?: string;
  whatIfDistrict?: string;
  whatIfMonthlyRent?: number;
  district?: string;
  dualCityComparison?: boolean;
};

export function extractHousingFactsTyped(text: string): HousingExtraction {
  const facts: FactMap = {};
  const locations = extractLocations(text);
  const result: HousingExtraction = { facts, locations };

  const move = /(?:搬到|搬去|搬至|搬往)/.exec(text);
  const moveIndex = move ? move.index : text.length;

  const registration = locations.find((loc) => loc.role === "REGISTRATION" && loc.city);
  if (registration?.city) {
    facts.registeredCity = { field: "registeredCity", state: "KNOWN_VALUE", value: registration.city, spans: [registration], source: registration.district && !registration.cityHint.length ? "DISTRICT_INFERENCE" : "EXPLICIT" };
  }

  const moveLoc = locations.find((loc) => loc.role === "MOVE" && loc.city);
  if (moveLoc?.city) {
    result.whatIfCity = moveLoc.city;
    result.whatIfDistrict = moveLoc.district;
    const sentenceEnd = (() => {
      const after = text.slice(moveLoc.start).search(/[。？?！!]/);
      return after === -1 ? text.length : moveLoc.start + after;
    })();
    const whatIfRent = rentHits(text, moveLoc.start, sentenceEnd)[0];
    if (whatIfRent) result.whatIfMonthlyRent = whatIfRent.value;
  }

  const beforeMove = locations.filter((loc) => loc.start < moveIndex);
  const rentals = beforeMove.filter((loc) => loc.role === "RENTAL" && loc.city);
  const distinctRentalCities = [...new Set(rentals.map((loc) => loc.city))];
  const comparison = /比較|比租|分開|分別|兩處|兩地|兩邊/.test(text);
  const rents = rentHits(text, 0, moveLoc ? moveLoc.start : text.length);

  let residence: LocationMention | undefined;
  const competingRentals = !moveLoc && !comparison && distinctRentalCities.length >= 2;
  if (competingRentals) {
    facts.city = {
      field: "city",
      state: "CONFLICT",
      candidates: distinctRentalCities as string[],
      spans: rentals,
      source: "EXPLICIT",
      clarification: `你提到在${distinctRentalCities.join("與")}都有租屋，請問本次申請使用的是哪一個縣市的租約？`,
    };
  } else if (rentals.length) {
    residence = rentals[0];
  } else {
    const plain = beforeMove.filter((loc) => (loc.role === "LOCATION") && loc.city);
    const cities = [...new Set(plain.map((loc) => loc.city))];
    if (cities.length === 1) residence = plain[0];
  }

  if (!moveLoc && comparison && distinctRentalCities.length >= 2) {
    const second = rentals.find((loc) => loc.city !== rentals[0].city)!;
    result.whatIfCity = second.city;
    result.whatIfDistrict = second.district;
    result.dualCityComparison = true;
    // Rent for each place: the amount following that place (or listed order after 分別).
    const firstRent = rents.find((hit) => hit.start > rentals[0].start && hit.start < second.start) ?? rents[0];
    const secondRent = rents.find((hit) => hit.start > second.start && hit !== firstRent) ?? rents.find((hit) => hit !== firstRent);
    if (firstRent) facts.monthlyRent = { field: "monthlyRent", state: "KNOWN_VALUE", value: firstRent.value, spans: [firstRent], source: "EXPLICIT" };
    if (secondRent) result.whatIfMonthlyRent = secondRent.value;
  } else if (rents.length) {
    const values = [...new Set(rents.map((hit) => hit.value))];
    if (values.length === 1) {
      facts.monthlyRent = { field: "monthlyRent", state: "KNOWN_VALUE", value: values[0], spans: [rents[0]], source: "EXPLICIT" };
    } else {
      facts.monthlyRent = {
        field: "monthlyRent",
        state: "CONFLICT",
        candidates: values,
        spans: rents,
        source: "EXPLICIT",
        clarification: `你提到的月租金有 ${values.map((v) => v.toLocaleString()).join(" 與 ")} 元兩種，請確認依租約你本人實際每月負擔的租金。`,
      };
    }
  }

  if (residence?.city) {
    facts.city = {
      field: "city",
      state: "KNOWN_VALUE",
      value: residence.city,
      spans: [residence],
      source: residence.cityHint.length ? "EXPLICIT" : "DISTRICT_INFERENCE",
    };
    if (residence.district) result.district = residence.district;
  } else if (!competingRentals) {
    const ambiguous = beforeMove.find((loc) => (loc.role === "RENTAL" || loc.role === "LOCATION") && !loc.city);
    if (ambiguous) {
      facts.city = {
        field: "city",
        state: "UNKNOWN",
        spans: [ambiguous],
        source: "EXPLICIT",
        note: "AMBIGUOUS_PLACE_NAME",
        clarification: `「${ambiguous.text}」可能位於不同縣市，請問您的租屋處位於哪個縣市？`,
      };
    }
  }

  // 新北 local-link condition: only explicit residence registration / study / work in 新北.
  const ntpcLink = locations.find((loc) => loc.city === "新北市" && (loc.role === "WORK_STUDY" || loc.role === "REGISTRATION"));
  if (ntpcLink || /(?:在新北(?:市)?(?:上班|工作|唸書|念書|讀書|就學|就業)|工作在新北)/.test(text)) {
    facts.newTaipeiResidenceStudyWork = {
      field: "newTaipeiResidenceStudyWork",
      state: "KNOWN_TRUE",
      value: true,
      spans: ntpcLink ? [ntpcLink] : [],
      source: "EXPLICIT",
    };
  }

  extractAge(text, facts);
  extractIncome(text, facts);
  extractHousingBooleans(text, facts);
  markHedged(text, facts, "ownsHome", /房屋持有|有房|房產|自有住宅|名下[^，。]{0,6}房|家裡[^，。]{0,4}房/);
  markHedged(text, facts, "receivesOtherHousingAid", /(?:住宅|租金|租屋)?(?:補助|補貼|協助)/, /托育|育兒/);
  return result;
}

// ---------------------------------------------------------------------------
// Childcare facts
// ---------------------------------------------------------------------------

const CARE_TRUE = /(?:送|送托|送去|就讀|讀|念|在|使用|接受|正在領|有領|已領|領)[^，。；,]{0,10}?(?:公托|公共托育|公共化托育|公設民營|準公共|公共化)|(?:政府)?(?:已)?簽約(?:的)?準公共/;
const CARE_FALSE = /(?:沒有|沒|未|並未|不是|無|非)(?:在)?(?:送托|送去|送|使用|接受|讀|念)?\s*(?:公托|公共托育|公共化托育|準公共|公共化)|自己在家帶|在家自己帶|自己帶|居家照顧|在家照顧|在家帶|未送托|沒有送托|沒送托|不送托/;
const REG_TRUE = /(?:已|有|已經|設有)(?:在[^，。；,]{0,6})?(?:完成|辦理|辦好|辦|設|登記)?(?:出生登記|出生戶籍登記|初設戶籍登記|初設戶籍|報戶口|戶籍登記|戶籍)|(?:臺|台|新|桃|北)\S{0,2}戶籍/;
const REG_FALSE = /(?:尚未|還沒|還未|沒有|未)(?:完成|辦理|辦好|辦|設)?(?:出生登記|出生戶籍登記|初設戶籍登記|初設戶籍|報戶口|戶籍登記|戶籍)/;
const PLACED_TRUE = /(?<![沒未無非])(?:經政府(?:全額)?(?:公費)?安置|由政府(?:全額)?公費安置|公費安置|安置(?:機構|收容)中)/;
const PLACED_FALSE = /(?:沒有|未|並未|非|無|沒)(?:經)?(?:政府)?(?:全額)?(?:公費)?安置/;

export function extractChildcareFactsTyped(text: string): { facts: FactMap; locations: LocationMention[] } {
  const facts: FactMap = {};
  const locations = extractLocations(text);

  const yearsMonths = /(\d{1,2})\s*歲\s*(?:又)?\s*(\d{1,2})\s*個月/.exec(text);
  if (yearsMonths) {
    const value = Number(yearsMonths[1]) * 12 + Number(yearsMonths[2]);
    facts.childAgeMonths = { field: "childAgeMonths", state: "KNOWN_VALUE", value, spans: [{ start: yearsMonths.index, end: yearsMonths.index + yearsMonths[0].length, text: yearsMonths[0] }], source: "EXPLICIT" };
  } else {
    const months = /(?<![\d婚])(\d{1,3})\s*個月(?:大)?/.exec(text);
    const exactYears = /(?:剛滿|已滿|今天滿|剛好滿)\s*(\d{1,2})\s*歲/.exec(text);
    if (months && Number(months[1]) <= 240) {
      facts.childAgeMonths = { field: "childAgeMonths", state: "KNOWN_VALUE", value: Number(months[1]), spans: [{ start: months.index, end: months.index + months[0].length, text: months[0] }], source: "EXPLICIT" };
    } else if (exactYears) {
      facts.childAgeMonths = { field: "childAgeMonths", state: "KNOWN_VALUE", value: Number(exactYears[1]) * 12, spans: [{ start: exactYears.index, end: exactYears.index + exactYears[0].length, text: exactYears[0] }], source: "EXPLICIT", note: "EXACT_BIRTHDAY_YEARS" };
    }
  }

  const order = /第\s*([1-9]\d?|[一二兩三四五六七八九十])\s*(?:胎|個孩子|個小孩|個寶寶|名子女|名小孩|個子女)/.exec(text);
  if (order) {
    const token = order[1];
    const value = /^\d+$/.test(token) ? Number(token) : token === "十" ? 10 : CN_DIGIT[token];
    if (value >= 1) facts.birthOrder = { field: "birthOrder", state: "KNOWN_VALUE", value, spans: [{ start: order.index, end: order.index + order[0].length, text: order[0] }], source: "EXPLICIT" };
  } else {
    const first = /頭胎|首胎/.exec(text);
    if (first) facts.birthOrder = { field: "birthOrder", state: "KNOWN_VALUE", value: 1, spans: [{ start: first.index, end: first.index + first[0].length, text: first[0] }], source: "EXPLICIT" };
  }

  const regTrue = clauseHits(text, REG_TRUE, (hit) => !/^(?:尚未|還沒|還未|沒有|未)/.test(text.slice(Math.max(0, hit.start - 2), hit.start + 2)) && !REG_FALSE.test(text.slice(Math.max(0, hit.start - 3), hit.end)));
  const regFalse = clauseHits(text, REG_FALSE);
  const reg = booleanFact("childHasBirthOrInitialHouseholdRegistration", regTrue, regFalse, "");
  if (reg) {
    if (reg.state === "CONFLICT") reg.clarification = `你前面同時提到「${quote(regFalse, 0)}」與「${quote(regTrue, 0)}」，請確認兒童是否已完成出生登記或初設戶籍登記？`;
    facts.childHasBirthOrInitialHouseholdRegistration = reg;
  }

  const careTrue = clauseHits(text, CARE_TRUE, (hit) => !/(?:沒有|沒|未|並未|不是|無|非)\S{0,3}$/.test(text.slice(Math.max(0, hit.start - 4), hit.start)));
  const careFalse = clauseHits(text, CARE_FALSE);
  const care = booleanFact("receivesPublicOrQuasiPublicChildcare", careTrue, careFalse, "");
  if (care) {
    if (care.state === "CONFLICT") care.clarification = `你前面同時提到「${quote(careFalse, 0)}」與「${quote(careTrue, 0)}」，請確認兒童目前是否正在送托公共化或準公共托育服務？`;
    facts.receivesPublicOrQuasiPublicChildcare = care;
  }

  const placedFalse = clauseHits(text, PLACED_FALSE);
  const placedTrue = clauseHits(text, PLACED_TRUE, (hit) => !placedFalse.some((neg) => neg.end >= hit.end && neg.start <= hit.start));
  const placed = booleanFact("isGovernmentPlaced", placedTrue, placedFalse, "");
  if (placed) {
    if (placed.state === "CONFLICT") placed.clarification = `你前面同時提到「${quote(placedFalse, 0)}」與「${quote(placedTrue, 0)}」，請確認兒童目前是否經政府公費安置收容？`;
    facts.isGovernmentPlaced = placed;
  }

  markHedged(text, facts, "receivesPublicOrQuasiPublicChildcare", /準公共|公共托育|公托|簽約|保母|托嬰中心/);
  markHedged(text, facts, "childHasBirthOrInitialHouseholdRegistration", /戶籍|出生登記|報戶口/);

  const registration = locations.find((loc) => loc.role === "REGISTRATION" && loc.city);
  if (registration?.city) {
    facts.childRegisteredCity = { field: "childRegisteredCity", state: "KNOWN_VALUE", value: registration.city, spans: [registration], source: "EXPLICIT" };
  }
  return { facts, locations };
}

/** Field values that are KNOWN (true / false / value). CONFLICT and UNKNOWN are withheld. */
export function knownValues(facts: FactMap): Record<string, FactValue> {
  const values: Record<string, FactValue> = {};
  for (const [field, fact] of Object.entries(facts)) {
    if ((fact.state === "KNOWN_TRUE" || fact.state === "KNOWN_FALSE" || fact.state === "KNOWN_VALUE") && fact.value !== undefined) {
      values[field] = fact.value;
    }
  }
  return values;
}
