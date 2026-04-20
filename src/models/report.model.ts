import { db, pool } from "../config/databaseConnection";
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
import { eq, and, count, sql, inArray, or, isNull } from "drizzle-orm";

export type ReportUserRole = "admin" | "manager" | "counsellor" | "developer";

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

const paymentAttributedCounsellorSql = sql<number>`COALESCE(${clientPayments.handledBy}, ${clientInformation.counsellorId})`;

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
   if (userRole === "developer") {
    // Developer has admin-level read access: sees all counsellors
    if (options?.counsellorId != null) {
      const [counsellor] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, options.counsellorId), eq(users.role, "counsellor")))
        .limit(1);
      if (!counsellor) return { counsellorIds: [], managerIds: [] };
      return { counsellorIds: [options.counsellorId], managerIds: [] };
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
      counsellorId: paymentAttributedCounsellorSql,
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
        or(
          inArray(clientPayments.handledBy, counsellorIds),
          and(
            isNull(clientPayments.handledBy),
            inArray(clientInformation.counsellorId, counsellorIds)
          )
        ),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(paymentAttributedCounsellorSql, clientPayments.saleTypeId);
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
      counsellorId: paymentAttributedCounsellorSql,
      count: sql<number>`COUNT(DISTINCT ${clientInformation.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      and(
        or(
          inArray(clientPayments.handledBy, counsellorIds),
          and(
            isNull(clientPayments.handledBy),
            inArray(clientInformation.counsellorId, counsellorIds)
          )
        ),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientInformation.enrollmentDate} >= ${startStr}`,
        sql`${clientInformation.enrollmentDate} <= ${endStr}`,
        sql`${clientPayments.saleTypeId} = ${saleTypeId}`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(paymentAttributedCounsellorSql);

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
      counsellorId: paymentAttributedCounsellorSql,
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
        or(
          inArray(clientPayments.handledBy, counsellorIds),
          and(
            isNull(clientPayments.handledBy),
            inArray(clientInformation.counsellorId, counsellorIds)
          )
        ),
        sql`(${clientInformation.archived} = false OR ${clientInformation.archived} IS NULL)`,
        sql`${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')`,
        sql`${clientPayments.paymentDate} >= ${startStr}`,
        sql`${clientPayments.paymentDate} <= ${endStr}`
      )
    )
    .groupBy(paymentAttributedCounsellorSql, clientPayments.saleTypeId);
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

/* ============================================================
   PAYMENTS LIST — all payment sources (client_payment + all product entity tables)
============================================================ */

export type PaymentsListFilter = 
  | "today"
  | "yesterday"
  | "today_and_yesterday"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "maximum"
  | "monthly"
  | "yearly"
  | "custom";

export interface PaymentsListRow {
  paymentId: number | null;
  clientId: number | null;
  saleTypeId: number | null;
  totalPayment: string | null;
  invoiceNo: string | null;
  remarks: string | null;
  source: "payment" | "product";
  archived: boolean;
  date: string;
  clientName: string;
  paymentType: string;
  amount: string;
  clientOwner: string;
  addedBy: string;
  sharedClient: "Yes" | "No";
}

export interface PaymentsListResult {
  filter: PaymentsListFilter;
  startDate: string;
  endDate: string;
  counsellorId: number | null;
  total: number;
  data: PaymentsListRow[];
}

