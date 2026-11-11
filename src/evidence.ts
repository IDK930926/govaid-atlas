import type {
  EvidenceRecord,
  RuleEvaluation,
} from "./types";

export const evidenceRegistry: EvidenceRecord[] = [
  {
    sourceId: "R1",
    agency: "內政部國土管理署",
    policyName:
      "三百億元中央擴大租金補貼專案計畫作業規定（115年度）",
    url:
      "https://thd.taichung.gov.tw/media/1305401/附件2-115-300億租金補貼作業規定.pdf",
    lastVerifiedAt: "2026-10-16",
  },

  {
    sourceId: "R6",
    agency: "臺北市政府都市發展局",
    policyName:
      "115年度臺北幸福租－民間租屋租金加碼補貼",
    url:
      "https://rent-allowance.udd.gov.taipei/THR/Files/115紙本臺北市住宅租金加碼補貼申請書.pdf",
    lastVerifiedAt: "2026-10-16",
  },

  {
    sourceId: "R7",
    agency: "新北市政府城鄉發展局",
    policyName:
      "115年度新北市青年租金補貼",
    url:
      "https://www.shulin.ris.ca.ntpc.gov.tw/Content/Upload/file/20251001/6389492414785848483467433.pdf",
    lastVerifiedAt: "2026-10-16",
  },

  {
    sourceId: "R8",
    agency: "衛生福利部社會及家庭署",
    policyName:
      "育有未滿二歲兒童育兒津貼申領作業要點（115年度適用）",
    url:
      "https://www.sfaa.gov.tw/SFAA/Pages/Detail.aspx?nodeid=415&pid=7582",
    lastVerifiedAt: "2026-11-11",
  },

  {
    sourceId: "R9",
    agency: "桃園市政府住宅發展處／內政部國土管理署",
    policyName:
      "300億元中央擴大租金補貼專案計畫－桃園市受理與申辦規定（115年度）",
    url:
      "https://ohd.tycg.gov.tw/",
    lastVerifiedAt: "2026-11-11",
  },
];

export function getEvidence(
  sourceId: string
): EvidenceRecord | undefined {
  return evidenceRegistry.find(
    (item) => item.sourceId === sourceId
  );
}

export function bindEvidence(
  evaluations: RuleEvaluation[]
) {
  return evaluations.map((evaluation) => ({
    ...evaluation,
    evidence:
      getEvidence(evaluation.sourceId) ?? null,
  }));
}
