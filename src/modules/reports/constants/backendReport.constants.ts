import type { Role } from "../../../types/role";
import {
  REASON_OF_TRAVEL_LABELS,
  SPONSOR_RELATIONSHIP_LABELS,
} from "../../visaCase/constants/visaCase.constants";

/** Roles allowed to view the backend analytics report. */
export const BACKEND_REPORT_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "branchmanager",
] as const satisfies readonly Role[];

export type BackendReportFilter = "today" | "weekly" | "monthly" | "custom";

export const BACKEND_REPORT_FILTERS: readonly BackendReportFilter[] = [
  "today",
  "weekly",
  "monthly",
  "custom",
];

/** Destination countries shown in fixed order on the report UI. */
export const BACKEND_REPORT_DESTINATIONS = [
  "Canada",
  "UK",
  "USA",
  "Australia",
  "Schengen",
  "South Korea",
  "Japan",
] as const;

/** Map modules DB country names onto report preset labels. */
export const BACKEND_REPORT_DESTINATION_ALIASES: Record<
  string,
  (typeof BACKEND_REPORT_DESTINATIONS)[number]
> = {
  "United Kingdom": "UK",
  "United States": "USA",
  Germany: "Schengen",
  Finland: "Schengen",
};

export const BACKEND_REPORT_TRAVEL_REASONS = Object.entries(
  REASON_OF_TRAVEL_LABELS
).map(([key, label]) => ({ key, label }));

export const BACKEND_REPORT_SPONSOR_TYPES = Object.entries(
  SPONSOR_RELATIONSHIP_LABELS
).map(([key, label]) => ({ key, label }));
