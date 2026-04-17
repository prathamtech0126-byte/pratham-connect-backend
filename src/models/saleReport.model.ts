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
import { and, eq, inArray, sql, or, isNull } from "drizzle-orm";

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

// Batch version: 5 parallel pool queries instead of N×4 per-counsellor queries.
// Attribution filter: COALESCE(handled_by, counsellor_id) IN counsellorIds.
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
  const s = toDateStr(dateRange.start);
  const e = toDateStr(dateRange.end);

  if (counsellorIds.length === 0) {
    return { coreSaleCount: 0, coreSaleAmount: 0, coreProductCount: 0, coreProductAmount: 0, otherProductCount: 0, otherProductAmount: 0, overallRevenue: 0, totalClients: 0 };
  }

  const ids = counsellorIds.map((x) => BigInt(x));
  const params = [s, e, ids] as any[];

  const ATTR = `(
    (cp.handled_by IS NOT NULL AND cp.handled_by = ANY($3::bigint[]))
    OR (cp.handled_by IS NULL AND ci.counsellor_id = ANY($3::bigint[]))
  )`;
  const ATTR_CPP = `(
    (cpp.handled_by IS NOT NULL AND cpp.handled_by = ANY($3::bigint[]))
    OR (cpp.handled_by IS NULL AND ci.counsellor_id = ANY($3::bigint[]))
  )`;

  const [enrollmentRes, coreSaleRes, coreProductRes, otherDirectRes, otherEntityRes] = await Promise.all([

    // 1. Enrollment count: clients enrolled in period under these counsellors with ≥1 core payment
    pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT ci.id)::text AS count
       FROM client_information ci
       WHERE ci.archived = false
         AND ci.date >= $1::date AND ci.date <= $2::date
         AND ci.counsellor_id = ANY($3::bigint[])
         AND EXISTS (
           SELECT 1 FROM client_payment cp0
           WHERE cp0.client_id = ci.id
             AND cp0.stage IN ('INITIAL','BEFORE_VISA','AFTER_VISA')
         )`,
      params
    ),

    // 2. Core sale amount (INITIAL/BEFORE_VISA/AFTER_VISA, payment_date-based)
    pool.query<{ amount: string }>(
      `SELECT COALESCE(SUM(cp.amount::numeric), 0)::text AS amount
       FROM client_payment cp
       JOIN client_information ci ON cp.client_id = ci.id
       WHERE ci.archived = false
         AND cp.stage IN ('INITIAL','BEFORE_VISA','AFTER_VISA')
         AND cp.payment_date IS NOT NULL
         AND cp.payment_date >= $1 AND cp.payment_date <= $2
         AND ${ATTR}`,
      params
    ),

    // 3. Core product (ALL_FINANCE_EMPLOYEMENT) — 4 payment slots
    pool.query<{ count: string; amount: string }>(
      `SELECT COALESCE(SUM(cnt),0)::text AS count, COALESCE(SUM(amt),0)::text AS amount
       FROM (
         SELECT COUNT(*) AS cnt, COALESCE(SUM(af.amount::numeric),0) AS amt
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.payment_date IS NOT NULL AND af.payment_date >= $1 AND af.payment_date <= $2
           AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date IS NOT NULL AND af.another_payment_date >= $1 AND af.another_payment_date <= $2
           AND af.another_payment_amount IS NOT NULL AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount2::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date2 IS NOT NULL AND af.another_payment_date2 >= $1 AND af.another_payment_date2 <= $2
           AND af.another_payment_amount2 IS NOT NULL AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount3::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date3 IS NOT NULL AND af.another_payment_date3 >= $1 AND af.another_payment_date3 <= $2
           AND af.another_payment_amount3 IS NOT NULL AND ${ATTR_CPP}
       ) t`,
      params
    ),

    // 4. Other product direct (master_only rows, by cpp.date)
    pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(
                CASE WHEN LOWER(cpp.product_name::text) IN (
                  'loan_details','forex_card','tution_fees','credit_card',
                  'sim_card_activation','insurance','beacon_account','air_ticket','forex_fees'
                ) THEN 0::numeric ELSE COALESCE(cpp.amount, 0)::numeric END
              ), 0)::text AS amount
       FROM client_product_payment cpp
       JOIN client_information ci ON cpp.client_id = ci.id
       WHERE ci.archived = false
         AND cpp.entity_type = 'master_only'
         AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
         AND cpp.date IS NOT NULL AND cpp.date >= $1 AND cpp.date <= $2
         AND ${ATTR_CPP}`,
      params
    ),

    // 5. Other product entity-based (each entity uses its own date column)
    pool.query<{ count: string; amount: string }>(
      `SELECT COALESCE(SUM(ec),0)::text AS count, COALESCE(SUM(ea),0)::text AS amount
       FROM (
         SELECT COUNT(*) AS ec, COALESCE(SUM(ve.amount::numeric),0) AS ea
         FROM client_product_payment cpp
         JOIN visa_extension ve ON cpp.entity_id = ve.id AND cpp.entity_type = 'visaextension_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ve.date IS NOT NULL AND ve.date >= $1 AND ve.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(ns.amount::numeric),0)
         FROM client_product_payment cpp
         JOIN new_sell ns ON cpp.entity_id = ns.id AND cpp.entity_type = 'newSell_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ns.date IS NOT NULL AND ns.date >= $1 AND ns.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(il.amount::numeric),0)
         FROM client_product_payment cpp
         JOIN ielts il ON cpp.entity_id = il.id AND cpp.entity_type = 'ielts_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND il.date IS NOT NULL AND il.date >= $1 AND il.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN loan l ON cpp.entity_id = l.id AND cpp.entity_type = 'loan_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND l.disbursment_date IS NOT NULL AND l.disbursment_date >= $1 AND l.disbursment_date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN air_ticket atk ON cpp.entity_id = atk.id AND cpp.entity_type = 'airTicket_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND atk.date IS NOT NULL AND atk.date >= $1 AND atk.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN insurance ins ON cpp.entity_id = ins.id AND cpp.entity_type = 'insurance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ins.date IS NOT NULL AND ins.date >= $1 AND ins.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN forex_card fc ON cpp.entity_id = fc.id AND cpp.entity_type = 'forexCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND fc.date IS NOT NULL AND fc.date >= $1 AND fc.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN forex_fees ff ON cpp.entity_id = ff.id AND cpp.entity_type = 'forexFees_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ff.date IS NOT NULL AND ff.date >= $1 AND ff.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN tution_fees tf ON cpp.entity_id = tf.id AND cpp.entity_type = 'tutionFees_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND tf.date IS NOT NULL AND tf.date >= $1 AND tf.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN credit_card cc ON cpp.entity_id = cc.id AND cpp.entity_type = 'creditCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND cc.date IS NOT NULL AND cc.date >= $1 AND cc.date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN sim_card sc ON cpp.entity_id = sc.id AND cpp.entity_type = 'simCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND sc.sim_card_giving_date IS NOT NULL AND sc.sim_card_giving_date >= $1 AND sc.sim_card_giving_date <= $2 AND ${ATTR_CPP}
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN beacon_account ba ON cpp.entity_id = ba.id AND cpp.entity_type = 'beaconAccount_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ba.opening_date IS NOT NULL AND ba.opening_date >= $1 AND ba.opening_date <= $2 AND ${ATTR_CPP}
       ) t`,
      params
    ),
  ]);

  const coreSaleCount     = parseInt(enrollmentRes.rows[0]?.count    ?? "0", 10);
  const coreSaleAmount    = parseFloat(coreSaleRes.rows[0]?.amount   ?? "0");
  const coreProductCount  = parseInt(coreProductRes.rows[0]?.count   ?? "0", 10);
  const coreProductAmount = parseFloat(coreProductRes.rows[0]?.amount ?? "0");
  const otherDirectCount  = parseInt(otherDirectRes.rows[0]?.count   ?? "0", 10);
  const otherDirectAmount = parseFloat(otherDirectRes.rows[0]?.amount ?? "0");
  const otherEntityCount  = parseInt(otherEntityRes.rows[0]?.count   ?? "0", 10);
  const otherEntityAmount = parseFloat(otherEntityRes.rows[0]?.amount ?? "0");
  const otherProductCount  = otherDirectCount  + otherEntityCount;
  const otherProductAmount = otherDirectAmount + otherEntityAmount;
  const overallRevenue     = coreSaleAmount + coreProductAmount + otherProductAmount;

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

