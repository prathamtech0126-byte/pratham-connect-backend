import type { Role } from "../../../types/role";
import {
  CX_DOC_REJECTION_REASONS,
  CX_REPORT_FILTERS,
  CX_REPORT_LIFECYCLE_STAGES,
  CX_REPORT_ROLES,
  CX_TAT_BREACH_DAYS,
  CX_TAT_SAFE_DAYS,
  CX_TAT_WARNING_DAYS,
  type CxReportFilter,
} from "../constants/cxReport.constants";
import {
  fetchCxReportAggregates,
  fetchCxReportTasksCompleted,
} from "../models/cxReport.model";
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

export type CxReportInput = {
  filter: CxReportFilter;
  fromDate?: string;
  toDate?: string;
};

const parseCount = (value: string | undefined | null): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const formatDelta = (current: number, previous: number): number =>
  current - previous;

const formatRate = (numerator: number, denominator: number): number | null => {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
};

const formatHours = (value: string | null): string | null => {
  if (!value) return null;
  const hours = Number.parseFloat(value);
  if (Number.isNaN(hours)) return null;
  return `${hours} hrs`;
};

const assertCxRole = (role: Role): void => {
  if (
    role !== "developer" &&
    !(CX_REPORT_ROLES as readonly string[]).includes(role)
  ) {
    throw new Error(
      "Forbidden: CX report is only available for cx and developer roles"
    );
  }
};

const buildPeriodMeta = (
  filter: CxReportFilter,
  period: ReportDateRange
) => ({
  filter,
  fromDate: period.fromDate,
  toDate: period.toDate,
  description:
    "Performance metrics use activity in the selected period; stage progress reflects clients currently assigned to you or previously handled by you.",
});

const buildSummaryCards = (input: {
  tasksCompleted: number;
  tasksCompletedDelta: number;
  docsReviewed: number;
  docsPending: number;
  tatWarnings: number;
  tatBreaches: number;
  completionRate: number | null;
  completionRateDelta: number | null;
}) => ({
  tasksCompleted: {
    value: input.tasksCompleted,
    trend: {
      direction:
        input.tasksCompletedDelta > 0
          ? ("up" as const)
          : input.tasksCompletedDelta < 0
            ? ("down" as const)
            : ("flat" as const),
      delta: input.tasksCompletedDelta,
      label: `${input.tasksCompletedDelta >= 0 ? "+" : ""}${input.tasksCompletedDelta} vs last period`,
    },
  },
  docsReviewed: {
    value: input.docsReviewed,
    pending: input.docsPending,
    subtitle:
      input.docsPending > 0 ? `${input.docsPending} pending` : "No pending reviews",
  },
  tatWarnings: {
    value: input.tatWarnings,
    breaches: input.tatBreaches,
    subtitle:
      input.tatBreaches > 0
        ? `${input.tatBreaches} breach${input.tatBreaches === 1 ? "" : "es"}`
        : "No breaches",
    alert: input.tatBreaches > 0 || input.tatWarnings > 0,
  },
  completionRate: {
    value: input.completionRate,
    display:
      input.completionRate === null ? null : `${input.completionRate.toFixed(0)}%`,
    trend:
      input.completionRateDelta === null
        ? null
        : {
            direction:
              input.completionRateDelta > 0
                ? ("up" as const)
                : input.completionRateDelta < 0
                  ? ("down" as const)
                  : ("flat" as const),
            delta: input.completionRateDelta,
            label: `${input.completionRateDelta >= 0 ? "+" : ""}${input.completionRateDelta.toFixed(0)}% vs last period`,
          },
  },
});

const buildCompletionTrend = (
  period: ReportDateRange,
  rows: Array<{ day: string; completed: string; overdue: string }>
) => {
  const rowByDay = new Map(rows.map((row) => [row.day, row]));

  return enumerateDateRange(period).map((day) => {
    const row = rowByDay.get(day);
    return {
      date: day,
      dayLabel: dayLabelForDate(day),
      completed: parseCount(row?.completed),
      overdue: parseCount(row?.overdue),
    };
  });
};

const buildTatHealth = (row: {
  safe: string;
  warning: string;
  breach: string;
  total: string;
}) => {
  const safe = parseCount(row.safe);
  const warning = parseCount(row.warning);
  const breach = parseCount(row.breach);
  const total = parseCount(row.total);

  return {
    totalClients: total,
    byRiskLevel: [
      { level: "safe", label: "Safe", count: safe, color: "green" },
      { level: "warning", label: "Warning", count: warning, color: "orange" },
      { level: "breach", label: "Breach", count: breach, color: "red" },
    ],
    summary: {
      escalated: breach,
      onTrack: safe,
    },
    thresholds: {
      safeDays: CX_TAT_SAFE_DAYS,
      warningDays: CX_TAT_WARNING_DAYS,
      breachDays: CX_TAT_BREACH_DAYS,
    },
  };
};

