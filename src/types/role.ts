
export const ROLES = ["admin", "superadmin", "manager", "counsellor", "telecaller", "developer", "tech_support", "front_desk", "marketing_head","cx","binding","application","branchmanager"] as const;

export type Role = typeof ROLES[number];

export const isRole = (value: unknown): value is Role => {
  return typeof value === "string" && ROLES.includes(value as Role);
};