// Global snapshot for admin (no managerId scope): runs 4 parameterised pool queries
// with no counsellor restriction — matches Dashboard admin scope exactly.
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
  const s = toDateStr(dateRange.start);
  const e = toDateStr(dateRange.end);

  const [coreSaleRes, coreProductRes, otherProductRes, otherEntityRes] = await Promise.all([

    // 1. Core sale: client_payment, payment_date in range, no counsellor restriction
    pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(DISTINCT ci.id)::text AS count,
              COALESCE(SUM(cp.amount::numeric), 0)::text AS amount
       FROM client_payment cp
       JOIN client_information ci ON cp.client_id = ci.id
       WHERE ci.archived = false
         AND cp.stage IN ('INITIAL','BEFORE_VISA','AFTER_VISA')
         AND cp.payment_date IS NOT NULL
         AND cp.payment_date >= $1 AND cp.payment_date <= $2`,
      [s, e]
    ),

    // 2. Core product: all_finance, all 4 payment slots in range, no counsellor restriction
    pool.query<{ count: string; amount: string }>(
      `SELECT COALESCE(SUM(cnt),0)::text AS count, COALESCE(SUM(amt),0)::text AS amount
       FROM (
         SELECT COUNT(*) AS cnt, COALESCE(SUM(af.amount::numeric),0) AS amt
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.payment_date IS NOT NULL AND af.payment_date >= $1 AND af.payment_date <= $2
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date IS NOT NULL AND af.another_payment_date >= $1 AND af.another_payment_date <= $2
           AND af.another_payment_amount IS NOT NULL
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount2::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date2 IS NOT NULL AND af.another_payment_date2 >= $1 AND af.another_payment_date2 <= $2
           AND af.another_payment_amount2 IS NOT NULL
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(af.another_payment_amount3::numeric),0)
         FROM all_finance af
         JOIN client_product_payment cpp ON cpp.entity_id = af.id AND cpp.entity_type = 'allFinance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name = 'ALL_FINANCE_EMPLOYEMENT'
           AND af.another_payment_date3 IS NOT NULL AND af.another_payment_date3 >= $1 AND af.another_payment_date3 <= $2
           AND af.another_payment_amount3 IS NOT NULL
       ) t`,
      [s, e]
    ),

    // 3. Other product direct (master_only rows, paymentDate-based)
    pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(
                CASE WHEN LOWER(cpp.product_name::text) IN (
                  'loan_details','forex_card','tution_fees','credit_card',
                  'sim_card_activation','insurance','beacon_account','air_ticket','forex_fees'
                ) THEN 0::numeric ELSE COALESCE(cpp.amount, 0)::numeric END
              ), 0)::text AS amount
       FROM client_product_payment cpp
       JOIN client_information ci ON cpp.client_id = ci.id
       WHERE ci.archived = false
         AND cpp.entity_type = 'master_only'
         AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
         AND cpp.date IS NOT NULL
         AND cpp.date >= $1 AND cpp.date <= $2`,
      [s, e]
    ),

    // 4. Other product entity-based — each entity type uses its own date column
    //    Revenue entities: visa_extension, new_sell, ielts  |  Count-only: all others
    pool.query<{ count: string; amount: string }>(
      `SELECT COALESCE(SUM(ec),0)::text AS count, COALESCE(SUM(ea),0)::text AS amount
       FROM (
         SELECT COUNT(*) AS ec, COALESCE(SUM(ve.amount::numeric),0) AS ea
         FROM client_product_payment cpp
         JOIN visa_extension ve ON cpp.entity_id = ve.id AND cpp.entity_type = 'visaextension_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ve.date IS NOT NULL AND ve.date >= $1 AND ve.date <= $2
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(ns.amount::numeric),0)
         FROM client_product_payment cpp
         JOIN new_sell ns ON cpp.entity_id = ns.id AND cpp.entity_type = 'newSell_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ns.date IS NOT NULL AND ns.date >= $1 AND ns.date <= $2
         UNION ALL
         SELECT COUNT(*), COALESCE(SUM(il.amount::numeric),0)
         FROM client_product_payment cpp
         JOIN ielts il ON cpp.entity_id = il.id AND cpp.entity_type = 'ielts_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND il.date IS NOT NULL AND il.date >= $1 AND il.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN loan l ON cpp.entity_id = l.id AND cpp.entity_type = 'loan_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND l.disbursment_date IS NOT NULL AND l.disbursment_date >= $1 AND l.disbursment_date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN air_ticket atk ON cpp.entity_id = atk.id AND cpp.entity_type = 'airTicket_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND atk.date IS NOT NULL AND atk.date >= $1 AND atk.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN insurance ins ON cpp.entity_id = ins.id AND cpp.entity_type = 'insurance_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ins.date IS NOT NULL AND ins.date >= $1 AND ins.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN forex_card fc ON cpp.entity_id = fc.id AND cpp.entity_type = 'forexCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND fc.date IS NOT NULL AND fc.date >= $1 AND fc.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN forex_fees ff ON cpp.entity_id = ff.id AND cpp.entity_type = 'forexFees_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ff.date IS NOT NULL AND ff.date >= $1 AND ff.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN tution_fees tf ON cpp.entity_id = tf.id AND cpp.entity_type = 'tutionFees_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND tf.date IS NOT NULL AND tf.date >= $1 AND tf.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN credit_card cc ON cpp.entity_id = cc.id AND cpp.entity_type = 'creditCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND cc.date IS NOT NULL AND cc.date >= $1 AND cc.date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN sim_card sc ON cpp.entity_id = sc.id AND cpp.entity_type = 'simCard_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND sc.sim_card_giving_date IS NOT NULL AND sc.sim_card_giving_date >= $1 AND sc.sim_card_giving_date <= $2
         UNION ALL
         SELECT COUNT(*), 0::numeric
         FROM client_product_payment cpp
         JOIN beacon_account ba ON cpp.entity_id = ba.id AND cpp.entity_type = 'beaconAccount_id'
         JOIN client_information ci ON cpp.client_id = ci.id
         WHERE ci.archived = false AND cpp.product_name != 'ALL_FINANCE_EMPLOYEMENT'
           AND ba.opening_date IS NOT NULL AND ba.opening_date >= $1 AND ba.opening_date <= $2
       ) t`,
      [s, e]
    ),
  ]);

  const coreSaleCount     = parseInt(coreSaleRes.rows[0]?.count    ?? "0", 10);
  const coreSaleAmount    = parseFloat(coreSaleRes.rows[0]?.amount  ?? "0");
  const coreProductCount  = parseInt(coreProductRes.rows[0]?.count  ?? "0", 10);
  const coreProductAmount = parseFloat(coreProductRes.rows[0]?.amount ?? "0");
  const otherDirectCount  = parseInt(otherProductRes.rows[0]?.count  ?? "0", 10);
  const otherDirectAmount = parseFloat(otherProductRes.rows[0]?.amount ?? "0");
  const otherEntityCount  = parseInt(otherEntityRes.rows[0]?.count   ?? "0", 10);
  const otherEntityAmount = parseFloat(otherEntityRes.rows[0]?.amount ?? "0");
  const otherProductCount  = otherDirectCount  + otherEntityCount;
  const otherProductAmount = otherDirectAmount + otherEntityAmount;
  const overallRevenue     = coreSaleAmount + coreProductAmount + otherProductAmount;

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
        or(
          inArray(clientProductPayments.handledBy, counsellorIds),
          and(
            isNull(clientProductPayments.handledBy),
            inArray(clientInformation.counsellorId, counsellorIds)
          )
        ),
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
  // Revenue cards always use counsellor-attributed scope (accurate).
  // Chart period points use the fast global query for admin (no counsellor filter needed for trend lines).
  const isAdminMode = userRole === "admin" && !options?.managerId;

  type SnapResult = Awaited<ReturnType<typeof getScopeSnapshot>>;
  const cardSnapshotCache = new Map<string, SnapResult>();
  const getCardSnapshot = async (range: ReportDateRange): Promise<SnapResult> => {
    const key = `${toDateStr(range.start)}_${toDateStr(range.end)}`;
    const hit = cardSnapshotCache.get(key);
    if (hit) return hit;
    const val = await getScopeSnapshot(scope.counsellorIds, range);
    cardSnapshotCache.set(key, val);
    return val;
  };

  const chartSnapshotCache = new Map<string, SnapResult>();
  const getChartSnapshot = async (range: ReportDateRange): Promise<SnapResult> => {
    const key = `${toDateStr(range.start)}_${toDateStr(range.end)}`;
    const hit = chartSnapshotCache.get(key);
    if (hit) return hit;
    const val = isAdminMode
      ? await getGlobalSnapshotFromDashboard(range)
      : await getScopeSnapshot(scope.counsellorIds, range);
    chartSnapshotCache.set(key, val);
    return val;
  };

  const [main, coreCategorySaleTypeRows, otherProductBreakdown] = await Promise.all([
    getCardSnapshot(dateRange),
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
    getCardSnapshot(current),
    getCardSnapshot(previous),
    getCardSnapshot(previous2),
  ]);

  const chartPeriods = getChartPeriods(filter, dateRange);

  const points = await Promise.all(
    chartPeriods.map(async (p) => {
      const s = await getChartSnapshot(p.range);
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

  // Chart/metric series: use fast global queries for admin; scoped for non-admin.
  const useGlobalDashboardMode = userRole === "admin" && !options?.managerId;
  const resolveSnapshot = (range: ReportDateRange) =>
    useGlobalDashboardMode
      ? getGlobalSnapshotFromDashboard(range)
      : getScopeSnapshot(scope.counsellorIds, range);

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

