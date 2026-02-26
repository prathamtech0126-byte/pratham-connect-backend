import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import {
  getCounsellorCoreSaleClientCount,
  getCounsellorCoreSaleAmount,
  getCounsellorCoreProductMetrics,
  getCounsellorOtherProductMetrics,
  calculateCounsellorRevenue,
} from "./leaderboard.model";
import {
  getManagerTargets,
  getManagerAchievedWithBreakdown,
  type CounsellorAchievedItem,
  type ManagerAchievedWithBreakdown,
} from "./managerTargets.model";
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
}

/** Manager target + achieved with counsellor-wise breakdown (same concept as manager target). */
export interface ManagerReportItem {
  manager_id: number;
  manager_name: string;
  target_id: number | null;
  target_start_date: string | null;
  target_end_date: string | null;
  target_core_sale_clients: number;
  target_core_sale_revenue: string;
  target_core_product_clients: number;
  target_core_product_revenue: string;
  target_other_product_clients: number;
  target_other_product_revenue: string;
  achieved: ManagerAchievedWithBreakdown["achieved"];
  achieved_by_counsellor: CounsellorAchievedItem[];
}

export interface ReportResult {
  filter_start_date: string;
  filter_end_date: string;
  counsellor_performance: CounsellorPerformanceItem[];
  manager_data: ManagerReportItem[];
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

const toDateStr = (d: Date) => d.toISOString().split("T")[0];

/**
 * Counsellor performance report for the given date range.
 * Uses same metrics as leaderboard (core sale, core product, other product).
 */
export const getCounsellorPerformanceReport = async (
  counsellorIds: number[],
  dateRange: ReportDateRange
): Promise<CounsellorPerformanceItem[]> => {
  if (counsellorIds.length === 0) return [];
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);
  const startTs = dateRange.start.toISOString();
  const endTs = dateRange.end.toISOString();

  const counsellorList = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, counsellorIds));
  const archivedMap = await getArchivedCountByCounsellor(counsellorIds);

  const result: CounsellorPerformanceItem[] = [];
  for (const c of counsellorList) {
    const [enrollments, coreSaleRev, coreMetrics, otherMetrics] = await Promise.all([
      getCounsellorCoreSaleClientCount(c.id, startStr, endStr, startTs, endTs),
      getCounsellorCoreSaleAmount(c.id, startStr, endStr, startTs, endTs),
      getCounsellorCoreProductMetrics(c.id, startStr, endStr),
      getCounsellorOtherProductMetrics(c.id, startStr, endStr),
    ]);
    const totalRevenue = coreSaleRev + coreMetrics.amount + otherMetrics.amount;
    const avgPerClient = enrollments > 0 ? totalRevenue / enrollments : 0;
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
    });
  }
  return result;
}

/**
 * Manager report: targets overlapping the period with achieved and counsellor-wise breakdown.
 * Same concept as manager target GET – target minus achieved per counsellor.
 */
export const getManagerReportData = async (
  managerIds: number[],
  dateRange: ReportDateRange
): Promise<ManagerReportItem[]> => {
  if (managerIds.length === 0) return [];
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);

  const managerList = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, managerIds));

  const result: ManagerReportItem[] = [];
  for (const m of managerList) {
    const targets = await getManagerTargets(m.id, startStr, endStr);
    if (targets.length === 0) {
      const { achieved, byCounsellor } = await getManagerAchievedWithBreakdown(
        m.id,
        startStr,
        endStr
      );
      result.push({
        manager_id: m.id,
        manager_name: m.fullName,
        target_id: null,
        target_start_date: null,
        target_end_date: null,
        target_core_sale_clients: 0,
        target_core_sale_revenue: "0",
        target_core_product_clients: 0,
        target_core_product_revenue: "0",
        target_other_product_clients: 0,
        target_other_product_revenue: "0",
        achieved,
        achieved_by_counsellor: byCounsellor,
      });
      continue;
    }
    for (const t of targets) {
      const { achieved, byCounsellor } = await getManagerAchievedWithBreakdown(
        m.id,
        startStr,
        endStr
      );
      result.push({
        manager_id: m.id,
        manager_name: m.fullName,
        target_id: t.id,
        target_start_date: typeof t.start_date === "string" ? t.start_date : toDateStr(t.start_date as Date),
        target_end_date: typeof t.end_date === "string" ? t.end_date : toDateStr(t.end_date as Date),
        target_core_sale_clients: t.core_sale_target_clients ?? 0,
        target_core_sale_revenue: String(t.core_sale_target_revenue ?? "0"),
        target_core_product_clients: t.core_product_target_clients ?? 0,
        target_core_product_revenue: String(t.core_product_target_revenue ?? "0"),
        target_other_product_clients: t.other_product_target_clients ?? 0,
        target_other_product_revenue: String(t.other_product_target_revenue ?? "0"),
        achieved,
        achieved_by_counsellor: byCounsellor,
      });
    }
  }
  return result;
}

/**
 * Full report: scope by role (and optional managerId/counsellorId), then counsellor performance + manager data for the date range.
 */
export const getReport = async (
  userId: number,
  userRole: ReportUserRole,
  dateRange: ReportDateRange,
  options?: ReportScopeOptions
): Promise<ReportResult> => {
  const scope = await getReportScope(userId, userRole, options);
  const startStr = toDateStr(dateRange.start);
  const endStr = toDateStr(dateRange.end);

  let [counsellor_performance, manager_data] = await Promise.all([
    getCounsellorPerformanceReport(scope.counsellorIds, dateRange),
    getManagerReportData(scope.managerIds, dateRange),
  ]);

  // When manager views one counsellor, show only that counsellor in manager breakdown
  if (options?.counsellorId != null && userRole === "manager") {
    manager_data = manager_data.map((m) => ({
      ...m,
      achieved_by_counsellor: m.achieved_by_counsellor.filter(
        (c) => c.counsellor_id === options.counsellorId
      ),
    }));
  }

  return {
    filter_start_date: startStr,
    filter_end_date: endStr,
    counsellor_performance,
    manager_data,
  };
}
