import {
  detectConflicts,
  syntheticConflictClaims,
} from "./conflict";

console.log(
  "\n=== GovAid Atlas Rule Conflict Test ===\n"
);

console.log(
  "⚠️ Synthetic test only"
);

console.log(
  "不代表任何真實政府政策存在矛盾。\n"
);

const result =
  detectConflicts(
    syntheticConflictClaims
  );

console.log(
  "Status:",
  result.status
);

console.log(
  "Resolution:",
  result.resolution
);

console.log(
  "Reason:",
  result.reason
);

for (
  const conflict of
    result.conflicts
) {
  console.log(
    `\nConflict Key: ${conflict.semanticKey}`
  );

  console.table(
    conflict.claims.map(
      (claim) => ({
        source:
          claim.sourceLabel,
        version:
          claim.version,
        value:
          claim.value,
      })
    )
  );
}