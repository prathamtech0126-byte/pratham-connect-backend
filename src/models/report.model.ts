import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import {
  getCounsellorEnrollmentCountByEnrollmentDate,
  getCounsellorCoreSaleAmount,
  getCounsellorCoreProductMetrics,
  getCounsellorOtherProductMetrics,
} from "./leaderboard.model";
import { getPendingAmountByCounsellors } from "./dashboard.model";
import { getAllSaleTypes } from "./saleType.model";
import { eq, and, count, sql, inArray } from "drizzle-orm";

export type ReportUserRole = "admin" | "manager" | "counsellor";

export interface ReportDateRange {
  start: Date;
  end: Date;
}

/** Which counsellor IDs and manager IDs the user can see in the report. */
export interface ReportScope {
  counsellorIds: number[];
  managerIds: number[]; // admin: all; manager: [self]; counsellor: []
}

/** Optional filters: admin can scope to one manager; manager can scope to one counsellor. */
export interface ReportScopeOptions {
  managerId?: number; // admin only: show that manager's report (their counsellors + their target/achieved)
  counsellorId?: number; // manager only: show that counsellor's report only
}

/** Per-counsellor performance for the report period. */
export interface CounsellorPerformanceItem {
  counsellor_id: number;
  full_name: string;
  email: string | null;
  total_enrollments: number; // Core Sale count
  core_sale_revenue: number;
  core_product_revenue: number;
  other_product_revenue: number;
  total_revenue: number;
  average_revenue_per_client: number;
  archived_count: number; // Drop rate
  /** Pending amount (outstanding) for this counsellor's clients (all time). */
  pending_amount: string;
  /** Total number of payments (client_payment rows) for this counsellor in the filter period across all sale types. */
  sale_type_count: number;
}

export interface ReportResult {
  filter_start_date: string;
  filter_end_date: string;
  /** Total company revenue for the filter period (sum of all counsellor total_revenue). Use this instead of adding on frontend. */
  total_company_revenue: number;
  counsellor_performance: CounsellorPerformanceItem[];
}

/**
 * Resolve which counsellors and managers the user can see.
 * Optional: admin can pass managerId → that manager's report only; manager can pass counsellorId → that counsellor's report only.
 */
export const getReportScope = async (
  userId: number,
  userRole: ReportUserRole,
  options?: ReportScopeOptions
): Promise<ReportScope> => {
  if (userRole === "counsellor") {
    return { counsellorIds: [userId], managerIds: [] };
  }

  if (userRole === "admin") {
    // Admin opening one manager: show that manager's report only (their counsellors + their target/achieved)
    if (options?.managerId != null) {
      const [manager] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, options.managerId), eq(users.role, "manager")))
        .limit(1);
      if (!manager) return { counsellorIds: [], managerIds: [] };
      const counsellors = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "counsellor"), eq(users.managerId, options.managerId)));
      return {
        counsellorIds: counsellors.map((c) => c.id),
        managerIds: [options.managerId],
      };
    }
    const counsellors = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "counsellor"));
    const managers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "manager"));
    return {
      counsellorIds: counsellors.map((c) => c.id),
      managerIds: managers.map((m) => m.id),
    };
  }

  if (userRole === "manager") {
    const [manager] = await db
      .select({ id: users.id, role: users.role, isSupervisor: users.isSupervisor })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!manager || manager.role !== "manager") {
      return { counsellorIds: [], managerIds: [] };
    }
    // Manager opening one counsellor: show that counsellor's report only (must be under this manager)
    if (options?.counsellorId != null) {
      const whereCounsellor = manager.isSupervisor
        ? and(eq(users.id, options.counsellorId), eq(users.role, "counsellor"))
        : and(
            eq(users.id, options.counsellorId),
            eq(users.role, "counsellor"),
            eq(users.managerId, userId)
          );
      const [counsellor] = await db
        .select({ id: users.id })
        .from(users)
        .where(whereCounsellor)
        .limit(1);
      if (!counsellor) return { counsellorIds: [], managerIds: [] };
      return {
        counsellorIds: [options.counsellorId],
        managerIds: [userId], // still show manager's target with only this counsellor in breakdown
      };
    }
    const counsellors = await db
      .select({ id: users.id })
      .from(users)
      .where(
        manager.isSupervisor
          ? eq(users.role, "counsellor")
          : and(eq(users.role, "counsellor"), eq(users.managerId, userId))
      );
    return {
      counsellorIds: counsellors.map((c) => c.id),
      managerIds: [userId],
    };
  }

  return { counsellorIds: [], managerIds: [] };
}

/** Result for counsellor list report filtered by sale type. */
export interface CounsellorBySaleTypeItem {
  counsellor_id: number;
  full_name: string;
  email: string | null;
  revenue: number;
  /** Number of payments (client_payment rows) for this sale type in the filter period. */
  sale_type_count: number;
}

