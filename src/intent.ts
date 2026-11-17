// Gate 4B — request intent analysis with polarity.
//
// Separates, per mention of a benefit/domain term:
//   INTENT       — the user asks about it ("想查中央租補", "只問育兒津貼")
//   NEGATED      — the user explicitly excludes it ("租補和育兒都跟我無關", "不是要問育兒")
//   STATUS_FACT  — an incidental statement of benefit status ("沒有請領托育補助", "正在領公共托育補助")
// so that policy words inside a negation or a status clause never route the case.
//
// A request may have several components (supported / not covered / referral). Nothing
// here decides eligibility; it only decides which workflow may answer which part.

import { splitClauses, type Clause } from "./fact-extraction";

export type MentionPolarity = "INTENT" | "NEGATED" | "STATUS_FACT";

export type TopicKey =
  | "HOUSING_SUBSIDY"
  | "HOUSING_CONTEXT"
  | "CENTRAL_RENT"
  | "LOCAL_RENT_PROGRAM"
  | "CHILDCARE_ALLOWANCE"
  | "CHILDCARE_SUBSIDY"
  | "CHILDCARE_CONTEXT"
  | "UNSUPPORTED_CHILDCARE"
  | "UNSUPPORTED_HOUSING"
  | "LONG_TERM_CARE"
  | "FARMER_ALLOWANCE"
  | "VOCATIONAL_TRAINING"
  | "OTHER_WELFARE";

export type TopicMention = { topic: TopicKey; term: string; start: number; end: number; polarity: MentionPolarity };

type TopicDef = { topic: TopicKey; terms: string[] };

const TOPICS: TopicDef[] = [
  { topic: "CENTRAL_RENT", terms: ["300億", "三百億", "中央擴大租金補貼", "中央租金補貼", "中央租補", "中央"] },
  {
    topic: "LOCAL_RENT_PROGRAM",
    terms: ["臺北幸福租", "台北幸福租", "幸福租", "青年租金補貼", "青年租補", "青年租金加碼", "地方租屋補助", "地方租補", "地方加碼", "地方方案", "地方的加碼", "自辦地方租補", "自辦", "加碼"],
  },
  { topic: "HOUSING_SUBSIDY", terms: ["租金補貼", "租屋補助", "租金補助", "租補", "住宅補貼", "租屋補貼"] },
  { topic: "HOUSING_CONTEXT", terms: ["租屋", "租房", "月租", "房租", "租金", "租約", "租客", "合租", "rent", "housing", "lease"] },
  { topic: "UNSUPPORTED_HOUSING", terms: ["原住民族租金補貼", "原住民租金補貼", "包租代管", "購屋貸款", "青年購屋", "修繕住宅"] },
  { topic: "CHILDCARE_ALLOWANCE", terms: ["育兒津貼", "育兒", "0到未滿2歲", "0到2歲", "0至未滿2歲", "未滿2歲", "未滿二歲", "0-2歲"] },
  { topic: "CHILDCARE_SUBSIDY", terms: ["托育費用補助", "準公共托育補助", "公共托育補助", "托育補助", "托育補貼", "托育費用"] },
  { topic: "UNSUPPORTED_CHILDCARE", terms: ["生育津貼", "生育獎勵", "生育補助", "就學補助", "幼兒園補助", "育嬰留職停薪", "parental leave"] },
  { topic: "CHILDCARE_CONTEXT", terms: ["寶寶", "嬰兒", "幼兒", "托嬰", "保母", "保姆", "育嬰", "托育", "準公共", "生育", "childcare", "child care"] },
  { topic: "LONG_TERM_CARE", terms: ["長照", "長期照顧", "居家服務", "居家照顧服務"] },
  { topic: "FARMER_ALLOWANCE", terms: ["老年農民福利津貼", "老農津貼", "農保", "農民", "漁民"] },
  { topic: "VOCATIONAL_TRAINING", terms: ["職訓生活津貼", "職業訓練生活津貼", "職訓", "職業訓練"] },
  {
    topic: "OTHER_WELFARE",
    terms: ["老人", "身心障礙", "急難救助", "失業", "年金", "勞保", "健保", "重陽", "敬老", "假牙", "學貸", "就學貸款", "獎學金"],
  },
];

const ALL_TERMS: Array<{ topic: TopicKey; term: string }> = TOPICS.flatMap((def) => def.terms.map((term) => ({ topic: def.topic, term })))
  .sort((left, right) => right.term.length - left.term.length);

// Negation that scopes over the mention.
const NEGATED_BEFORE = /(?:不是要問|不是問|不是要查|不問|不查|不看|不用(?:幫我)?(?:看|查|問|評估)?|不要|不需要|不必|不考慮|並非)[^，。；,]{0,10}$/;
const NEGATED_AFTER = /^[^，。；,]{0,12}?(?:都)?(?:跟我|與我|和我)?(?:無關|沒關係|不相關|不需要|不用|不必|不考慮)/;
// Benefit status ("沒有請領托育補助", "正在領公共托育補助", "還沒領育兒津貼", "現領另一項…").
const STATUS_BEFORE =
  /(?:(?:沒有|沒|未曾|未|無|還沒|尚未|並未)(?:在)?(?:請)?(?:領|領取|請領|申請|使用)?|(?:正在|現在|現|已|有在|有|目前(?:每月)?(?:都)?(?:在)?|仍在|還在)(?:請)?(?:領|領取|請領|申請|使用))(?:過)?(?:任何)?(?:其他|另一項|另一筆|另外)?(?:政府)?(?:的)?\s*$/;
