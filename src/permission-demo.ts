import {
  getVisibleProfile,
  type SensitiveProfile,
  type UserRole,
} from "./permissions";

const syntheticProfile:
  SensitiveProfile = {
  name: "陳同學",
  nationalId: "A123456789",
  phone: "0912345678",
  monthlyIncome: 32000,
};

const roles: UserRole[] = [
  "APPLICANT",
  "REVIEWER",
  "POLICY_ADMIN",
];

console.log(
  "\n=== GovAid Atlas Permission Test ===\n"
);

console.log(
  "⚠️ Synthetic data only\n"
);

for (const role of roles) {
  const result =
    getVisibleProfile(
      role,
      syntheticProfile
    );

  console.log(`\nRole: ${role}`);
  console.log(
    "Allowed:",
    result.permission.allowed
  );

  console.log(
    "Masked:",
    result.permission.masked
  );

  console.log(
    "Reason:",
    result.permission.reason
  );

  console.log(
    "Visible Profile:",
    result.profile
  );
}