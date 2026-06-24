import type { Role } from "../../../types/role";
import {
  fetchEnrollmentTrendEarliestMonth,
  fetchEnrollmentTrendRows,
} from "../../visaCase/models/visaCaseDashboard.model";
import {
  ENROLLMENT_TREND_MONTH_BUCKETS,
  ENROLLMENT_TREND_RANGE_LABELS,
  ENROLLMENT_TREND_RANGES,
  type EnrollmentTrendRange,
} from "../constants/enrollmentTrend.constants";

type ViewerContext = {
  userId: number;
  role: Role;
};

export type EnrollmentTrendInput = {
  range: EnrollmentTrendRange;
  branchCode?: string;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

const parseCount = (value: string | undefined): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const enumerateRollingMonths = (
  count: number
): Array<{ bucketKey: string; label: string }> => {
  const months: Array<{ bucketKey: string; label: string }> = [];
  const now = new Date();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const bucketKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    months.push({ bucketKey, label });
  }

  return months;
};

const enumerateMonthsFromBucketKey = (
  startBucketKey: string
): Array<{ bucketKey: string; label: string }> => {
  const [startYear, startMonth] = startBucketKey.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, 1);
  const end = new Date();
  end.setDate(1);
  const months: Array<{ bucketKey: string; label: string }> = [];

  while (cursor.getTime() <= end.getTime()) {
    const bucketKey = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`;
    const label = cursor.toLocaleString("en-US", {
      month: "short",
      year: "numeric",
    });
    months.push({ bucketKey, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
};

const buildTrendSeries = (
  rows: Array<{ bucket_key: string; month_label: string; enrollments: string }>,
  buckets: Array<{ bucketKey: string; label: string }>
) => {
  const countByBucket = new Map(
    rows.map((row) => [row.bucket_key, parseCount(row.enrollments)])
  );

  return buckets.map(({ bucketKey, label }) => ({
    month: label,
    enrollments: countByBucket.get(bucketKey) ?? 0,
  }));
};

export const getEnrollmentTrend = async (
  viewer: ViewerContext,
  input: EnrollmentTrendInput
) => {
  const monthBuckets =
    input.range === "maximum"
      ? null
      : ENROLLMENT_TREND_MONTH_BUCKETS[input.range];

  const rows = await fetchEnrollmentTrendRows({
    branchCode: input.branchCode,
    range: input.range,
    monthBuckets: monthBuckets ?? undefined,
  });

  let buckets: Array<{ bucketKey: string; label: string }>;

  if (input.range === "maximum") {
    const earliest =
      (await fetchEnrollmentTrendEarliestMonth(input.branchCode)) ??
      rows[0]?.bucket_key ??
      `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`;
    buckets = enumerateMonthsFromBucketKey(earliest);
  } else {
    buckets = enumerateRollingMonths(monthBuckets!);
  }

  const trend = buildTrendSeries(rows, buckets);
  const totalEnrollments = trend.reduce((sum, row) => sum + row.enrollments, 0);

  return {
    meta: {
      title: "Enrollment Trend",
      viewerRole: viewer.role,
      generatedAt: new Date().toISOString(),
      range: input.range,
      rangeLabel: ENROLLMENT_TREND_RANGE_LABELS[input.range],
      granularity: "month" as const,
      branchCode: input.branchCode ?? null,
      availableRanges: [...ENROLLMENT_TREND_RANGES],
      bucketCount: trend.length,
      totalEnrollments,
    },
    enrollmentTrend: trend,
  };
};
