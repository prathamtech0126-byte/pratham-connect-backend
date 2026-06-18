import type { Role } from "../../../types/role";
import {
  BINDING_REPORT_FILTERS,
  BINDING_REPORT_ROLES,
  BINDING_TAT_BREACH_DAYS,
  BINDING_TAT_SAFE_DAYS,
  BINDING_TAT_WARNING_DAYS,
  BINDING_VISA_APPLICATION_STATUS_BUCKETS,
  type BindingReportFilter,
} from "../constants/bindingReport.constants";
import {
  fetchBindingReportAggregates,
  fetchBindingReportFilesBound,
} from "../models/bindingReport.model";
import {
  dayLabelForDate,
  enumerateDateRange,
  resolvePreviousReportPeriod,
  resolveReportDateRange,
  type ReportDateRange,
} from "../utils/reportDateRange";

type ViewerContext = {
  userId: number;
  role: Role;
};

export type BindingReportInput = {
  filter: BindingReportFilter;
  fromDate?: string;
  toDate?: string;
};

const parseCount = (value: string | undefined | null): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const parseDecimal = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatRate = (numerator: number, denominator: number): number | null => {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
};

const formatPercentTrend = (
  current: number,
  previous: number
): {
  direction: "up" | "down" | "flat";
  deltaPercent: number | null;
  label: string;
} => {
  if (previous <= 0) {
    return {
      direction: current > 0 ? "up" : "flat",
      deltaPercent: null,
      label: current > 0 ? "New this period" : "No change vs last period",
    };
  }

  const deltaPercent =
    Math.round(((current - previous) / previous) * 1000) / 10;
  const sign = deltaPercent >= 0 ? "+" : "";

  return {
    direction:
      deltaPercent > 0 ? "up" : deltaPercent < 0 ? "down" : "flat",
    deltaPercent,
    label: `${sign}${deltaPercent}% vs prev`,
  };
};

const assertBindingRole = (role: Role): void => {
  if (
    role !== "developer" &&
    !(BINDING_REPORT_ROLES as readonly string[]).includes(role)
  ) {
    throw new Error(
      "Forbidden: Binding report is only available for binding and developer roles"
    );
  }
};

const buildPeriodMeta = (
  filter: BindingReportFilter,
  period: ReportDateRange
) => ({
  filter,
  fromDate: period.fromDate,
  toDate: period.toDate,
  description:
    "Performance metrics use activity in the selected period; caseload and TAT breach rate reflect your current binding assignments.",
});

const buildPerformanceSummary = (input: {
  filesBound: number;
  filesBoundTrend: ReturnType<typeof formatPercentTrend>;
  avgDaysInBinding: number | null;
  docCompletenessRate: number | null;
  tatBreachRate: number | null;
}) => ({
  filesBound: {
    value: input.filesBound,
    trend: input.filesBoundTrend,
  },
  avgDaysInBinding: {
    value: input.avgDaysInBinding,
    subtitle: "days per file",
  },
  docCompletenessAtHandoff: {
    value: input.docCompletenessRate,
    display:
      input.docCompletenessRate === null
        ? null
        : `${Math.round(input.docCompletenessRate)}%`,
  },
  tatBreachRate: {
    value: input.tatBreachRate,
    display:
      input.tatBreachRate === null
        ? null
        : `${Math.round(input.tatBreachRate)}%`,
    subtitle: "of assigned clients",
  },
});

const buildFilesBoundVsBlocked = (
  period: ReportDateRange,
  rows: Array<{ day: string; bound: string; blocked: string }>
) => {
  const rowByDay = new Map(rows.map((row) => [row.day, row]));

  return enumerateDateRange(period).map((day) => {
    const row = rowByDay.get(day);
    return {
      date: day,
      dayLabel: dayLabelForDate(day),
      bound: parseCount(row?.bound),
      blocked: parseCount(row?.blocked),
    };
  });
};

const buildVisaApplicationStatus = (
  rows: Array<{ status_key: string; count: string }>
) => {
  const countByKey = new Map(
    rows.map((row) => [row.status_key, parseCount(row.count)])
  );

  return BINDING_VISA_APPLICATION_STATUS_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: countByKey.get(bucket.key) ?? 0,
    color: bucket.color,
  }));
};

const buildTatHealthTrend = (
  period: ReportDateRange,
  rows: Array<{ day: string; on_track: string; warning: string; breach: string }>
) => {
  const rowByDay = new Map(rows.map((row) => [row.day, row]));

  return enumerateDateRange(period).map((day) => {
    const row = rowByDay.get(day);
    return {
      date: day,
      dayLabel: dayLabelForDate(day),
      onTrack: parseCount(row?.on_track),
      warning: parseCount(row?.warning),
      breach: parseCount(row?.breach),
    };
  });
};

export const getBindingReport = async (
  viewer: ViewerContext,
  input: BindingReportInput
) => {
  assertBindingRole(viewer.role);

  const period = resolveReportDateRange(
    input.filter,
    input.fromDate,
    input.toDate
  );
  const previousPeriod = resolvePreviousReportPeriod(period);

  const [raw, previousFilesBound] = await Promise.all([
    fetchBindingReportAggregates({ userId: viewer.userId, period }),
    fetchBindingReportFilesBound(viewer.userId, previousPeriod),
  ]);

  const filesBound = parseCount(raw.filesBound.files_bound);
  const avgDaysInBinding = parseDecimal(raw.avgDaysInBinding.avg_days);
  const docComplete = parseCount(raw.docCompleteness.complete);
  const docTotal = parseCount(raw.docCompleteness.total);
  const tatBreach = parseCount(raw.tatBreach.breach);
  const tatTotal = parseCount(raw.tatBreach.total);

  return {
    meta: {
      title: "My Report",
      team: "binding" as const,
      teamLabel: "Binding Team",
      scope: "assigned_to_me" as const,
      viewerRole: viewer.role,
      generatedAt: new Date().toISOString(),
      availableFilters: [...BINDING_REPORT_FILTERS],
      period: buildPeriodMeta(input.filter, period),
      previousPeriod,
      tatThresholds: {
        safeDays: BINDING_TAT_SAFE_DAYS,
        warningDays: BINDING_TAT_WARNING_DAYS,
        breachDays: BINDING_TAT_BREACH_DAYS,
      },
    },
    performanceSummary: buildPerformanceSummary({
      filesBound,
      filesBoundTrend: formatPercentTrend(filesBound, previousFilesBound),
      avgDaysInBinding,
      docCompletenessRate: formatRate(docComplete, docTotal),
      tatBreachRate: formatRate(tatBreach, tatTotal),
    }),
    filesBoundVsBlocked: buildFilesBoundVsBlocked(
      period,
      raw.dailyBoundBlocked
    ),
    visaApplicationStatus: buildVisaApplicationStatus(
      raw.visaApplicationStatus
    ),
    tatHealthTrend: buildTatHealthTrend(period, raw.dailyTatHealth),
  };
};