// Coordinated negation: "無公費安置或托育補助", "沒有公費安置、沒有托育補助".
const STATUS_LIST = /(?:沒有|沒|未|無|並未|還沒|尚未)[^，。；,]{0,10}(?:或|和|及|、|與|也沒有|也沒|也未)\s*$/;
const INTENT_CUE = /(?:想|要|只|僅|問|查|看|申請|評估|區分|知道|確認|能不能|可不可以|可以|能否|是否可以|怎麼)/;

function polarityOf(text: string, clause: Clause, start: number, end: number, term: string): MentionPolarity {
  const before = text.slice(clause.start, start);
  const after = text.slice(end, clause.end);
  if (NEGATED_BEFORE.test(before) || NEGATED_AFTER.test(after)) return "NEGATED";
  const near = before.slice(-8);
  if ((STATUS_BEFORE.test(near) || STATUS_LIST.test(before)) && !/(?:想|要|可以|能否|能不能|可不可以)(?:同時)?(?:請)?(?:領|領取|請領|申請)?\s*$/.test(near)) {
    // A bare "有" before a context word ("有租約") is a fact, not a negation — still not an intent.
    return "STATUS_FACT";
  }
  void term;
  return "INTENT";
}

export function findTopicMentions(goal: string): TopicMention[] {
  const text = goal.normalize("NFKC");
  const lower = text.toLowerCase();
  const clauses = splitClauses(text);
  const taken: boolean[] = new Array(text.length).fill(false);
  const mentions: TopicMention[] = [];
  for (const { topic, term } of ALL_TERMS) {
    const needle = term.toLowerCase();
    let from = 0;
    for (;;) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      from = index + needle.length;
      let overlap = false;
      for (let i = index; i < index + needle.length; i += 1) if (taken[i]) { overlap = true; break; }
      if (overlap) continue;
      // Bare "中央" only names the central RENT programme when a rental word follows ("中央115租補").
      if (term === "中央" && !/^[^，。；,]{0,6}?(?:租|住宅)/.test(text.slice(index + needle.length))) continue;
      for (let i = index; i < index + needle.length; i += 1) taken[i] = true;
      const clause = clauses.find((c) => index >= c.start && index < c.end) ?? { start: 0, end: text.length, text };
      mentions.push({ topic, term, start: index, end: index + needle.length, polarity: polarityOf(text, clause, index, index + needle.length, term) });
    }
  }
  return mentions.sort((left, right) => left.start - right.start);
}

export type RequestIntent = {
  mentions: TopicMention[];
  /** Positive housing request (subsidy intent or rental facts not negated). */
  housing: boolean;
  /** Housing explicitly excluded by the user. */
  housingNegated: boolean;
  centralIntent: boolean;
  centralNegated: boolean;
  localProgramIntent: boolean;
  /** The user asks only about a city's own local programme (central excluded or not requested). */
  localOnly: boolean;
  childcareAllowance: boolean;
  childcareSubsidy: boolean;
  childcareContext: boolean;
  childcareNegated: boolean;
  /** Not-covered topics the user asks about (positive intent only). */
  unsupported: TopicKey[];
};

const UNSUPPORTED_TOPICS: TopicKey[] = ["LONG_TERM_CARE", "FARMER_ALLOWANCE", "VOCATIONAL_TRAINING", "OTHER_WELFARE", "UNSUPPORTED_CHILDCARE", "UNSUPPORTED_HOUSING"];

export function analyzeRequestIntent(goal: string): RequestIntent {
  const mentions = findTopicMentions(goal);
  const has = (topic: TopicKey, polarity: MentionPolarity) => mentions.some((m) => m.topic === topic && m.polarity === polarity);
  const any = (topic: TopicKey, polarities: MentionPolarity[]) => mentions.some((m) => m.topic === topic && polarities.includes(m.polarity));

  const housingSubsidyIntent = has("HOUSING_SUBSIDY", "INTENT") || has("CENTRAL_RENT", "INTENT") || has("LOCAL_RENT_PROGRAM", "INTENT");
  const housingContext = any("HOUSING_CONTEXT", ["INTENT", "STATUS_FACT"]);
  const housingNegated =
    (has("HOUSING_SUBSIDY", "NEGATED") || has("HOUSING_CONTEXT", "NEGATED")) && !housingSubsidyIntent;
  const housing = !housingNegated && (housingSubsidyIntent || housingContext);

  const centralIntent = has("CENTRAL_RENT", "INTENT");
  const centralNegated = has("CENTRAL_RENT", "NEGATED") && !centralIntent;
  const localProgramIntent = has("LOCAL_RENT_PROGRAM", "INTENT");
  const localOnly = localProgramIntent && !centralIntent;

  const childcareAllowance = has("CHILDCARE_ALLOWANCE", "INTENT");
  const childcareSubsidy = has("CHILDCARE_SUBSIDY", "INTENT");
  const childcareNegated =
    (has("CHILDCARE_ALLOWANCE", "NEGATED") || has("CHILDCARE_SUBSIDY", "NEGATED") || has("CHILDCARE_CONTEXT", "NEGATED")) &&
    !childcareAllowance && !childcareSubsidy;
  const childcareContext =
    !childcareNegated &&
    (any("CHILDCARE_CONTEXT", ["INTENT", "STATUS_FACT"]) ||
      any("CHILDCARE_ALLOWANCE", ["STATUS_FACT"]) ||
      any("CHILDCARE_SUBSIDY", ["STATUS_FACT"]));

  const unsupported = UNSUPPORTED_TOPICS.filter((topic) => has(topic, "INTENT"));

  return {
    mentions,
    housing,
    housingNegated,
    centralIntent,
    centralNegated,
    localProgramIntent,
    localOnly,
    childcareAllowance,
    childcareSubsidy,
    childcareContext,
    childcareNegated,
    unsupported,
  };
}
