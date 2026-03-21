import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { simCard } from "../schemas/simCard.schema";
import { insurance } from "../schemas/insurance.schema";
import { beaconAccount } from "../schemas/beaconAccount.schema";
import { airTicket } from "../schemas/airTicket.schema";
import { loan } from "../schemas/loan.schema";
import { forexCard } from "../schemas/forexCard.schema";
import { forexFees } from "../schemas/forexFees.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { creditCard } from "../schemas/creditCard.schema";
import { visaExtension } from "../schemas/visaExtension.schema";
import { newSell } from "../schemas/newSell.schema";
import { ielts } from "../schemas/ielts.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import {
  getCounsellorCoreSaleAmount,
  getCounsellorCoreProductMetrics,
  getCounsellorOtherProductMetrics,
} from "./leaderboard.model";
import {
  getPendingAmountByCounsellors,
  getSaleTypeCategoryCounts,
  type DateRange,
} from "./dashboard.model";
import {
  getRevenueBySaleTypePerCounsellor,
  getEnrollmentCountBySaleTypePerCounsellor,
} from "./report.model";
import { getAllSaleTypes } from "./saleType.model";
import { eq, and, count, sql, inArray, gte, lte } from "drizzle-orm";

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════ */

const CORE_PRODUCT = "ALL_FINANCE_EMPLOYEMENT";

const COUNT_ONLY_PRODUCTS: readonly string[] = [
  "LOAN_DETAILS",
  "FOREX_CARD",
  "TUTION_FEES",
  "CREDIT_CARD",
  "SIM_CARD_ACTIVATION",
  "INSURANCE",
  "BEACON_ACCOUNT",
  "AIR_TICKET",
  "FOREX_FEES",
];

const COUNT_ONLY_ENTITY_TYPES: readonly string[] = [
  "loan_id",
  "forexCard_id",
  "tutionFees_id",
  "creditCard_id",
  "simCard_id",
  "insurance_id",
  "beaconAccount_id",
  "airTicket_id",
  "forexFees_id",
];

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

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

export interface CounsellorReportResult {
  counsellor: {
    id: number;
    full_name: string;
    email: string | null;
    designation: string | null;
    manager_id: number | null;
    manager_name: string | null;
  };
  filter: {
    start_date: string;
    end_date: string;
  };
  performance: {
    total_enrollments: number;
    total_revenue: number;
    core_sale_revenue: number;
    core_product_revenue: number;
    other_product_revenue: number;
    average_revenue_per_client: number;
    archived_count: number;
    /** Pending amount (outstanding) for this counsellor's clients (all time). */
    pending_amount: string;
    /** No filter = total_enrollments. With saleTypeId filter = number of client_payment rows for that sale type only. */
    sale_type_count: number;
  };
  monthly_comparison: {
    current_month: { revenue: number; start_date: string; end_date: string };
    last_month: { revenue: number; start_date: string; end_date: string };
    growth_percentage: number;
    target: number;
    achieved: number;
    target_achieved_percentage: number;
    rank: number;
    /** Counsellors counted for rank (e.g. "rank 5 of 14") – not client count. */
    rank_out_of: number;
  };
  product_analytics: {
    core_sale: {
      total_sales: number;
      revenue: number;
      average_ticket_size: number;
    };
    core_product: {
      product_name: string;
      display_name: string;
      total_sold: number;
      revenue: number;
      attachment_rate: number;
    };
    other_products: {
      company_revenue: {
        products: Array<{
          product_name: string;
          display_name: string;
          total_sold: number;
          revenue: number;
        }>;
        total_sold: number;
        total_revenue: number;
      };
      third_party: {
        products: Array<{
          product_name: string;
          display_name: string;
          total_sold: number;
          total_collected: number;
        }>;
        total_sold: number;
        total_collected: number;
      };
    };
  };
  /**
   * Same logic as dashboard `saleTypeCategoryCounts`: per sale-type category (student/visitor/spouse)
   * for this counsellor and report date range — count + amount.
   */
  sale_type_category_counts: Array<{
    category_id: number | null;
    category_name: string;
    count: number;
    amount: string;
  }>;
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/** Format date as YYYY-MM-DD in local time (avoids UTC shift breaking custom filter range). */
const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ═══════════════════════════════════════════════════════════════════
   ACCESS CONTROL
   Admin: any counsellor
   Manager (isSupervisor=true): any counsellor
   Manager (isSupervisor=false): only own team counsellors
   Counsellor: own report only
   ═══════════════════════════════════════════════════════════════════ */

export const canAccessCounsellorReport = async (
  viewerId: number,
  viewerRole: string,
  targetCounsellorId: number,
): Promise<boolean> => {
  if (viewerRole === "admin") return true;
  if (viewerRole === "counsellor") return viewerId === targetCounsellorId;

  if (viewerRole === "manager") {
    const [mgr] = await db
      .select({ isSupervisor: users.isSupervisor })
      .from(users)
      .where(eq(users.id, viewerId))
      .limit(1);
    if (!mgr) return false;
    if (mgr.isSupervisor) return true;

    const [counsellor] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, targetCounsellorId),
          eq(users.role, "counsellor"),
          eq(users.managerId, viewerId),
        ),
      )
      .limit(1);
    return !!counsellor;
  }

  return false;
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Archived client count for a counsellor
   ═══════════════════════════════════════════════════════════════════ */