const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  ALL_FINANCE_EMPLOYEMENT: "All Finance Employment",
  VISA_EXTENSION: "Visa Extension",
  TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION: "SOWP / Work Permit Extension",
  OTHER_NEW_SELL: "Other New Sell",
  IELTS_ENROLLMENT: "IELTS Enrollment",
  INDIAN_SIDE_EMPLOYEMENT: "Indian Side Employment",
  NOC_LEVEL_JOB_ARRANGEMENT: "NOC Level Job Arrangement",
  LAWYER_REFUSAL_CHARGE: "Lawyer Refusal Charge",
  ONSHORE_PART_TIME_EMPLOYEMENT: "Onshore Part-Time Employment",
  MARRIAGE_PHOTO_FOR_COURT_MARRIAGE: "Marriage Photo for Court Marriage",
  MARRIAGE_PHOTO_CERTIFICATE: "Marriage Photo Certificate",
  RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT: "Marriage/Relationship Affidavit",
  JUDICAL_REVIEW_CHARGE: "Judicial Review Charge",
  SPONSOR_CHARGES: "Sponsor Charges",
  FINANCE_EMPLOYEMENT: "Finance Employment",
  REFUSAL_CHARGES: "Refusal Charges",
  KIDS_STUDY_PERMIT: "Kids Study Permit",
  CANADA_FUND: "Canada Fund",
  EMPLOYMENT_VERIFICATION_CHARGES: "Employment Verification Charges",
  ADDITIONAL_AMOUNT_STATEMENT_CHARGES: "Additional Amount/Statement Charges",
  SIM_CARD_ACTIVATION: "SIM Card",
  INSURANCE: "Insurance",
  BEACON_ACCOUNT: "Beacon Account",
  AIR_TICKET: "Air Ticket",
  LOAN_DETAILS: "Loan",
  FOREX_CARD: "Forex Card",
  FOREX_FEES: "Forex Fees",
  TUTION_FEES: "Tuition Fees",
  CREDIT_CARD: "Credit Card",
};

const formatDisplayDate = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

const getPaymentsListDateRange = (
  filter: PaymentsListFilter,
  startDate?: string,
  endDate?: string
): { start: string; end: string } => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Helper to get the start of the week (Monday)
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Helper to get the end of the week (Sunday)
  const getWeekEnd = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? 0 : 7);
    d.setDate(diff);
    d.setHours(23, 59, 59, 999);
    return d;
  };

  switch (filter) {
    case "today": {
      const s = toStr(now);
      return { start: s, end: s };
    }
    case "yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const s = toStr(yesterday);
      return { start: s, end: s };
    }
    case "today_and_yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: toStr(yesterday), end: toStr(now) };
    }
    case "last_7_days": {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return { start: toStr(sevenDaysAgo), end: toStr(now) };
    }
    case "last_14_days": {
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      return { start: toStr(fourteenDaysAgo), end: toStr(now) };
    }
    case "last_30_days": {
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return { start: toStr(thirtyDaysAgo), end: toStr(now) };
    }
    case "this_week": {
      const weekStart = getWeekStart(now);
      const weekEnd = getWeekEnd(now);
      return { start: toStr(weekStart), end: toStr(weekEnd) };
    }
    case "last_week": {
      const lastWeekStart = getWeekStart(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      const lastWeekEnd = getWeekEnd(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      return { start: toStr(lastWeekStart), end: toStr(lastWeekEnd) };
    }
    case "this_month": {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: toStr(firstDay), end: toStr(lastDay) };
    }
    case "last_month": {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: toStr(firstDay), end: toStr(lastDay) };
    }
    case "maximum": {
      // Return all data (use a very early date to effectively get all records)
      return { start: "1970-01-01", end: "2099-12-31" };
    }
    case "monthly": {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: toStr(firstDay), end: toStr(lastDay) };
    }
    case "yearly": {
      return {
        start: `${now.getFullYear()}-01-01`,
        end: `${now.getFullYear()}-12-31`,
      };
    }
    case "custom": {
      if (!startDate || !endDate) {
        throw new Error("Custom filter requires startDate and endDate (YYYY-MM-DD).");
      }
      const s = startDate < endDate ? startDate : endDate;
      const e = startDate < endDate ? endDate : startDate;
      return { start: s, end: e };
    }
  }
};

/**
 * Returns a flat list of all payments (clientPayments UNION clientProductPayments)
 * for the given date range, with client info and user details joined.
 */
