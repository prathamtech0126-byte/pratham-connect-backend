import type { Role } from "../../../types/role";
import { BACKEND_REPORT_ROLES } from "./backendReport.constants";

/** Roles allowed to view enrollment trend analytics. */
export const ENROLLMENT_TREND_ROLES = BACKEND_REPORT_ROLES;

export const ENROLLMENT_TREND_RANGES = [
  "6_month",
  "12_month",
  "maximum",
] as const;

export type EnrollmentTrendRange = (typeof ENROLLMENT_TREND_RANGES)[number];

export const ENROLLMENT_TREND_RANGE_LABELS: Record<
  EnrollmentTrendRange,
  string
> = {
  "6_month": "Last 6 months",
  "12_month": "Last 12 months",
  maximum: "All time",
};

export const ENROLLMENT_TREND_MONTH_BUCKETS: Record<
  Exclude<EnrollmentTrendRange, "maximum">,
  number
> = {
  "6_month": 6,
  "12_month": 12,
};

export const isEnrollmentTrendRole = (role: Role): boolean =>
  role === "developer" ||
  (ENROLLMENT_TREND_ROLES as readonly string[]).includes(role);
