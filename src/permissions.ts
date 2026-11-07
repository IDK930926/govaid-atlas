export type UserRole =
  | "APPLICANT"
  | "REVIEWER"
  | "POLICY_ADMIN";

export type SensitiveProfile = {
  name: string;
  nationalId: string;
  phone: string;
  monthlyIncome: number;
};

export type PermissionResult = {
  allowed: boolean;
  masked: boolean;
  reason: string;
};

export function canViewSensitiveProfile(
  role: UserRole
): PermissionResult {
  switch (role) {
    case "APPLICANT":
      return {
        allowed: true,
        masked: false,
        reason:
          "申請人可查看自己的完整資料。",
      };

    case "REVIEWER":
      return {
        allowed: true,
        masked: true,
        reason:
          "審查角色僅可查看遮罩後資料。",
      };

    case "POLICY_ADMIN":
      return {
        allowed: false,
        masked: true,
        reason:
          "政策管理角色無權存取申請人敏感資料。",
      };
  }
}

export function maskNationalId(
  value: string
): string {
  if (value.length < 5) {
    return "••••";
  }

  return (
    value.slice(0, 3) +
    "•••••" +
    value.slice(-2)
  );
}

export function maskPhone(
  value: string
): string {
  if (value.length < 6) {
    return "••••••";
  }

  return (
    value.slice(0, 4) +
    "•••" +
    value.slice(-3)
  );
}

export function getVisibleProfile(
  role: UserRole,
  profile: SensitiveProfile
) {
  const permission =
    canViewSensitiveProfile(role);

  if (!permission.allowed) {
    return {
      permission,
      profile: null,
    };
  }

  if (!permission.masked) {
    return {
      permission,
      profile,
    };
  }

  return {
    permission,
    profile: {
      ...profile,

      nationalId:
        maskNationalId(
          profile.nationalId
        ),

      phone:
        maskPhone(
          profile.phone
        ),

      monthlyIncome:
        "已遮罩",
    },
  };
}