export interface CounsellorReportBySaleTypeResult {
  filter_start_date: string;
  filter_end_date: string;
  sale_type: { id: number; sale_type: string };
  counsellors: CounsellorBySaleTypeItem[];
}

/**
 * Revenue by sale type per counsellor for the filter period (client_payment INITIAL/BEFORE_VISA/AFTER_VISA).
 * Returns Map<counsellorId, Map<saleTypeId, revenue>>.
 */
export const getRevenueBySaleTypePerCounsellor = async (
  counsellorIds: number[],
  startStr: string,
  endStr: string,
  _startTs: string,
  _endTs: string
): Promise<Map<number, Map<number, number>>> => {
  if (counsellorIds.length === 0) return new Map();
  const rows = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      saleTypeId: clientPayments.saleTypeId,
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      and(
        inArray(clientInformation.counsellorId, counsellorIds),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(clientInformation.counsellorId, clientPayments.saleTypeId);
  const map = new Map<number, Map<number, number>>();
  for (const r of rows) {
    let inner = map.get(Number(r.counsellorId));
    if (!inner) {
      inner = new Map();
      map.set(Number(r.counsellorId), inner);
    }
    inner.set(r.saleTypeId, parseFloat(r.total || "0"));
  }
  return map;
};

/** Distinct client count per counsellor for a given sale type in the filter period. Returns Map<counsellorId, number>. */
export const getEnrollmentCountBySaleTypePerCounsellor = async (
  counsellorIds: number[],
  startStr: string,
  endStr: string,
  _startTs: string,
  _endTs: string,
  saleTypeId: number
): Promise<Map<number, number>> => {
  if (counsellorIds.length === 0) return new Map();

  console.log("[sale_type_count] getEnrollmentCountBySaleTypePerCounsellor params:", {
    counsellorIds,
    startStr,
    endStr,
    saleTypeId,
  });

  const rows = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      count: sql<number>`COUNT(DISTINCT ${clientInformation.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      and(
        inArray(clientInformation.counsellorId, counsellorIds),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientInformation.enrollmentDate} >= ${startStr}`,
        sql`${clientInformation.enrollmentDate} <= ${endStr}`,
        sql`${clientPayments.saleTypeId} = ${saleTypeId}`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(clientInformation.counsellorId);

  console.log("[sale_type_count] getEnrollmentCountBySaleTypePerCounsellor results:", rows);

  const map = new Map<number, number>();
  rows.forEach((r) => map.set(Number(r.counsellorId), Number(r.count)));
  return map;
};

/**
 * Count of payments by sale type per counsellor for the filter period (same filters as revenue).
 * Returns Map<counsellorId, Map<saleTypeId, count>>.
 */
export const getCountBySaleTypePerCounsellor = async (
  counsellorIds: number[],
  startStr: string,
  endStr: string,
  _startTs: string,
  _endTs: string
): Promise<Map<number, Map<number, number>>> => {
  if (counsellorIds.length === 0) return new Map();
  const rows = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      saleTypeId: clientPayments.saleTypeId,
      count: count(clientPayments.paymentId),
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      and(
        inArray(clientInformation.counsellorId, counsellorIds),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(clientInformation.counsellorId, clientPayments.saleTypeId);
  const map = new Map<number, Map<number, number>>();
  for (const r of rows) {
    let inner = map.get(Number(r.counsellorId));
    if (!inner) {
      inner = new Map();
      map.set(Number(r.counsellorId), inner);
    }
    inner.set(r.saleTypeId, r.count);
  }
  return map;
};

/**
 * Counsellor list report filtered by sale type: all counsellors in scope with revenue for the given sale type in the date range.
 */
export const getCounsellorReportBySaleType = async (
  counsellorIds: number[],
  dateRange: ReportDateRange,
  saleTypeId: number
): Promise<CounsellorReportBySaleTypeResult | null> => {
  const saleTypesList = await getAllSaleTypes();
  const saleType = saleTypesList.find((s) => s.id === saleTypeId);
  if (!saleType) return null;

  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);
  const startTs = dateRange.start.toISOString();
  const endTs = dateRange.end.toISOString();

  const [counsellorList, revenueBySaleType, countBySaleType] = await Promise.all([
    counsellorIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: users.id,
            fullName: users.fullName,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, counsellorIds)),
    getRevenueBySaleTypePerCounsellor(counsellorIds, startStr, endStr, startTs, endTs),
    getCountBySaleTypePerCounsellor(counsellorIds, startStr, endStr, startTs, endTs),
  ]);

  const counsellors: CounsellorBySaleTypeItem[] = counsellorList.map((c) => {
    const revenue =
      Math.round((revenueBySaleType.get(c.id)?.get(saleTypeId) ?? 0) * 100) / 100;
    const sale_type_count = countBySaleType.get(c.id)?.get(saleTypeId) ?? 0;
    return {
      counsellor_id: c.id,
      full_name: c.fullName,
      email: c.email,
      revenue,
      sale_type_count,
    };
  });

  return {
    filter_start_date: startStr,
    filter_end_date: endStr,
    sale_type: { id: saleType.id, sale_type: saleType.saleType },
    counsellors,
  };
}

