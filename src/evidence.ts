import type {
  EvidenceRecord,
  RuleEvaluation,
} from "./types";

export const evidenceRegistry: EvidenceRecord[] = [
  {
    sourceId: "R1",
    agency: "內政部國土管理署",
    policyName:
      "三百億元中央擴大租金補貼專案計畫作業規定（115年度申請案適用 115.1.9 修正版）",
    // Current official regulation page (full amendment history). Its 第十六點 states that cases
    // applied for by 115/12/31 follow the 115.1.9 version; the 115.10.6 amendment applies only to
    // old households carried into 116. Encoded 115 amounts / multipliers / thresholds were
    // re-checked against the 115.1.9 Gazette tables and the MOI programme page on 2026-11-17.
    url:
      "https://www.nlma.gov.tw/ch/legislation/law%26regu/6670",
    lastVerifiedAt: "2026-11-17",
    policyVersion: "CENTRAL-RENT-115（國署住字第1151002186號令，115.1.9 修正發布，自115.1.1生效）",
    supersedes:
      "原證據連結為地方政府網站轉載之作業規定 PDF，已失效（HTTP 404，2026-11-17 查核）；改以中央主辦機關原始來源為準",
    supportingReferences: [
      {
        label: "行政院公報 第032卷第006期（2026-01-09）國署住字第1151002186號令",
        url: "https://gazette.nat.gov.tw/EG_FileManager/eguploadpub/eg032006/ch02/type2/gov10/num2/Eg.htm",
      },
      {
        label: "內政部不動產資訊平台：115年度300億元中央擴大租金補貼專區",
        url: "https://pip.moi.gov.tw/Publicize/Info/B1020",
      },
    ],
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
      "116年度新北市青年租金補貼（新北城住字第1151855676號公告）",
    url:
      "https://www.planning.ntpc.gov.tw/uploaddowndoc?file=planningapply/202610010829240.pdf&filedisplay=115%E5%B9%B49%E6%9C%8823%E6%97%A5%E6%96%B0%E5%8C%97%E5%9F%8E%E4%BD%8F%E5%AD%97%E7%AC%AC1151855676%E8%99%9F%E5%85%AC%E5%91%8A.pdf&flag=doc",
    lastVerifiedAt: "2026-11-16",
    policyVersion: "NTPC-YOUTH-RENT-116",
    supersedes:
      "115年度新北市青年租金補貼（114/10/1 起受理）；依新北城住字第1151855676號公告於 115/10/1 廢止並停止受理",
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
      "115年度300億元中央擴大租金補貼－桃園市受理說明（桃園市政府住宅發展及都市更新處公告）",
    // Program-specific 115 notice from the Taoyuan housing office (金額 2,400–5,000 元、申請／查詢方式、
    // 諮詢專線). Eligibility rules themselves are the central 作業規定 (R1).
    url:
      "https://ohd.tycg.gov.tw/News_Content.aspx?n=8601&s=1601436",
    lastVerifiedAt: "2026-11-17",
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
