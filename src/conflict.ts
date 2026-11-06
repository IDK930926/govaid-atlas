export type ConflictClaim = {
  claimId: string;
  semanticKey: string;

  value:
    | string
    | number
    | boolean;

  sourceId: string;
  sourceLabel: string;
  version: string;

  synthetic: boolean;
};

export type ConflictGroup = {
  semanticKey: string;
  claims: ConflictClaim[];
  distinctValues: Array<
    string | number | boolean
  >;
};

export type ConflictCheckResult = {
  status:
    | "CLEAR"
    | "CONFLICT";

  conflicts: ConflictGroup[];

  resolution:
    | "CONTINUE"
    | "HUMAN_REVIEW_REQUIRED";

  reason: string;
};

function normalizeValue(
  value:
    | string
    | number
    | boolean
): string {
  return `${typeof value}:${String(value)}`;
}

export function detectConflicts(
  claims: ConflictClaim[]
): ConflictCheckResult {
  const grouped =
    new Map<
      string,
      ConflictClaim[]
    >();

  for (const claim of claims) {
    const existing =
      grouped.get(
        claim.semanticKey
      ) ?? [];

    existing.push(claim);

    grouped.set(
      claim.semanticKey,
      existing
    );
  }

  const conflicts: ConflictGroup[] =
    [];

  for (
    const [
      semanticKey,
      groupedClaims,
    ] of grouped
  ) {
    const values =
      new Map<
        string,
        string | number | boolean
      >();

    for (
      const claim of groupedClaims
    ) {
      values.set(
        normalizeValue(
          claim.value
        ),
        claim.value
      );
    }

    if (values.size > 1) {
      conflicts.push({
        semanticKey,
        claims: groupedClaims,
        distinctValues:
          [...values.values()],
      });
    }
  }

  if (conflicts.length > 0) {
    return {
      status: "CONFLICT",
      conflicts,

      resolution:
        "HUMAN_REVIEW_REQUIRED",

      reason:
        "同一政策語意出現互相矛盾的規則結果，系統禁止自動選擇其中之一。",
    };
  }

  return {
    status: "CLEAR",
    conflicts: [],

    resolution: "CONTINUE",

    reason:
      "未偵測到互相矛盾的規則結果。",
  };
}

// -----------------------------
// Synthetic Conflict Test
// 注意：以下資料純粹用於驗證 Conflict 機制，
// 不代表任何真實政府政策存在矛盾。
// -----------------------------

export const syntheticConflictClaims:
  ConflictClaim[] = [
  {
    claimId: "SYN-CONFLICT-A",
    semanticKey:
      "synthetic.localAddOnEligibility",

    value: "ALLOW",

    sourceId:
      "SYNTHETIC-A",

    sourceLabel:
      "合成測試來源 A",

    version: "TEST-V1",

    synthetic: true,
  },

  {
    claimId: "SYN-CONFLICT-B",
    semanticKey:
      "synthetic.localAddOnEligibility",

    value: "DENY",

    sourceId:
      "SYNTHETIC-B",

    sourceLabel:
      "合成測試來源 B",

    version: "TEST-V2",

    synthetic: true,
  },
];