const getArchivedCount = async (counsellorId: number): Promise<number> => {
  const [r] = await db
    .select({ count: count(clientInformation.clientId) })
    .from(clientInformation)
    .where(
      and(
        eq(clientInformation.archived, true),
        eq(clientInformation.counsellorId, counsellorId),
      ),
    );
  return r?.count ?? 0;
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Total revenue for a counsellor in a period
   (core sale + core product + other product)
   ═══════════════════════════════════════════════════════════════════ */

const getRevenueForPeriod = async (
  counsellorId: number,
  start: Date,
  end: Date,
): Promise<number> => {
  const s = toLocalDateStr(start);
  const e = toLocalDateStr(end);
  const sTs = start.toISOString();
  const eTs = end.toISOString();
  const [coreSale, coreProd, otherProd] = await Promise.all([
    getCounsellorCoreSaleAmount(counsellorId, s, e, sTs, eTs),
    getCounsellorCoreProductMetrics(counsellorId, s, e),
    getCounsellorOtherProductMetrics(counsellorId, s, e),
  ]);
  return coreSale + coreProd.amount + otherProd.amount;
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Target for counsellor in a month (from leaderBoard table)
   ═══════════════════════════════════════════════════════════════════ */

const getTargetForMonth = async (
  counsellorId: number,
  month: number,
  year: number,
): Promise<number> => {
  const [rec] = await db
    .select({ target: leaderBoard.target })
    .from(leaderBoard)
    .where(
      and(
        eq(leaderBoard.counsellor_id, counsellorId),
        sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${year}`,
        sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${month}`,
      ),
    )
    .limit(1);
  return rec?.target ?? 0;
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Distinct clients with core product (ALL_FINANCE_EMPLOYEMENT)
   payment in date range – used for attachment rate.
   ═══════════════════════════════════════════════════════════════════ */

const getCoreProductDistinctClientCount = async (
  counsellorId: number,
  startStr: string,
  endStr: string,
): Promise<number> => {
  const [r] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientProductPayments.clientId})`,
    })
    .from(clientProductPayments)
    .innerJoin(
      allFinance,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId}
          AND ${clientProductPayments.entityType} = 'allFinance_id'`,
    )
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId),
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND (${clientProductPayments.productName})::text = ${CORE_PRODUCT}
        AND (
          (${allFinance.paymentDate} IS NOT NULL
            AND ${allFinance.paymentDate} >= ${startStr}
            AND ${allFinance.paymentDate} <= ${endStr})
          OR
          (${allFinance.anotherPaymentDate} IS NOT NULL
            AND ${allFinance.anotherPaymentDate} >= ${startStr}
            AND ${allFinance.anotherPaymentDate} <= ${endStr})
        )
      )`,
    );
  return Number(r?.count ?? 0);
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Enrollment-based achieved count (same as dashboard leaderboard).
   Clients with enrollmentDate in period AND at least one Core Sale payment ever.
   ═══════════════════════════════════════════════════════════════════ */

const getEnrollmentBasedAchieved = async (
  counsellorId: number,
  startStr: string,
  endStr: string,
): Promise<number> => {
  const [r] = await db
    .select({ count: count() })
    .from(clientInformation)
    .where(
      and(
        eq(clientInformation.counsellorId, counsellorId),
        eq(clientInformation.archived, false),
        gte(clientInformation.enrollmentDate, startStr),
        lte(clientInformation.enrollmentDate, endStr),
        sql`${clientInformation.clientId} IN (
          SELECT client_id FROM client_payment
          WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
        )`,
      ),
    );
  return r?.count ?? 0;
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Rank among all counsellors (same as leaderboard).
   Sorted by enrollments DESC, then revenue DESC.
   ═══════════════════════════════════════════════════════════════════ */

const computeRank = async (
  counsellorId: number,
  start: Date,
  end: Date,
): Promise<{ rank: number; total_counsellors: number }> => {
  const s = toLocalDateStr(start);
  const e = toLocalDateStr(end);

  const allCounsellors = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "counsellor"));
  if (allCounsellors.length === 0) return { rank: 0, total_counsellors: 0 };

  const stats = await Promise.all(
    allCounsellors.map(async (c) => ({
      id: c.id,
      enrollments: await getEnrollmentBasedAchieved(c.id, s, e),
      revenue: await getRevenueForPeriod(c.id, start, end),
    })),
  );

  stats.sort((a, b) => {
    if (b.enrollments !== a.enrollments) return b.enrollments - a.enrollments;
    return b.revenue - a.revenue;
  });

  const rank = stats.findIndex((r) => r.id === counsellorId) + 1;
  return {
    rank: rank || allCounsellors.length,
    total_counsellors: allCounsellors.length,
  };
};

/* ═══════════════════════════════════════════════════════════════════
   INTERNAL: Per-product breakdown for "Other Products" section.
   Returns count + revenue + collected for every non-Core product
   sold by this counsellor in the date range.
   ═══════════════════════════════════════════════════════════════════ */

interface ProductItem {
  product_name: string;
  count: number;
  revenue: number;
  collected: number;
}

const getPerProductBreakdown = async (
  counsellorId: number,
  startStr: string,
  endStr: string,
): Promise<ProductItem[]> => {
  const result: ProductItem[] = [];

  const mergeOrPush = (item: ProductItem) => {
    const existing = result.find((r) => r.product_name === item.product_name);
    if (existing) {
      existing.count += item.count;
      existing.revenue += item.revenue;
      existing.collected += item.collected;
    } else {
      result.push({ ...item });
    }
  };

  // ── 1. master_only products (date & amount in client_product_payment) ──
  const masterRows = await db
    .select({
      productName: clientProductPayments.productName,
      cnt: count(),
      totalAmount: sql<string>`COALESCE(SUM(${clientProductPayments.amount}::numeric), 0)`,
    })
    .from(clientProductPayments)
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId),
    )
    .where(
      and(
        eq(clientInformation.counsellorId, counsellorId),
        eq(clientInformation.archived, false),
        sql`(${clientProductPayments.entityType})::text = 'master_only'`,
        sql`(${clientProductPayments.productName})::text != ${CORE_PRODUCT}`,
        sql`${clientProductPayments.paymentDate} IS NOT NULL`,
        sql`${clientProductPayments.paymentDate} >= ${startStr}`,
        sql`${clientProductPayments.paymentDate} <= ${endStr}`,
      ),
    )
    .groupBy(clientProductPayments.productName);

  for (const row of masterRows) {
    const amt = parseFloat(row.totalAmount || "0");
    mergeOrPush({
      product_name: row.productName,
      count: row.cnt,
      revenue: amt,
      collected: amt,
    });
  }

  // ── 2. Entity-based products (date & amount in entity tables) ──────────
  const entityPairs: Array<{
    type: string;
    table: any;
    idCol: any;
    dateCol: any;
    amountCol: any | null;
  }> = [
    { type: "visaextension_id", table: visaExtension, idCol: visaExtension.id, dateCol: visaExtension.extensionDate, amountCol: visaExtension.amount },
    { type: "newSell_id", table: newSell, idCol: newSell.id, dateCol: newSell.sellDate, amountCol: newSell.amount },
    { type: "ielts_id", table: ielts, idCol: ielts.id, dateCol: ielts.enrollmentDate, amountCol: ielts.amount },
    { type: "simCard_id", table: simCard, idCol: simCard.id, dateCol: simCard.simCardGivingDate, amountCol: null },
    { type: "insurance_id", table: insurance, idCol: insurance.id, dateCol: insurance.insuranceDate, amountCol: insurance.amount },
    { type: "beaconAccount_id", table: beaconAccount, idCol: beaconAccount.id, dateCol: beaconAccount.openingDate, amountCol: beaconAccount.amount },
    { type: "airTicket_id", table: airTicket, idCol: airTicket.id, dateCol: airTicket.ticketDate, amountCol: airTicket.amount },
    { type: "loan_id", table: loan, idCol: loan.id, dateCol: loan.disbursmentDate, amountCol: loan.amount },
    { type: "forexCard_id", table: forexCard, idCol: forexCard.id, dateCol: forexCard.cardDate, amountCol: null },
    { type: "forexFees_id", table: forexFees, idCol: forexFees.id, dateCol: forexFees.feeDate, amountCol: forexFees.amount },
    { type: "tutionFees_id", table: tutionFees, idCol: tutionFees.id, dateCol: tutionFees.feeDate, amountCol: null },
    { type: "creditCard_id", table: creditCard, idCol: creditCard.id, dateCol: creditCard.cardDate, amountCol: null },
  ];

  for (const { type, table, idCol, dateCol, amountCol } of entityPairs) {
    const rows = await db
      .select({
        productName: clientProductPayments.productName,
        entityId: clientProductPayments.entityId,
      })
      .from(clientProductPayments)
      .innerJoin(table, eq(clientProductPayments.entityId, idCol))
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId),
      )
      .where(
        and(
          eq(clientInformation.counsellorId, counsellorId),
          eq(clientInformation.archived, false),
          sql`${clientProductPayments.entityType} = ${type}`,
          sql`(${clientProductPayments.productName})::text != ${CORE_PRODUCT}`,
          sql`${dateCol} IS NOT NULL`,
          gte(dateCol, startStr),
          lte(dateCol, endStr),
        ),
      );

    if (rows.length === 0) continue;

    const grouped: Record<string, { count: number; entityIds: number[] }> = {};
    for (const r of rows) {
      if (!grouped[r.productName]) grouped[r.productName] = { count: 0, entityIds: [] };
      grouped[r.productName].count++;
      if (r.entityId) grouped[r.productName].entityIds.push(r.entityId);
    }

    for (const [productName, data] of Object.entries(grouped)) {
      let collected = 0;
      if (amountCol && data.entityIds.length > 0) {
        const [amtR] = await db
          .select({ total: sql<string>`COALESCE(SUM(${amountCol}::numeric), 0)` })
          .from(table)
          .where(inArray(idCol, data.entityIds));
        collected = parseFloat(amtR?.total || "0");
      }

      const isCountOnly = COUNT_ONLY_ENTITY_TYPES.includes(type);
      mergeOrPush({
        product_name: productName,
        count: data.count,
        revenue: isCountOnly ? 0 : collected,
        collected,
      });
    }
  }

  return result;
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN: Individual Counsellor Report
   ═══════════════════════════════════════════════════════════════════ */

/** Optional explicit date strings (YYYY-MM-DD) and filter for report logic (e.g. yearly → current year vs previous year). */
export interface CounsellorReportDateOptions {
  startDateStr?: string;
  endDateStr?: string;
  /** When "yearly", monthly_comparison shows current year vs previous year instead of month vs last month. */
  filter?: "today" | "weekly" | "monthly" | "yearly" | "custom";
  /** When set, report is filtered by this sale type and performance includes sale_type_count. */
  saleTypeId?: number;
}

export const getCounsellorReport = async (
  counsellorId: number,
  dateRange: { start: Date; end: Date },
  dateOptions?: CounsellorReportDateOptions,
): Promise<CounsellorReportResult> => {
  // ── Counsellor info ────────────────────────────────────────────
  const [counsellor] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      designation: users.designation,
      managerId: users.managerId,
    })
    .from(users)
    .where(and(eq(users.id, counsellorId), eq(users.role, "counsellor")))
    .limit(1);

  if (!counsellor) throw new Error("Counsellor not found");

  let managerName: string | null = null;
  if (counsellor.managerId) {
    const [mgr] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, counsellor.managerId))
      .limit(1);
    managerName = mgr?.fullName ?? null;
  }

  // ── Prepare date strings and timestamps ─────────────────────────
  // When custom filter: use raw YYYY-MM-DD strings so data matches exactly the selected range
  const startStr =
    dateOptions?.startDateStr ?? toLocalDateStr(dateRange.start);
  const endStr = dateOptions?.endDateStr ?? toLocalDateStr(dateRange.end);
  // Timestamps for createdAt fallback: parse as local start/end of day so range is consistent
  const startTs =
    dateOptions?.startDateStr != null
      ? (() => {
          const [y, m, d] = dateOptions.startDateStr!.split("-").map(Number);
          return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
        })()
      : dateRange.start.toISOString();
  const endTs =
    dateOptions?.endDateStr != null
      ? (() => {
          const [y, m, d] = dateOptions.endDateStr!.split("-").map(Number);
          return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
        })()
      : dateRange.end.toISOString();

  // Comparison period: today → today vs yesterday; weekly → this week vs last week; monthly/yearly → month vs last month / year vs last year
  const filterType = dateOptions?.filter ?? "monthly";
  const filterYear = dateRange.end.getFullYear();
  const filterMonth = dateRange.end.getMonth();
  const isYearly = filterType === "yearly";
  const isToday = filterType === "today";
  const isWeekly = filterType === "weekly";

  let cmStart: Date;
  let cmEnd: Date;
  let lmStart: Date;
  let lmEnd: Date;

  if (isToday) {
    cmStart = new Date(dateRange.start);
    cmEnd = new Date(dateRange.end);
    const d = dateRange.end.getDate();
    const m = dateRange.end.getMonth();
    const y = dateRange.end.getFullYear();
    lmEnd = new Date(y, m, d - 1, 23, 59, 59, 999);
    lmStart = new Date(y, m, d - 1, 0, 0, 0, 0);
  } else if (isWeekly) {
    cmStart = new Date(dateRange.start);
    cmEnd = new Date(dateRange.end);
    const mon = new Date(dateRange.start);
    lmEnd = new Date(mon);
    lmEnd.setDate(lmEnd.getDate() - 1);
    lmEnd.setHours(23, 59, 59, 999);
    lmStart = new Date(lmEnd);
    lmStart.setDate(lmStart.getDate() - 6);
    lmStart.setHours(0, 0, 0, 0);
  } else if (isYearly) {
    cmStart = new Date(filterYear, 0, 1);
    cmEnd = new Date(filterYear, 11, 31, 23, 59, 59, 999);
    lmStart = new Date(filterYear - 1, 0, 1);
    lmEnd = new Date(filterYear - 1, 11, 31, 23, 59, 59, 999);
  } else {
    cmStart = new Date(filterYear, filterMonth, 1);
    cmEnd = new Date(filterYear, filterMonth + 1, 0, 23, 59, 59, 999);
    lmStart = new Date(filterYear, filterMonth - 1, 1);
    lmEnd = new Date(filterYear, filterMonth, 0, 23, 59, 59, 999);
  }

  const cmStartStr = toLocalDateStr(cmStart);
  const cmEndStr = toLocalDateStr(cmEnd);
  const cmStartTs = new Date(cmStart.getFullYear(), cmStart.getMonth(), cmStart.getDate(), 0, 0, 0, 0).toISOString();
  const cmEndTs = new Date(cmEnd.getFullYear(), cmEnd.getMonth(), cmEnd.getDate(), 23, 59, 59, 999).toISOString();
  const lmStartStr = toLocalDateStr(lmStart);
  const lmEndStr = toLocalDateStr(lmEnd);
  const lmStartTs = new Date(lmStart.getFullYear(), lmStart.getMonth(), lmStart.getDate(), 0, 0, 0, 0).toISOString();
  const lmEndTs = new Date(lmEnd.getFullYear(), lmEnd.getMonth(), lmEnd.getDate(), 23, 59, 59, 999).toISOString();

  // Same date window as dashboard `saleTypeCategoryCounts` for this counsellor
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const saleTypeCategoryDateRange: DateRange = {
    start: new Date(sy, sm - 1, sd, 0, 0, 0, 0),
    end: new Date(ey, em - 1, ed, 23, 59, 59, 999),
  };
  const saleTypeCategoryRoleFilter = {
    userRole: "counsellor" as const,
    userId: counsellorId,
    counsellorId,
  };

  // ── Parallel data fetch ────────────────────────────────────────
  let [
    enrollments,
    coreSaleRev,
    coreProductMetrics,
    otherProductMetrics,
    archivedCount,
    currentPeriodRev,
    lastPeriodRev,
    target,
    currentPeriodAchieved,
    rankData,
    productBreakdown,
    coreProductClients,
    pendingByCounsellor,
    saleTypeCategoryRows,
  ] = await Promise.all([
    getEnrollmentBasedAchieved(counsellorId, startStr, endStr),
    getCounsellorCoreSaleAmount(counsellorId, startStr, endStr, startTs, endTs),
    getCounsellorCoreProductMetrics(counsellorId, startStr, endStr),
    getCounsellorOtherProductMetrics(counsellorId, startStr, endStr),
    getArchivedCount(counsellorId),
    getRevenueForPeriod(counsellorId, cmStart, cmEnd),
    getRevenueForPeriod(counsellorId, lmStart, lmEnd),
    isYearly
      ? (async () => {
          let sum = 0;
          for (let m = 1; m <= 12; m++) sum += await getTargetForMonth(counsellorId, m, filterYear);
          return sum;
        })()
      : isToday || isWeekly
        ? Promise.resolve(0)
        : getTargetForMonth(counsellorId, filterMonth + 1, filterYear),
    getEnrollmentBasedAchieved(counsellorId, cmStartStr, cmEndStr),
    computeRank(counsellorId, cmStart, cmEnd),
    getPerProductBreakdown(counsellorId, startStr, endStr),
    getCoreProductDistinctClientCount(counsellorId, startStr, endStr),
    getPendingAmountByCounsellors([counsellorId]),
    getSaleTypeCategoryCounts(saleTypeCategoryDateRange, saleTypeCategoryRoleFilter),
  ]);

  // ── sale_type_count: when filter used = payment count (client_payment rows) for that sale type only; when no filter = total enrollments ─
  let saleTypeCount: number;
  const saleTypeIdNum = dateOptions?.saleTypeId != null ? Number(dateOptions.saleTypeId) : null;
  if (saleTypeIdNum != null) {
    const saleTypesList = await getAllSaleTypes();
    const st = saleTypesList.find((s) => s.id === saleTypeIdNum);
    if (st) {
      const [revMain, enrollMain, revCm, revLm, enrollCm] = await Promise.all([
        getRevenueBySaleTypePerCounsellor([counsellorId], startStr, endStr, startTs, endTs),
        getEnrollmentCountBySaleTypePerCounsellor(
          [counsellorId],
          startStr,
          endStr,
          startTs,
          endTs,
          saleTypeIdNum,
        ),
        getRevenueBySaleTypePerCounsellor([counsellorId], cmStartStr, cmEndStr, cmStartTs, cmEndTs),
        getRevenueBySaleTypePerCounsellor([counsellorId], lmStartStr, lmEndStr, lmStartTs, lmEndTs),
        getEnrollmentCountBySaleTypePerCounsellor(
          [counsellorId],
          cmStartStr,
          cmEndStr,
          cmStartTs,
          cmEndTs,
          saleTypeIdNum,
        ),
      ]);
      enrollments = Number(enrollMain.get(counsellorId) ?? 0);
      coreSaleRev = revMain.get(counsellorId)?.get(saleTypeIdNum) ?? 0;
      saleTypeCount = Number(enrollMain.get(counsellorId) ?? 0);
      currentPeriodRev = revCm.get(counsellorId)?.get(saleTypeIdNum) ?? 0;
      lastPeriodRev = revLm.get(counsellorId)?.get(saleTypeIdNum) ?? 0;
      currentPeriodAchieved = Number(enrollCm.get(counsellorId) ?? 0);
      coreProductMetrics = { amount: 0, count: 0 };
      otherProductMetrics = { amount: 0, count: 0 };
    } else {
      saleTypeCount = 0;
    }
  } else {
    // No filter: total distinct clients (enrollments) in the period – same as total_enrollments, so sale_type_count is always "client count"
    saleTypeCount = enrollments;
  }

  // ── Build performance ──────────────────────────────────────────
  const totalRevenue = coreSaleRev + coreProductMetrics.amount + otherProductMetrics.amount;
  const avgPerClient = enrollments > 0 ? totalRevenue / enrollments : 0;

  // ── Monthly comparison ─────────────────────────────────────────
  const growthPct =
    lastPeriodRev > 0
      ? ((currentPeriodRev - lastPeriodRev) / lastPeriodRev) * 100
      : currentPeriodRev > 0
        ? 100
        : 0;
  const targetAchievedPct = target > 0 ? (currentPeriodAchieved / target) * 100 : 0;

  // ── Product analytics ──────────────────────────────────────────
  const coreSaleTicket = enrollments > 0 ? coreSaleRev / enrollments : 0;
  const attachmentRate = enrollments > 0 ? (coreProductClients / enrollments) * 100 : 0;

  const companyProducts = productBreakdown.filter(
    (p) => !COUNT_ONLY_PRODUCTS.includes(p.product_name),
  );
  const thirdPartyProducts = productBreakdown.filter(
    (p) => COUNT_ONLY_PRODUCTS.includes(p.product_name),
  );

  // ── Return ─────────────────────────────────────────────────────
  return {
    counsellor: {
      id: counsellor.id,
      full_name: counsellor.fullName,
      email: counsellor.email,
      designation: counsellor.designation,
      manager_id: counsellor.managerId,
      manager_name: managerName,
    },
    filter: {
      start_date: startStr,
      end_date: endStr,
    },
    performance: {
      total_enrollments: enrollments,
      total_revenue: round2(totalRevenue),
      core_sale_revenue: round2(coreSaleRev),
      core_product_revenue: round2(coreProductMetrics.amount),
      other_product_revenue: round2(otherProductMetrics.amount),
      average_revenue_per_client: round2(avgPerClient),
      archived_count: archivedCount,
      pending_amount: pendingByCounsellor.get(counsellorId) ?? "0.00",
      /** No filter: total payment count (all sale types). With saleTypeId filter: distinct clients for that sale type only. */
      sale_type_count: saleTypeCount,
    },
    monthly_comparison: {
      current_month: {
        revenue: round2(currentPeriodRev),
        start_date: toLocalDateStr(cmStart),
        end_date: toLocalDateStr(cmEnd),
      },
      last_month: {
        revenue: round2(lastPeriodRev),
        start_date: toLocalDateStr(lmStart),
        end_date: toLocalDateStr(lmEnd),
      },
      growth_percentage: round2(growthPct),
      target,
      achieved: currentPeriodAchieved,
      target_achieved_percentage: round2(targetAchievedPct),
      rank: rankData.rank,
      rank_out_of: rankData.total_counsellors,
    },
    product_analytics: {
      core_sale: {
        total_sales: enrollments,
        revenue: round2(coreSaleRev),
        average_ticket_size: round2(coreSaleTicket),
      },
      core_product: {
        product_name: CORE_PRODUCT,
        display_name: PRODUCT_DISPLAY_NAMES[CORE_PRODUCT] || CORE_PRODUCT,
        total_sold: coreProductMetrics.count,
        revenue: round2(coreProductMetrics.amount),
        attachment_rate: round2(attachmentRate),
      },
      other_products: {
        company_revenue: {
          products: companyProducts.map((p) => ({
            product_name: p.product_name,
            display_name: PRODUCT_DISPLAY_NAMES[p.product_name] || p.product_name,
            total_sold: p.count,
            revenue: round2(p.revenue),
          })),
          total_sold: companyProducts.reduce((sum, p) => sum + p.count, 0),
          total_revenue: round2(companyProducts.reduce((sum, p) => sum + p.revenue, 0)),
        },
        third_party: {
          products: thirdPartyProducts.map((p) => ({
            product_name: p.product_name,
            display_name: PRODUCT_DISPLAY_NAMES[p.product_name] || p.product_name,
            total_sold: p.count,
            total_collected: round2(p.collected),
          })),
          total_sold: thirdPartyProducts.reduce((sum, p) => sum + p.count, 0),
          total_collected: round2(thirdPartyProducts.reduce((sum, p) => sum + p.collected, 0)),
        },
      },
    },
    sale_type_category_counts: saleTypeCategoryRows.map((c) => ({
      category_id: c.categoryId,
      category_name: c.categoryName,
      count: c.count,
      amount: c.amount,
    })),
  };
};