/** Get archived (dropped) client count per counsellor (all time or in scope). */
const getArchivedCountByCounsellor = async (
  counsellorIds: number[]
): Promise<Map<number, number>> => {
  if (counsellorIds.length === 0) return new Map();
  const rows = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      count: count(clientInformation.clientId),
    })
    .from(clientInformation)
    .where(
      and(
        eq(clientInformation.archived, true),
        inArray(clientInformation.counsellorId, counsellorIds)
      )
    )
    .groupBy(clientInformation.counsellorId);
  const map = new Map<number, number>();
  rows.forEach((r) => map.set(r.counsellorId, r.count));
  return map;
}

const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Counsellor performance report for the given date range.
 * Uses same metrics as leaderboard (core sale, core product, other product).
 */
export const getCounsellorPerformanceReport = async (
  counsellorIds: number[],
  dateRange: ReportDateRange,
  saleTypeId?: number
): Promise<CounsellorPerformanceItem[]> => {
  if (counsellorIds.length === 0) return [];
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);
  const startTs = dateRange.start.toISOString();
  const endTs = dateRange.end.toISOString();

  console.log("[report] getCounsellorPerformanceReport:", {
    startStr,
    endStr,
    saleTypeId,
    counsellorIds,
  });

  const counsellorList = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, counsellorIds));
  const archivedMap = await getArchivedCountByCounsellor(counsellorIds);
  const saleTypeIdNum = saleTypeId != null ? Number(saleTypeId) : null;
  const enrollmentCountBySaleType =
    saleTypeIdNum != null
      ? await getEnrollmentCountBySaleTypePerCounsellor(
          counsellorIds,
          startStr,
          endStr,
          startTs,
          endTs,
          saleTypeIdNum
        )
      : null;

  if (enrollmentCountBySaleType != null) {
    console.log("[report] enrollmentCountBySaleType map:", [...enrollmentCountBySaleType.entries()]);
  }

  const result: CounsellorPerformanceItem[] = [];
  for (const c of counsellorList) {
    const [enrollments, coreSaleRev, coreMetrics, otherMetrics] = await Promise.all([
      getCounsellorEnrollmentCountByEnrollmentDate(c.id, startStr, endStr),
      getCounsellorCoreSaleAmount(c.id, startStr, endStr, startTs, endTs),
      getCounsellorCoreProductMetrics(c.id, startStr, endStr),
      getCounsellorOtherProductMetrics(c.id, startStr, endStr),
    ]);
    const totalRevenue = coreSaleRev + coreMetrics.amount + otherMetrics.amount;
    const avgPerClient = enrollments > 0 ? totalRevenue / enrollments : 0;
    const saleTypeCount =
      enrollmentCountBySaleType != null && saleTypeIdNum != null
        ? Number(enrollmentCountBySaleType.get(c.id) ?? 0)
        : enrollments;

    console.log(`[report] counsellor ${c.id} (${c.fullName}): enrollments=${enrollments}, sale_type_count=${saleTypeCount}, mapValue=${enrollmentCountBySaleType?.get(c.id)}`);

    result.push({
      counsellor_id: c.id,
      full_name: c.fullName,
      email: c.email,
      total_enrollments: enrollments,
      core_sale_revenue: coreSaleRev,
      core_product_revenue: coreMetrics.amount,
      other_product_revenue: otherMetrics.amount,
      total_revenue: totalRevenue,
      average_revenue_per_client: Math.round(avgPerClient * 100) / 100,
      archived_count: archivedMap.get(c.id) ?? 0,
      pending_amount: "0.00",
      sale_type_count: saleTypeCount,
    });
  }
  return result;
}

/**
 * Full report: scope by role (and optional managerId/counsellorId), then counsellor performance for the date range.
 */
export const getReport = async (
  userId: number,
  userRole: ReportUserRole,
  dateRange: ReportDateRange,
  options?: ReportScopeOptions,
  saleTypeId?: number
): Promise<ReportResult> => {
  const scope = await getReportScope(userId, userRole, options);
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);

  const [counsellor_performance_raw, pendingByCounsellor] = await Promise.all([
    getCounsellorPerformanceReport(scope.counsellorIds, dateRange, saleTypeId),
    getPendingAmountByCounsellors(scope.counsellorIds),
  ]);

  const counsellor_performance = counsellor_performance_raw.map((c) => ({
    ...c,
    pending_amount: pendingByCounsellor.get(c.counsellor_id) ?? "0.00",
  }));

  const total_company_revenue = Math.round(
    counsellor_performance.reduce((sum, c) => sum + c.total_revenue, 0) * 100
  ) / 100;

  return {
    filter_start_date: startStr,
    filter_end_date: endStr,
    total_company_revenue,
    counsellor_performance,
  };
}
