import type { Role } from "../../../types/role";

/** Roles allowed to view the backend ops dashboard. */
export const BACKEND_DASHBOARD_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "branchmanager",
] as const satisfies readonly Role[];

export type BackendDashboardFilter = "today" | "weekly" | "monthly" | "custom";

export const BACKEND_DASHBOARD_FILTERS: readonly BackendDashboardFilter[] = [
  "today",
  "weekly",
  "monthly",
  "custom",
];

export const BACKEND_OPS_ROLES = ["cx", "binding", "application"] as const;

export const BACKEND_TEAM_LABELS: Record<
  (typeof BACKEND_OPS_ROLES)[number],
  string
> = {
  cx: "CX",
  binding: "Binding",
  application: "Application",
};
