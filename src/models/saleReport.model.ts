import {
  getReportScope,
  type ReportScopeOptions,
  type ReportUserRole,
  type ReportDateRange,
} from "./report.model";
import {
  getCounsellorEnrollmentCountByEnrollmentDate,
} from "./leaderboard.model";
import {
  getCoreServiceCount,
  getCoreSaleAmount,
  getCoreProductMetrics,
  getOtherProductMetrics,
} from "./dashboard.model";
import { getAllSaleTypes } from "./saleType.model";
import { db, pool } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export type SaleReportFilter = "today" | "weekly" | "monthly" | "yearly" | "custom";

export type SaleMetric =
  | "client"
  | "core_sale"
  | "core_product"
  | "other_product"
  | "overall_revenue";

export interface SaleMetricSeriesPoint {
  label: string;
  current: { count: number; amount: number };
  previous: { count: number; amount: number };
  previous2: { count: number; amount: number };
}

export interface SaleMetricSeriesResult {
  filter: {
    type: SaleReportFilter;
    start_date: string;
    end_date: string;
  };
  metric: SaleMetric;
  series: SaleMetricSeriesPoint[]; // [current, previous, previous2]
}

export interface SaleReportDashboardResult {
  filter: {
    type: SaleReportFilter;
    start_date: string;
    end_date: string;
  };
  cards: {
    core_sale: { count: number; amount: number };
    core_product: { count: number; amount: number };
    other_product: { count: number; amount: number };
    overall_revenue: number;
    current_month_revenue: number;
    previous_month_revenue: number;
    previous_to_previous_month_revenue: number;
  };
  sale_type_category_counts: Array<{
    category_id: number | null;
    category_name: string;
    count: number;
    amount: string;
    sale_types: Array<{
      sale_type_id: number;
      sale_type_name: string;
      count: number;
      amount: string;
    }>;
  }>;
  other_product_breakdown: Array<{
    key: string;
    name: string;
    count: number;
    amount: string;
  }>;
  charts: {
    line: Array<{
      name: string;
      core_sale: number;
      core_product: number;
      other_product: number;
      overall_revenue: number;
    }>;
    bar: Array<{
      name: string;
      core_sale: number;
      core_product: number;
      other_product: number;
      overall_revenue: number;
    }>;
  };
}

const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);

const getSaleReportDateRange = (
  filter: SaleReportFilter,
  beforeDate?: string,
  afterDate?: string
): ReportDateRange => {
  const now = new Date();
  switch (filter) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "weekly": {
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: startOfDay(monday), end: endOfDay(sunday) };
    }
    case "monthly":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "yearly":
      return {
        start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      };
    case "custom":
      if (!beforeDate || !afterDate) throw new Error("beforeDate and afterDate are required for custom filter");
      return {
        start: startOfDay(new Date(beforeDate)),
        end: endOfDay(new Date(afterDate)),
      };
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
};

const shiftRangeByDays = (range: ReportDateRange, days: number): ReportDateRange => {
  const start = new Date(range.start);
  const end = new Date(range.end);
  start.setDate(start.getDate() + days);
  end.setDate(end.getDate() + days);
  return { start, end };
};