export const getPaymentsList = async (
  userId: number,
  userRole: "admin" | "manager" | "developer",
  filter: PaymentsListFilter,
  startDate?: string,
  endDate?: string,
  counsellorId?: number
): Promise<PaymentsListResult> => {
  const { start, end } = getPaymentsListDateRange(filter, startDate, endDate);
  const scope = await getReportScope(userId, userRole, counsellorId != null ? { counsellorId } : undefined);
  const allowedCounsellorIds = scope.counsellorIds;

  if (allowedCounsellorIds.length === 0) {
    return {
      filter,
      startDate: start,
      endDate: end,
      counsellorId: counsellorId ?? null,
      total: 0,
      data: [],
    };
  }

  const query = `
    SELECT
      p.id            AS payment_id,
      p.client_id,
      p.sale_type_id,
      p.total_payment,
      p.invoice_no,
      p.remarks,
      p.source,
      p.payment_date,
      ci.fullname            AS client_name,
      p.payment_type,
      p.amount,
      owner_u.full_name      AS client_owner,
      adder_u.full_name      AS added_by,
      CASE WHEN ci.transfer_status = true THEN 'Yes' ELSE 'No' END AS shared_client,
      ci.archived
    FROM (

      -- ── Core sale payments (INITIAL / BEFORE_VISA / AFTER_VISA) ──────────
      SELECT
        id,
        payment_date,
        client_id,
        sale_type_id,
        stage::text         AS payment_type,
        COALESCE(amount, '0')::numeric AS amount,
        handled_by,
        total_payment::text AS total_payment,
        invoice_no,
        remarks,
        'payment'           AS source
      FROM client_payment
      WHERE payment_date >= $1::date
        AND payment_date <= $2::date

      UNION ALL

      -- ── master_only product payments ──────────────────────────────────────
      SELECT
        id,
        COALESCE(date, created_at::date) AS payment_date,
        client_id,
        NULL::bigint        AS sale_type_id,
        product_name::text  AS payment_type,
        CASE
          WHEN LOWER(product_name::text) IN (
            'loan_details','forex_card','tution_fees','credit_card',
            'sim_card_activation','insurance','beacon_account','air_ticket','forex_fees'
          ) THEN 0::numeric
          ELSE COALESCE(amount, '0')::numeric
        END                 AS amount,
        handled_by,
        NULL::text          AS total_payment,
        invoice_no,
        remark              AS remarks,
        'product'           AS source
      FROM client_product_payment
      WHERE entity_type = 'master_only'
        AND COALESCE(date, created_at::date) >= $1::date
        AND COALESCE(date, created_at::date) <= $2::date

      UNION ALL

      -- ── visa_extension ────────────────────────────────────────────────────
      SELECT
        cpp.id, ve.date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        COALESCE(ve.amount, '0')::numeric,
        cpp.handled_by, NULL::text, ve.invoice_no, ve.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN visa_extension ve ON ve.id = cpp.entity_id
      WHERE cpp.entity_type = 'visaextension_id'
        AND ve.date IS NOT NULL
        AND ve.date >= $1::date AND ve.date <= $2::date

      UNION ALL

      -- ── new_sell ──────────────────────────────────────────────────────────
      SELECT
        cpp.id, ns.date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        COALESCE(ns.amount, '0')::numeric,
        cpp.handled_by, NULL::text, ns.invoice_no, ns.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN new_sell ns ON ns.id = cpp.entity_id
      WHERE cpp.entity_type = 'newSell_id'
        AND ns.date IS NOT NULL
        AND ns.date >= $1::date AND ns.date <= $2::date

      UNION ALL

      -- ── ielts ─────────────────────────────────────────────────────────────
      SELECT
        cpp.id, ie.date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        COALESCE(ie.amount, '0')::numeric,
        cpp.handled_by, NULL::text, NULL::text, ie.remarks, 'product'
      FROM client_product_payment cpp
      INNER JOIN ielts ie ON ie.id = cpp.entity_id
      WHERE cpp.entity_type = 'ielts_id'
        AND ie.date IS NOT NULL
        AND ie.date >= $1::date AND ie.date <= $2::date

      UNION ALL

      -- ── sim_card (count-only, no amount) ──────────────────────────────────
      SELECT
        cpp.id,
        COALESCE(sc.sim_card_giving_date, sc.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, sc.remarks, 'product'
      FROM client_product_payment cpp
      INNER JOIN sim_card sc ON sc.id = cpp.entity_id
      WHERE cpp.entity_type = 'simCard_id'
        AND COALESCE(sc.sim_card_giving_date, sc.created_at::date) IS NOT NULL
        AND COALESCE(sc.sim_card_giving_date, sc.created_at::date) >= $1::date
        AND COALESCE(sc.sim_card_giving_date, sc.created_at::date) <= $2::date

      UNION ALL

      -- ── insurance (count-only, no revenue) ───────────────────────────────
      SELECT
        cpp.id, ins.date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, ins.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN insurance ins ON ins.id = cpp.entity_id
      WHERE cpp.entity_type = 'insurance_id'
        AND ins.date IS NOT NULL
        AND ins.date >= $1::date AND ins.date <= $2::date

      UNION ALL

      -- ── beacon_account (count-only, no revenue) ───────────────────────────
      SELECT
        cpp.id,
        COALESCE(ba.opening_date, ba.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, ba.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN beacon_account ba ON ba.id = cpp.entity_id
      WHERE cpp.entity_type = 'beaconAccount_id'
        AND COALESCE(ba.opening_date, ba.created_at::date) IS NOT NULL
        AND COALESCE(ba.opening_date, ba.created_at::date) >= $1::date
        AND COALESCE(ba.opening_date, ba.created_at::date) <= $2::date

      UNION ALL

      -- ── air_ticket (count-only, no revenue) ───────────────────────────────
      SELECT
        cpp.id, at2.date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, at2.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN air_ticket at2 ON at2.id = cpp.entity_id
      WHERE cpp.entity_type = 'airTicket_id'
        AND at2.date IS NOT NULL
        AND at2.date >= $1::date AND at2.date <= $2::date

      UNION ALL

      -- ── loan (count-only, no amount) ──────────────────────────────────────
      SELECT
        cpp.id, l.disbursment_date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, l.remarks, 'product'
      FROM client_product_payment cpp
      INNER JOIN loan l ON l.id = cpp.entity_id
      WHERE cpp.entity_type = 'loan_id'
        AND l.disbursment_date IS NOT NULL
        AND l.disbursment_date >= $1::date AND l.disbursment_date <= $2::date

      UNION ALL

      -- ── forex_card (count-only, no amount) ────────────────────────────────
      SELECT
        cpp.id,
        COALESCE(fc.date, fc.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, fc.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN forex_card fc ON fc.id = cpp.entity_id
      WHERE cpp.entity_type = 'forexCard_id'
        AND COALESCE(fc.date, fc.created_at::date) IS NOT NULL
        AND COALESCE(fc.date, fc.created_at::date) >= $1::date
        AND COALESCE(fc.date, fc.created_at::date) <= $2::date

      UNION ALL

      -- ── forex_fees (count-only, no revenue) ──────────────────────────────
      SELECT
        cpp.id,
        COALESCE(ff.date, ff.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, ff.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN forex_fees ff ON ff.id = cpp.entity_id
      WHERE cpp.entity_type = 'forexFees_id'
        AND COALESCE(ff.date, ff.created_at::date) IS NOT NULL
        AND COALESCE(ff.date, ff.created_at::date) >= $1::date
        AND COALESCE(ff.date, ff.created_at::date) <= $2::date

      UNION ALL

      -- ── tution_fees (count-only, no amount) ───────────────────────────────
      SELECT
        cpp.id,
        COALESCE(tf.date, tf.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, tf.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN tution_fees tf ON tf.id = cpp.entity_id
      WHERE cpp.entity_type = 'tutionFees_id'
        AND COALESCE(tf.date, tf.created_at::date) IS NOT NULL
        AND COALESCE(tf.date, tf.created_at::date) >= $1::date
        AND COALESCE(tf.date, tf.created_at::date) <= $2::date

      UNION ALL

      -- ── credit_card (count-only, no amount) ───────────────────────────────
      SELECT
        cpp.id,
        COALESCE(cc.date, cc.created_at::date),
        cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        0::numeric,
        cpp.handled_by, NULL::text, NULL::text, cc.remark, 'product'
      FROM client_product_payment cpp
      INNER JOIN credit_card cc ON cc.id = cpp.entity_id
      WHERE cpp.entity_type = 'creditCard_id'
        AND COALESCE(cc.date, cc.created_at::date) IS NOT NULL
        AND COALESCE(cc.date, cc.created_at::date) >= $1::date
        AND COALESCE(cc.date, cc.created_at::date) <= $2::date

      UNION ALL

      -- ── all_finance: main payment ───────────────
      SELECT
        cpp.id, af.payment_date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        COALESCE(af.amount, '0')::numeric,
        cpp.handled_by, NULL::text, af.invoice_no, af.remarks, 'product'
      FROM client_product_payment cpp
      INNER JOIN all_finance af ON af.id = cpp.entity_id
      WHERE cpp.entity_type = 'allFinance_id'
        AND af.payment_date IS NOT NULL
        AND af.payment_date >= $1::date AND af.payment_date <= $2::date

      UNION ALL

      -- ── all_finance: second installment ──
      SELECT
        cpp.id, af.another_payment_date, cpp.client_id, NULL::bigint,
        cpp.product_name::text,
        COALESCE(af.another_payment_amount, '0')::numeric,
        cpp.handled_by, NULL::text, af.invoice_no, af.remarks, 'product'
      FROM client_product_payment cpp
      INNER JOIN all_finance af ON af.id = cpp.entity_id
      WHERE cpp.entity_type = 'allFinance_id'
        AND af.another_payment_date IS NOT NULL
        AND af.another_payment_amount IS NOT NULL
        AND af.another_payment_date >= $1::date AND af.another_payment_date <= $2::date

    ) p
    INNER JOIN client_information ci ON ci.id = p.client_id
    LEFT JOIN users owner_u ON owner_u.id = ci.counsellor_id
    LEFT JOIN users adder_u ON adder_u.id = p.handled_by
    WHERE COALESCE(p.handled_by, ci.counsellor_id) = ANY($3::bigint[])
      AND (ci.archived = false OR ci.archived IS NULL)
    ORDER BY p.payment_date DESC, ci.fullname ASC
  `;

  const result = await pool.query(query, [start, end, allowedCounsellorIds]);

  const toPaymentType = (raw: string | null | undefined): string => {
    if (!raw) return "";
    if (PRODUCT_DISPLAY_NAMES[raw]) return PRODUCT_DISPLAY_NAMES[raw];
    return raw
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const data: PaymentsListRow[] = result.rows.map((row) => ({
    paymentId: row.payment_id ? Number(row.payment_id) : null,
    clientId: row.client_id ? Number(row.client_id) : null,
    saleTypeId: row.sale_type_id ? Number(row.sale_type_id) : null,
    totalPayment: row.total_payment ?? null,
    invoiceNo: row.invoice_no ?? null,
    remarks: row.remarks ?? null,
    source: row.source === "payment" ? "payment" : "product",
    date: formatDisplayDate(row.payment_date),
    clientName: row.client_name ?? "",
    paymentType: toPaymentType(row.payment_type),
    amount: row.amount != null ? String(row.amount) : "0",
    clientOwner: row.client_owner ?? "",
    addedBy: row.added_by ?? "",
    sharedClient: row.shared_client === "Yes" ? "Yes" : "No",
    archived: row.archived === true,
  }));

  return {
    filter,
    startDate: start,
    endDate: end,
    counsellorId: counsellorId ?? null,
    total: data.length,
    data,
  };
};