const buildStageProgress = (
  rows: Array<{ lifecycle_key: string; count: string }>
) => {
  const countByKey = new Map(
    rows.map((row) => [row.lifecycle_key, parseCount(row.count)])
  );

  return CX_REPORT_LIFECYCLE_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    count: countByKey.get(stage.key) ?? 0,
  }));
};

const buildDocumentStats = (input: {
  outcomes: {
    approved: string;
    rejected: string;
    pending_review: string;
    reupload_requested: string;
  };
  avgTurnaroundHours: string | null;
  rejectionReasons: Array<{ reason_key: string; count: string }>;
}) => {
  const approved = parseCount(input.outcomes.approved);
  const rejected = parseCount(input.outcomes.rejected);
  const pendingReview = parseCount(input.outcomes.pending_review);
  const reuploadRequested = parseCount(input.outcomes.reupload_requested);
  const reviewedTotal = approved + rejected;

  const reasonCountByKey = new Map(
    input.rejectionReasons.map((row) => [row.reason_key, parseCount(row.count)])
  );

  return {
    outcomeBreakdown: [
      { key: "approved", label: "Approved", count: approved, color: "green" },
      { key: "rejected", label: "Rejected", count: rejected, color: "red" },
      {
        key: "pending_review",
        label: "Pending review",
        count: pendingReview,
        color: "yellow",
      },
      {
        key: "reupload_requested",
        label: "Reupload requested",
        count: reuploadRequested,
        color: "orange",
      },
    ],
    reviewRate: {
      approvalRate: formatRate(approved, reviewedTotal),
      approvalRateDisplay:
        reviewedTotal > 0
          ? `${formatRate(approved, reviewedTotal)?.toFixed(0)}%`
          : null,
      subtitle: "Approval rate this period",
      avgTurnaround: formatHours(input.avgTurnaroundHours),
    },
    rejectionReasons: CX_DOC_REJECTION_REASONS.map((reason) => ({
      key: reason.key,
      label: reason.label,
      count: reasonCountByKey.get(reason.key) ?? 0,
    })).filter((reason) => reason.count > 0),
  };
};

export const getCxReport = async (
  viewer: ViewerContext,
  input: CxReportInput
) => {
  assertCxRole(viewer.role);

  const period = resolveReportDateRange(
    input.filter,
    input.fromDate,
    input.toDate
  );
  const previousPeriod = resolvePreviousReportPeriod(period);

  const [raw, previousTasksCompleted] = await Promise.all([
      fetchCxReportAggregates({ userId: viewer.userId, period }),
      fetchCxReportTasksCompleted(viewer.userId, previousPeriod),
    ]);

  const tasksCompleted = parseCount(raw.performance.tasks_completed);
  const docsReviewed = parseCount(raw.performance.docs_reviewed);
  const docsPending = parseCount(raw.performance.docs_pending);
  const tatWarnings = parseCount(raw.performance.tat_warnings);
  const tatBreaches = parseCount(raw.performance.tat_breaches);
  const overdueTasks = parseCount(raw.performance.overdue_tasks);

  const currentCompletionRate = formatRate(
    tasksCompleted,
    tasksCompleted + overdueTasks
  );
  const previousCompletionRate = formatRate(
    previousTasksCompleted,
    previousTasksCompleted + overdueTasks
  );

  const completionRateDelta =
    currentCompletionRate !== null && previousCompletionRate !== null
      ? Math.round((currentCompletionRate - previousCompletionRate) * 10) / 10
      : null;

  return {
    meta: {
      title: "My Report",
      team: "cx",
      teamLabel: "CX Team",
      scope: "assigned_to_me" as const,
      viewerRole: viewer.role,
      generatedAt: new Date().toISOString(),
      availableFilters: [...CX_REPORT_FILTERS],
      period: buildPeriodMeta(input.filter, period),
      previousPeriod,
    },
    performanceSummary: buildSummaryCards({
      tasksCompleted,
      tasksCompletedDelta: formatDelta(tasksCompleted, previousTasksCompleted),
      docsReviewed,
      docsPending,
      tatWarnings,
      tatBreaches,
      completionRate: currentCompletionRate,
      completionRateDelta,
    }),
    completionTrend: buildCompletionTrend(period, raw.dailyCompletion),
    tatHealth: buildTatHealth(raw.tatHealth),
    stageProgress: buildStageProgress(raw.stageProgress),
    documentStats: buildDocumentStats({
      outcomes: raw.documentOutcomes,
      avgTurnaroundHours: raw.documentTiming.avg_turnaround_hours,
      rejectionReasons: raw.rejectionReasons,
    }),
  };
};