const getComparisonRanges = (
  filter: SaleReportFilter,
  dateRange: ReportDateRange
): { current: ReportDateRange; previous: ReportDateRange; previous2: ReportDateRange } => {
  if (filter === "today") {
    const current = { start: startOfDay(dateRange.end), end: endOfDay(dateRange.end) };
    const previous = shiftRangeByDays(current, -1);
    const previous2 = shiftRangeByDays(current, -2);
    return { current, previous, previous2 };
  }

  if (filter === "monthly") {
    const currentStart = startOfMonth(dateRange.start);
    const previousStart = startOfMonth(new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1));
    const previous2Start = startOfMonth(new Date(currentStart.getFullYear(), currentStart.getMonth() - 2, 1));
    return {
      current: { start: currentStart, end: endOfMonth(currentStart) },
      previous: { start: previousStart, end: endOfMonth(previousStart) },
      previous2: { start: previous2Start, end: endOfMonth(previous2Start) },
    };
  }

  if (filter === "yearly") {
    const currentStart = startOfYear(dateRange.start);
    const previousStart = startOfYear(new Date(currentStart.getFullYear() - 1, 0, 1));
    const previous2Start = startOfYear(new Date(currentStart.getFullYear() - 2, 0, 1));
    return {
      current: { start: currentStart, end: endOfYear(currentStart) },
      previous: { start: previousStart, end: endOfYear(previousStart) },
      previous2: { start: previous2Start, end: endOfYear(previous2Start) },
    };
  }

  if (filter === "weekly") {
    const durationDays = Math.max(1, Math.floor((dateRange.end.getTime() - dateRange.start.getTime()) / 86400000) + 1);
    const current = dateRange;
    const previous = shiftRangeByDays(current, -durationDays);
    const previous2 = shiftRangeByDays(current, -durationDays * 2);
    return { current, previous, previous2 };
  }

  // custom: previous windows of equal duration
  const durationMs = dateRange.end.getTime() - dateRange.start.getTime();
  const previousEnd = new Date(dateRange.start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  const previous2End = new Date(previousStart.getTime() - 1);
  const previous2Start = new Date(previous2End.getTime() - durationMs);
  return {
    current: dateRange,
    previous: { start: previousStart, end: previousEnd },
    previous2: { start: previous2Start, end: previous2End },
  };
};

const formatRangeLabel = (range: ReportDateRange, filter: SaleReportFilter): string => {
  if (filter === "monthly") {
    return range.start.toLocaleString("en-US", { month: "short" });
  }
  if (filter === "yearly") {
    return String(range.start.getFullYear());
  }
  // for today/weekly/custom: show date window
  const s = toDateStr(range.start);
  const e = toDateStr(range.end);
  return s === e ? s : `${s} - ${e}`;
};

