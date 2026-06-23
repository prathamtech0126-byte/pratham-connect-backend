import type { OpsDashboardFilter } from "../constants/opsDashboard.constants";
import {
  isValidDateStr,
  resolveReportDateRange,
  type ReportDateRange,
} from "./reportDateRange";

export type OpsDashboardScope =
  | { mode: "workload" }
  | { mode: "period"; period: ReportDateRange };

const activityFilters = ["today", "weekly", "monthly", "custom"] as const;

type ActivityFilter = (typeof activityFilters)[number];

const isActivityFilter = (filter: OpsDashboardFilter): filter is ActivityFilter =>
  (activityFilters as readonly string[]).includes(filter);

export const resolveOpsDashboardScope = (
  filter: OpsDashboardFilter,
  fromDate?: string,
  toDate?: string
): OpsDashboardScope => {
  if (filter === "workload") {
    return { mode: "workload" };
  }

  if (!isActivityFilter(filter)) {
    throw new Error(`Invalid ops dashboard filter: ${filter}`);
  }

  return {
    mode: "period",
    period: resolveReportDateRange(filter, fromDate, toDate),
  };
};

/** Handoffs completed always use the current calendar month when viewing workload. */
export const resolveHandoffPeriod = (
  scope: OpsDashboardScope
): ReportDateRange =>
  scope.mode === "workload"
    ? resolveReportDateRange("monthly")
    : scope.period;

export { isValidDateStr };