const getChartPeriods = (
  filter: SaleReportFilter,
  dateRange: ReportDateRange
): Array<{ name: string; range: ReportDateRange }> => {
  // today/weekly/monthly -> day-wise points in selected filter window
  if (filter === "today" || filter === "weekly" || filter === "monthly") {
    const periods: Array<{ name: string; range: ReportDateRange }> = [];
    const cursor = new Date(dateRange.start);
    while (cursor <= dateRange.end) {
      const d = new Date(cursor);
      periods.push({
        name:
          filter === "weekly"
            ? d.toLocaleString("en-US", { weekday: "short" })
            : `${d.getDate()}`,
        range: { start: startOfDay(d), end: endOfDay(d) },
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return periods;
  }

  if (filter === "yearly") {
    const periods: Array<{ name: string; range: ReportDateRange }> = [];
    for (let m = 0; m < 12; m++) {
      const s = new Date(dateRange.start.getFullYear(), m, 1);
      periods.push({
        name: s.toLocaleString("en-US", { month: "short" }),
        range: { start: startOfMonth(s), end: endOfMonth(s) },
      });
    }
    return periods;
  }

  // custom: adaptive buckets inside selected range
  const days = Math.max(1, Math.floor((dateRange.end.getTime() - dateRange.start.getTime()) / 86400000) + 1);
  const periods: Array<{ name: string; range: ReportDateRange }> = [];
  if (days <= 31) {
    const cursor = new Date(dateRange.start);
    while (cursor <= dateRange.end) {
      const d = new Date(cursor);
      periods.push({ name: `${d.getDate()}`, range: { start: startOfDay(d), end: endOfDay(d) } });
      cursor.setDate(cursor.getDate() + 1);
    }
    return periods;
  }

  if (days <= 180) {
    let cursor = new Date(dateRange.start);
    let idx = 1;
    while (cursor <= dateRange.end) {
      const ws = new Date(cursor);
      const we = new Date(cursor);
      we.setDate(we.getDate() + 6);
      const bounded = we > dateRange.end ? dateRange.end : we;
      periods.push({ name: `W${idx++}`, range: { start: startOfDay(ws), end: endOfDay(bounded) } });
      cursor = new Date(we);
      cursor.setDate(cursor.getDate() + 1);
    }
    return periods;
  }

  let cursor = startOfMonth(dateRange.start);
  while (cursor <= dateRange.end) {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const boundedEnd = monthEnd > dateRange.end ? dateRange.end : monthEnd;
    periods.push({
      name: monthStart.toLocaleString("en-US", { month: "short" }),
      range: { start: monthStart < dateRange.start ? dateRange.start : monthStart, end: boundedEnd },
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return periods;
};

const getScopeSnapshot = async (
  counsellorIds: number[],
  dateRange: ReportDateRange
): Promise<{
  coreSaleCount: number;
  coreSaleAmount: number;
  coreProductCount: number;
  coreProductAmount: number;
  otherProductCount: number;
  otherProductAmount: number;
  overallRevenue: number;
  totalClients: number;
}> => {
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);

  if (counsellorIds.length === 0) {
    return {
      coreSaleCount: 0,
      coreSaleAmount: 0,
      coreProductCount: 0,
      coreProductAmount: 0,
      otherProductCount: 0,
      otherProductAmount: 0,
      overallRevenue: 0,
      totalClients: 0,
    };
  }

  const rows = await Promise.all(
    counsellorIds.map(async (id) => {
      const [coreSaleCount, coreSaleAmount, coreProduct, otherProduct] = await Promise.all([
        getCounsellorEnrollmentCountByEnrollmentDate(id, startStr, endStr),
        getCoreSaleAmount(dateRange, { userRole: "counsellor", userId: id, counsellorId: id }),
        getCoreProductMetrics(dateRange, { userRole: "counsellor", userId: id, counsellorId: id }),
        getOtherProductMetrics(dateRange, { userRole: "counsellor", userId: id, counsellorId: id }),
      ]);
      return { coreSaleCount, coreSaleAmount, coreProduct, otherProduct };
    })
  );

  const coreSaleCount = rows.reduce((s, r) => s + Number(r.coreSaleCount ?? 0), 0);
  const coreSaleAmount = rows.reduce((s, r) => s + Number(r.coreSaleAmount ?? 0), 0);
  const coreProductCount = rows.reduce((s, r) => s + Number(r.coreProduct?.count ?? 0), 0);
  const coreProductAmount = rows.reduce((s, r) => s + Number(r.coreProduct?.amount ?? 0), 0);
  const otherProductCount = rows.reduce((s, r) => s + Number(r.otherProduct?.count ?? 0), 0);
  const otherProductAmount = rows.reduce((s, r) => s + Number(r.otherProduct?.amount ?? 0), 0);
  const overallRevenue = coreSaleAmount + coreProductAmount + otherProductAmount;

  return {
    coreSaleCount,
    coreSaleAmount,
    coreProductCount,
    coreProductAmount,
    otherProductCount,
    otherProductAmount,
    overallRevenue,
    totalClients: coreSaleCount,
  };
};

const getGlobalSnapshotFromDashboard = async (
  dateRange: ReportDateRange
): Promise<{
  coreSaleCount: number;
  coreSaleAmount: number;
  coreProductCount: number;
  coreProductAmount: number;
  otherProductCount: number;
  otherProductAmount: number;
  overallRevenue: number;
  totalClients: number;
}> => {
  const [coreSaleCount, coreSaleAmount, coreProduct, otherProduct] = await Promise.all([
    getCoreServiceCount(dateRange),
    getCoreSaleAmount(dateRange),
    getCoreProductMetrics(dateRange),
    getOtherProductMetrics(dateRange),
  ]);

  const coreProductCount = Number(coreProduct.count ?? 0);
  const coreProductAmount = Number(coreProduct.amount ?? 0);
  const otherProductCount = Number(otherProduct.count ?? 0);
  const otherProductAmount = Number(otherProduct.amount ?? 0);
  const overallRevenue = Number(coreSaleAmount) + coreProductAmount + otherProductAmount;

  return {
    coreSaleCount: Number(coreSaleCount),
    coreSaleAmount: Number(coreSaleAmount),
    coreProductCount,
    coreProductAmount,
    otherProductCount,
    otherProductAmount,
    overallRevenue,
    totalClients: Number(coreSaleCount),
  };
};

// Core sale category + sale type breakdown using the SAME assignment logic as dashboard:
// - clients_in_period: enrollment date in [start,end] + has at least one INITIAL/BEFORE_VISA/AFTER_VISA payment (any date)
// - for each client: pick exactly one "newest" core-sale payment row (AFTER_VISA > BEFORE_VISA > INITIAL, then latest payment_date/created_at)
// - category + sale_type come from that selected row's sale_type.category_id
// - count = number of distinct clients assigned to each (category,sale_type)
// - amount = sum of core-sale payment amounts in [start,end] for those assigned clients
const getCoreSaleCategorySaleTypeBreakdown = async (
  counsellorIds: number[],
  range: ReportDateRange
): Promise<
  Array<{
    category_id: number | null;
    category_name: string;
    sale_type_id: number;
    sale_type_name: string;
    count: number;
    amount: string;
  }>
> => {
  if (counsellorIds.length === 0) return [];

  const startDateStr = toDateStr(range.start);
  const endDateStr = toDateStr(range.end);
  const startTs = range.start.toISOString();
  const endTs = range.end.toISOString();

  // NOTE: pool.query parameters are positional ($1..$N).
  // We pass counsellorIds as a bigint array for ci.counsellor_id filter.
  const query = `
    WITH clients_in_period AS (
      SELECT ci.id AS client_id
      FROM client_information ci
      WHERE ci.archived = false
        AND ci.date >= $1::date
        AND ci.date <= $2::date
        AND ci.counsellor_id = ANY($3::bigint[])
        AND EXISTS (
          SELECT 1
          FROM client_payment cp0
          WHERE cp0.client_id = ci.id
            AND cp0.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
        )
    ),
    eligible_payments AS (
      SELECT
        cp.client_id,
        cp.stage,
        cp.payment_date,
        cp.created_at,
        cp.id AS payment_id,
        st.id AS sale_type_id,
        st.category_id AS category_id
      FROM client_payment cp
      INNER JOIN clients_in_period cip ON cip.client_id = cp.client_id
      INNER JOIN sale_type st ON st.id = cp.sale_type_id
      WHERE cp.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    ),
    ranked AS (
      SELECT
        client_id,
        sale_type_id,
        category_id,
        ROW_NUMBER() OVER (
          PARTITION BY client_id
          ORDER BY
            CASE stage
              WHEN 'AFTER_VISA' THEN 0
              WHEN 'BEFORE_VISA' THEN 1
              WHEN 'INITIAL' THEN 2
              ELSE 3
            END,
            COALESCE(payment_date::timestamp, created_at) DESC NULLS LAST,
            payment_id DESC
        ) AS rn
      FROM eligible_payments
    ),
    assigned AS (
      SELECT client_id, sale_type_id, category_id
      FROM ranked
      WHERE rn = 1
    )
    SELECT
      a.category_id,
      stCat.name AS category_name,
      a.sale_type_id,
      st.sale_type AS sale_type_name,
      COUNT(DISTINCT a.client_id)::int AS cnt,
      COALESCE(SUM(cp.amount::numeric), 0) AS amt
    FROM assigned a
    LEFT JOIN sale_type st ON st.id = a.sale_type_id
    LEFT JOIN sale_type_category stCat ON stCat.id = a.category_id
    LEFT JOIN client_payment cp
      ON cp.client_id = a.client_id
      AND cp.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
      AND (
        (cp.payment_date IS NOT NULL AND cp.payment_date >= $1::date AND cp.payment_date <= $2::date)
        OR (cp.payment_date IS NULL AND cp.created_at >= $4::timestamptz AND cp.created_at <= $5::timestamptz)
      )
    GROUP BY a.category_id, stCat.name, a.sale_type_id, st.sale_type
  `;

  const params: (string | number | bigint[])[] = [
    startDateStr,
    endDateStr,
    counsellorIds.map((x) => BigInt(x)),
    startTs,
    endTs,
  ];

  const { rows } = await pool.query<{
    category_id: string | number | null;
    category_name: string | null;
    sale_type_id: string | number;
    sale_type_name: string | null;
    cnt: string | number;
    amt: string | number;
  }>(query, params as any);

  return rows.map((r) => {
    const catId = r.category_id == null ? null : Number(r.category_id);
    return {
      category_id: catId,
      category_name: r.category_id == null ? "uncategorized" : String(r.category_name ?? "uncategorized"),
      sale_type_id: Number(r.sale_type_id),
      sale_type_name: String(r.sale_type_name ?? `sale_type_${r.sale_type_id}`),
      count: Number(r.cnt ?? 0),
      amount: Number(r.amt ?? 0).toFixed(2),
    };
  });
};

const getOtherProductBreakdown = async (
  counsellorIds: number[],
  range: ReportDateRange
): Promise<Array<{ key: string; name: string; count: number; amount: string }>> => {
  if (counsellorIds.length === 0) return [];
  const startStr = toDateStr(range.start);
  const endStr = toDateStr(range.end);
  const startTs = range.start.toISOString();
  const endTs = range.end.toISOString();

  const rows = await db
    .select({
      productName: clientProductPayments.productName,
      count: sql<number>`COUNT(*)`,
      amount: sql<string>`COALESCE(SUM(COALESCE(${clientProductPayments.amount}, 0)::numeric), 0)`,
    })
    .from(clientProductPayments)
    .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
    .where(
      and(
        inArray(clientInformation.counsellorId, counsellorIds),
        eq(clientInformation.archived, false),
        sql`${clientProductPayments.productName} != 'ALL_FINANCE_EMPLOYEMENT'`,
        sql`(
          (${clientProductPayments.paymentDate} IS NOT NULL
            AND ${clientProductPayments.paymentDate} >= ${startStr}
            AND ${clientProductPayments.paymentDate} <= ${endStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL
            AND ${clientProductPayments.createdAt} >= ${startTs}
            AND ${clientProductPayments.createdAt} <= ${endTs})
        )`
      )
    )
    .groupBy(clientProductPayments.productName);

  return rows
    .map((r) => ({
      key: `product:${r.productName}`,
      name: String(r.productName),
      count: Number(r.count ?? 0),
      amount: Number(r.amount ?? 0).toFixed(2),
    }))
    .sort((a, b) => b.count - a.count || Number(b.amount) - Number(a.amount));
};

export const getSaleReportDashboardData = async (
  userId: number,
  userRole: ReportUserRole,
  filter: SaleReportFilter,
  beforeDate?: string,
  afterDate?: string,
  options?: ReportScopeOptions
): Promise<SaleReportDashboardResult> => {
  const dateRange = getSaleReportDateRange(filter, beforeDate, afterDate);
  const scope = await getReportScope(userId, userRole, options);
  const useGlobalDashboardMode = userRole === "admin" && !options?.managerId;
  const snapshotCache = new Map<string, Awaited<ReturnType<typeof getScopeSnapshot>>>();
  const getSnapshotCached = async (range: ReportDateRange) => {
    const key = `${toDateStr(range.start)}_${toDateStr(range.end)}`;
    const hit = snapshotCache.get(key);
    if (hit) return hit;
    const val = useGlobalDashboardMode
      ? await getGlobalSnapshotFromDashboard(range)
      : await getScopeSnapshot(scope.counsellorIds, range);
    snapshotCache.set(key, val);
    return val;
  };

  const [main, coreCategorySaleTypeRows, otherProductBreakdown] = await Promise.all([
    getSnapshotCached(dateRange),
    getCoreSaleCategorySaleTypeBreakdown(scope.counsellorIds, dateRange),
    getOtherProductBreakdown(scope.counsellorIds, dateRange),
  ]);

  const categoryMap = new Map<
    string,
    {
      category_id: number | null;
      category_name: string;
      count: number;
      amount: string;
      sale_types: Array<{
        sale_type_id: number;
        sale_type_name: string;
        count: number;
        amount: string;
      }>;
    }
  >();

  for (const r of coreCategorySaleTypeRows) {
    // Category -> sale types nested breakdown
    const catKey = String(r.category_id ?? "null");
    const cat = categoryMap.get(catKey) ?? {
      category_id: r.category_id,
      category_name: r.category_name,
      count: 0,
      amount: "0.00",
      sale_types: [],
    };
    cat.count += r.count;
    cat.amount = (Number(cat.amount) + Number(r.amount)).toFixed(2);
    cat.sale_types.push({
      sale_type_id: r.sale_type_id,
      sale_type_name: r.sale_type_name,
      count: r.count,
      amount: r.amount,
    });
    categoryMap.set(catKey, cat);
  }

  const sale_type_category_counts = Array.from(categoryMap.values())
    .map((c) => ({
      ...c,
      sale_types: c.sale_types.sort(
        (a, b) => b.count - a.count || Number(b.amount) - Number(a.amount)
      ),
    }))
    .sort((a, b) => b.count - a.count || Number(b.amount) - Number(a.amount));

  // Revenue cards (current/previous/previous2) must follow the selected filter.
  const { current, previous, previous2 } = getComparisonRanges(filter, dateRange);

  const [currentMonthSnap, previousMonthSnap, previous2MonthSnap] = await Promise.all([
    getSnapshotCached(current),
    getSnapshotCached(previous),
    getSnapshotCached(previous2),
  ]);

  const chartPeriods = getChartPeriods(filter, dateRange);

  const points = await Promise.all(
    chartPeriods.map(async (p) => {
      const s = await getSnapshotCached(p.range);
      return {
        name: p.name,
        core_sale: s.coreSaleAmount,
        core_product: s.coreProductAmount,
        other_product: s.otherProductAmount,
        overall_revenue: s.overallRevenue,
      };
    })
  );

  return {
    filter: {
      type: filter,
      start_date: toDateStr(dateRange.start),
      end_date: toDateStr(dateRange.end),
    },
    cards: {
      core_sale: { count: main.coreSaleCount, amount: Math.round(main.coreSaleAmount * 100) / 100 },
      core_product: { count: main.coreProductCount, amount: Math.round(main.coreProductAmount * 100) / 100 },
      other_product: { count: main.otherProductCount, amount: Math.round(main.otherProductAmount * 100) / 100 },
      overall_revenue: Math.round(main.overallRevenue * 100) / 100,
      current_month_revenue: Math.round(currentMonthSnap.overallRevenue * 100) / 100,
      previous_month_revenue: Math.round(previousMonthSnap.overallRevenue * 100) / 100,
      previous_to_previous_month_revenue: Math.round(previous2MonthSnap.overallRevenue * 100) / 100,
    },
    sale_type_category_counts,
    other_product_breakdown: otherProductBreakdown,
    charts: {
      line: points,
      bar: points,
    },
  };
};

export const getSaleMetricSeries = async (
  userId: number,
  userRole: ReportUserRole,
  filter: SaleReportFilter,
  metric: SaleMetric,
  beforeDate?: string,
  afterDate?: string,
  options?: ReportScopeOptions
): Promise<SaleMetricSeriesResult> => {
  const dateRange = getSaleReportDateRange(filter, beforeDate, afterDate);
  const scope = await getReportScope(userId, userRole, options);

  const { current, previous, previous2 } = getComparisonRanges(filter, dateRange);
  const useGlobalDashboardMode = userRole === "admin" && !options?.managerId;

  const resolveSnapshot = (range: ReportDateRange) =>
    useGlobalDashboardMode ? getGlobalSnapshotFromDashboard(range) : getScopeSnapshot(scope.counsellorIds, range);

  const toMetric = (snap: Awaited<ReturnType<typeof getGlobalSnapshotFromDashboard>>) => {
    switch (metric) {
      case "client":
        return { count: snap.totalClients ?? 0, amount: 0 };
      case "core_sale":
        return { count: snap.coreSaleCount ?? 0, amount: snap.coreSaleAmount ?? 0 };
      case "core_product":
        return { count: snap.coreProductCount ?? 0, amount: snap.coreProductAmount ?? 0 };
      case "other_product":
        return { count: snap.otherProductCount ?? 0, amount: snap.otherProductAmount ?? 0 };
      case "overall_revenue":
        return { count: snap.coreSaleCount ?? 0, amount: snap.overallRevenue ?? 0 };
      default:
        return { count: 0, amount: 0 };
    }
  };

  let series: SaleMetricSeriesPoint[] = [];

  // Monthly/custom graph: day-by-day rows for current, previous, previous2 windows.
  if (filter === "monthly" || filter === "custom") {
    const totalDays =
      filter === "monthly"
        ? new Date(current.start.getFullYear(), current.start.getMonth() + 1, 0).getDate()
        : Math.max(1, Math.floor((current.end.getTime() - current.start.getTime()) / 86400000) + 1);
    const dayRanges = Array.from({ length: totalDays }, (_, idx) => {
      const day = idx + 1;
      const mkRange = (base: ReportDateRange): ReportDateRange | null => {
        if (filter === "monthly") {
          const d = new Date(base.start.getFullYear(), base.start.getMonth(), day);
          // Skip days that don't exist in this month (e.g. Feb 30)
          if (d.getMonth() !== base.start.getMonth()) return null;
          return { start: startOfDay(d), end: endOfDay(d) };
        }
        const d = new Date(base.start);
        d.setDate(d.getDate() + (day - 1));
        if (d > base.end) return null;
        return { start: startOfDay(d), end: endOfDay(d) };
      };
      return {
        label: filter === "monthly" ? String(day) : `D${day}`,
        currentRange: mkRange(current),
        previousRange: mkRange(previous),
        previous2Range: mkRange(previous2),
      };
    });

    const dailySeries = await Promise.all(
      dayRanges.map(async (d) => {
        const [cSnap, pSnap, p2Snap] = await Promise.all([
          d.currentRange ? resolveSnapshot(d.currentRange) : null,
          d.previousRange ? resolveSnapshot(d.previousRange) : null,
          d.previous2Range ? resolveSnapshot(d.previous2Range) : null,
        ]);
        return {
          label: d.label,
          current: cSnap ? toMetric(cSnap) : { count: 0, amount: 0 },
          previous: pSnap ? toMetric(pSnap) : { count: 0, amount: 0 },
          previous2: p2Snap ? toMetric(p2Snap) : { count: 0, amount: 0 },
        };
      })
    );

    // Running totals for line chart: each day includes all previous days.
    let runningCurrentCount = 0;
    let runningCurrentAmount = 0;
    let runningPreviousCount = 0;
    let runningPreviousAmount = 0;
    let runningPrevious2Count = 0;
    let runningPrevious2Amount = 0;

    series = dailySeries.map((point) => {
      runningCurrentCount += point.current.count;
      runningCurrentAmount += point.current.amount;
      runningPreviousCount += point.previous.count;
      runningPreviousAmount += point.previous.amount;
      runningPrevious2Count += point.previous2.count;
      runningPrevious2Amount += point.previous2.amount;

      return {
        label: point.label,
        current: {
          count: runningCurrentCount,
          amount: Math.round(runningCurrentAmount * 100) / 100,
        },
        previous: {
          count: runningPreviousCount,
          amount: Math.round(runningPreviousAmount * 100) / 100,
        },
        previous2: {
          count: runningPrevious2Count,
          amount: Math.round(runningPrevious2Amount * 100) / 100,
        },
      };
    });
  } else {
    // Other filters: 3 aggregate points (current, previous, previous2)
    const [currentSnap, previousSnap, previous2Snap] = await Promise.all([
      resolveSnapshot(current),
      resolveSnapshot(previous),
      resolveSnapshot(previous2),
    ]);
    series = [
      {
        label: formatRangeLabel(current, filter),
        current: toMetric(currentSnap),
        previous: { count: 0, amount: 0 },
        previous2: { count: 0, amount: 0 },
      },
      {
        label: formatRangeLabel(previous, filter),
        current: { count: 0, amount: 0 },
        previous: toMetric(previousSnap),
        previous2: { count: 0, amount: 0 },
      },
      {
        label: formatRangeLabel(previous2, filter),
        current: { count: 0, amount: 0 },
        previous: { count: 0, amount: 0 },
        previous2: toMetric(previous2Snap),
      },
    ];
  }

  return {
    filter: {
      type: filter,
      start_date: toDateStr(dateRange.start),
      end_date: toDateStr(dateRange.end),
    },
    metric,
    series,
  };
};

