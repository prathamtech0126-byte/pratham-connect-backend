import { db } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { beaconAccount } from "../schemas/beaconAccount.schema";
import { insurance } from "../schemas/insurance.schema";
import { airTicket } from "../schemas/airTicket.schema";
import { forexFees } from "../schemas/forexFees.schema";
import { forexCard } from "../schemas/forexCard.schema";
import { newSell } from "../schemas/newSell.schema";
import { creditCard } from "../schemas/creditCard.schema";
import { ielts } from "../schemas/ielts.schema";
import { loan } from "../schemas/loan.schema";
import { visaExtension } from "../schemas/visaExtension.schema";
import { simCard } from "../schemas/simCard.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { users } from "../schemas/users.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import { calculateCounsellorRevenue } from "./leaderboard.model";
import { eq, and, gte, lte, sql, count, inArray, isNotNull } from "drizzle-orm";

/* ==============================
   TYPES
============================== */
export type DashboardFilter = "today" | "weekly" | "monthly" | "yearly" | "custom";
export type UserRole = "admin" | "manager" | "counsellor";

// Product classification constants
const CORE_PRODUCT = "ALL_FINANCE_EMPLOYEMENT";
const COUNT_ONLY_PRODUCTS = [
  "LOAN_DETAILS", // count only product not contribute to revenue
  "FOREX_CARD", // count only product not contribute to revenue
  "TUTION_FEES", // count only product not contribute to revenue
  "CREDIT_CARD", // count only product not contribute to revenue
  "SIM_CARD_ACTIVATION", // count only product not contribute to revenue
  "INSURANCE", // count only product not contribute to revenue
  "BEACON_ACCOUNT", // count only product not contribute to revenue
  "AIR_TICKET", // count only product not contribute to revenue
  "FOREX_FEES", // count only product not contribute to revenue
] as const;

// Count-only entity types (these don't contribute to revenue)
const COUNT_ONLY_ENTITY_TYPES = [
  "loan_id",
  "forexCard_id",
  "tutionFees_id",
  "creditCard_id",
  "simCard_id",
  "insurance_id",
  "beaconAccount_id",
  "airTicket_id",
  "forexFees_id",
] as const;

// Admin/Manager Dashboard Stats
export interface AdminManagerDashboardStats {
  // newEnrollment: {
  //   count: number;
  // };
  coreSale: {
    number: number; // Count
    amount: string; // Sum
  };
  coreProduct: {
    number: number; // Count
    amount: string; // Sum
  };
  otherProduct: {
    number: number; // Count
    amount: string; // Sum
  };
  totalPendingAmount: {
    amount: string;
  };
  totalClients: {
    count: number; // Distinct clients with INITIAL/BEFORE_VISA/AFTER_VISA payment in period
  };
  revenue: {
    amount: string; // Core Sale Amount + Core Product Amount + Other Product Amount
  };
  leaderboard: Array<{
    counsellorId: number;
    fullName: string;
    email: string;
    empId: string | null;
    managerId: number | null;
    designation: string | null;
    enrollments: number;
    revenue: number;
    target: number;
    achievedTarget: number;
    targetId: number | null;
    rank: number;
  }>;
  chartData: {
    data: Array<{
      label: string;
      coreSale: { count: number; amount: number };
      coreProduct: { count: number; amount: number };
      otherProduct: { count: number; amount: number };
      revenue: number;
    }>;
    summary: {
      total: number;
    };
  };
}

// Counsellor Dashboard Stats
export interface CounsellorDashboardStats {
  coreSale: {
    number: number; // Count only, no amount
  };
  coreProduct: {
    number: number; // Count only, no amount
  };
  otherProduct: {
    number: number; // Count only, no amount
  };
  totalPendingAmount: {
    amount: string;
  };
  totalClients: {
    count: number;
  };
  // newEnrollment: {
  //   count: number;
  // };
  leaderboard: Array<{
    counsellorId: number;
    fullName: string;
    email: string;
    empId: string | null;
    managerId: number | null;
    designation: string | null;
    enrollments: number;
    revenue: number;
    target: number;
    achievedTarget: number;
    targetId: number | null;
    rank: number;
  }>;
  individualPerformance: {
    current: number;
    previous: number;
    change: number;
    changeType: "increase" | "decrease" | "no-change";
    periodLabel: string;
  };
  chartData: {
    data: Array<{
      label: string;
      clientCount: number;
    }>;
    summary: {
      total: number;
    };
  };
}

const toLocalDateString = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};


// Union type for dashboard stats
export type DashboardStats = AdminManagerDashboardStats | CounsellorDashboardStats;

interface DateRange {
  start: Date;
  end: Date;
  previousStart?: Date; // Optional - not used in rolling window analytics
  previousEnd?: Date; // Optional - not used in rolling window analytics
}

interface RoleBasedFilter {
  userId?: number;
  userRole: UserRole;
  counsellorId?: number; // For counsellor role
}

/* ==============================
   HELPER: Check if product is count-only
============================== */
const isCountOnlyEntityType = (entityType: string): boolean => {
  return COUNT_ONLY_ENTITY_TYPES.includes(entityType as any);
};

/* ==============================
   HELPER: Build counsellor filter condition
============================== */
const buildCounsellorFilter = (
  filter: RoleBasedFilter,
  clientTable: any
): any => {
  if (filter.userRole === "counsellor" && filter.counsellorId) {
    return eq(clientTable.counsellorId, filter.counsellorId);
  }
  return undefined; // No filter for admin/manager
};

/* ==============================
   DATE RANGE HELPERS
============================== */
const getDateRange = (
  filter: DashboardFilter,
  beforeDate?: string,
  afterDate?: string
): DateRange => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  let start: Date;
  let end: Date = endOfToday;

  switch (filter) {
    case "today": {
      // Today filter: Use 7 days for chart data (same as weekly)
      // Rolling 7 days: 7 days back to today
      const daysToSubtract = 7;
      start = new Date(now);
      start.setDate(now.getDate() - daysToSubtract);
      start.setHours(0, 0, 0, 0);
      end = new Date(endOfToday);
      break;
    }
    // case "weekly": {
    //   // Rolling 7 days: Same weekday last week to today
    //   // Get current weekday (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    //   const currentDayOfWeek = now.getDay();
    //   // Calculate days to subtract to get to same weekday last week
    //   const daysToSubtract = 7;
    //   start = new Date(now);
    //   start.setDate(now.getDate() - daysToSubtract);
    //   start.setHours(0, 0, 0, 0);
    //   end = new Date(endOfToday);
    //   break;
    // }
    // case "monthly": {
    //   // Rolling ~30 days: Same date of previous month to today
    //   const currentDate = now.getDate();
    //   const currentMonth = now.getMonth();
    //   const currentYear = now.getFullYear();

    //   // Go back one month
    //   let targetMonth = currentMonth - 1;
    //   let targetYear = currentYear;

    //   if (targetMonth < 0) {
    //     targetMonth = 11;
    //     targetYear = currentYear - 1;
    //   }

    //   // Get last day of target month
    //   const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    //   // Use same date, or last day of month if date doesn't exist
    //   const targetDate = Math.min(currentDate, lastDayOfTargetMonth);

    //   start = new Date(targetYear, targetMonth, targetDate);
    //   start.setHours(0, 0, 0, 0);
    //   end = new Date(endOfToday);
    //   break;
    // }
    case "weekly": {
      const day = now.getDay(); // 0=Sun,1=Mon,...6=Sat

      // Calculate how many days to go back to Monday
      const diffToMonday = (day + 6) % 7;

      // Monday
      start = new Date(now);
      start.setDate(now.getDate() - diffToMonday);
      start.setHours(0, 0, 0, 0);

      // Sunday
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      break;
    }

    case "monthly": {
      // Strictly current calendar month only (1st 00:00 to last day 23:59). No last month / next month.
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);

      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);

      break;
    }


    case "yearly": {
      // Rolling 12 months: Same month of previous year to today
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const targetYear = currentYear - 2;

      // Start from same month of previous year, day 1
      start = new Date(targetYear, currentMonth, 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(endOfToday);
      break;
    }
    case "custom": {
      if (!beforeDate || !afterDate) {
        throw new Error("Custom filter requires beforeDate and afterDate (YYYY-MM-DD).");
      }
      const beforeDateObj = parseLocalDate(beforeDate);
      const afterDateObj = parseLocalDate(afterDate);
      if (isNaN(beforeDateObj.getTime()) || isNaN(afterDateObj.getTime())) {
        throw new Error("Invalid beforeDate or afterDate for custom filter.");
      }
      if (beforeDateObj > afterDateObj) {
        throw new Error("beforeDate must be on or before afterDate.");
      }
      beforeDateObj.setHours(0, 0, 0, 0);
      afterDateObj.setHours(23, 59, 59, 999);
      start = beforeDateObj;
      end = afterDateObj;
      break;
    }

    default:
      throw new Error("Invalid filter type");
  }

  // No previous period calculation for rolling window analytics
  return { start, end };
};

/**
 * Returns date range for "today only" (current calendar day 00:00:00 to 23:59:59).
 * Used for: coreSale, coreProduct, revenue.
 */
const getTodayOnlyDateRange = (): DateRange => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

/**
 * Returns "all time" date range (from year 2000 to end of today).
 * Used for: newEnrollment (total client count), totalPendingAmount (all clients' pending).
 */
const getAllTimeDateRange = (): DateRange => {
  const now = new Date();
  const start = new Date(2000, 0, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

/* ==============================
   TOTAL CLIENTS
   Same as Core Service / leaderboard: by ENROLLMENT DATE in period.
   Count = clients whose enrollment_date is in the period and who have at least
   one INITIAL/BEFORE_VISA/AFTER_VISA payment (any date). One client = one count.
============================== */
const getTotalClients = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<number> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);

  const conditions: any[] = [
    eq(clientInformation.archived, false),
    gte(clientInformation.enrollmentDate, startDateStr),
    lte(clientInformation.enrollmentDate, endDateStr),
    sql`${clientInformation.clientId} IN (
      SELECT client_id FROM client_payment
      WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    )`,
  ];

  const counsellorFilter = filter ? buildCounsellorFilter(filter, clientInformation) : undefined;
  if (counsellorFilter) {
    conditions.push(counsellorFilter);
  }

  const [result] = await db
    .select({ count: count() })
    .from(clientInformation)
    .where(and(...conditions));

  return Number(result?.count ?? 0);
};


/* ==============================
   CORE SERVICE COUNT (Core Sale)
   Count each client only once. Period = by client ENROLLMENT DATE (not payment dates).
   Client must have at least one INITIAL/BEFORE_VISA/AFTER_VISA payment (any date).
   So one client with INITIAL + BEFORE_VISA + AFTER_VISA is counted once in the period of their enrollment_date.
   Revenue is unchanged (sum of amounts).
============================== */
const getCoreServiceCount = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<number> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);

  const conditions: any[] = [
    eq(clientInformation.archived, false),
    gte(clientInformation.enrollmentDate, startDateStr),
    lte(clientInformation.enrollmentDate, endDateStr),
    sql`${clientInformation.clientId} IN (
      SELECT client_id FROM client_payment
      WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    )`,
  ];
  if (filter?.userRole === "counsellor" && filter.counsellorId) {
    conditions.push(eq(clientInformation.counsellorId, filter.counsellorId));
  }

  const [result] = await db
    .select({ count: count() })
    .from(clientInformation)
    .where(and(...conditions));

  return Number(result?.count || "0");
};


/* ==============================
   HELPER: Get Entity Amounts
============================== */
const getEntityAmounts = async (
  entityType: string,
  entityIds: number[]
): Promise<number> => {
  if (entityIds.length === 0) return 0;

  try {
    let table: any;
    let amountColumn: any;

        switch (entityType) {
          case "beaconAccount_id":
            table = beaconAccount;
            amountColumn = beaconAccount.amount;
            break;
          case "insurance_id":
            table = insurance;
            amountColumn = insurance.amount;
            break;
          case "airTicket_id":
            table = airTicket;
            amountColumn = airTicket.amount;
            break;
          case "tutionFees_id":
            // TutionFees doesn't have an amount column, skip it
            return 0;
          case "forexFees_id":
            table = forexFees;
            amountColumn = forexFees.amount;
            break;
          case "newSell_id":
            table = newSell;
            amountColumn = newSell.amount;
            break;
          case "creditCard_id":
            table = creditCard;
            // amountColumn = creditCard.amount;
            break;
          case "ielts_id":
            table = ielts;
            amountColumn = ielts.amount;
            break;
          case "loan_id":
            table = loan;
            amountColumn = loan.amount;
            break;
          case "visaextension_id":
            table = visaExtension;
            amountColumn = visaExtension.amount;
            break;
          case "allFinance_id":
            table = allFinance;
            amountColumn = allFinance.amount;
            break;
          default:
            return 0;
        }

    if (table && amountColumn) {
      const [result] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${amountColumn}::numeric), 0)`,
        })
        .from(table)
        .where(inArray(table.id, entityIds));

      return parseFloat(result?.total || "0");
    }
  } catch (error) {
    console.error(`Error fetching ${entityType} amounts:`, error);
  }

  return 0;
};

/* ==============================
   PENDING AMOUNT (OUTSTANDING)
============================== */
const getPendingAmount = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<{ pendingAmount: string; breakdown: { initial: string; beforeVisa: string; afterVisa: string; submittedVisa: string } }> => {
  // Get clients filtered by date range (enrollment date within the period)
  const startStr = toLocalDateString(dateRange.start);
  const endStr = toLocalDateString(dateRange.end);
  const conditions: any[] = [
    eq(clientInformation.archived, false),
    gte(clientInformation.enrollmentDate, startStr),
    lte(clientInformation.enrollmentDate, endStr),
  ];

  const counsellorFilter = filter ? buildCounsellorFilter(filter, clientInformation) : undefined;
  if (counsellorFilter) {
    conditions.push(counsellorFilter);
  }

  const clients = await db
    .select({
      clientId: clientInformation.clientId,
    })
    .from(clientInformation)
    .where(and(...conditions));

  if (clients.length === 0) {
    return {
      pendingAmount: "0.00",
      breakdown: {
        initial: "0.00",
        beforeVisa: "0.00",
        afterVisa: "0.00",
        submittedVisa: "0.00",
      },
    };
  }

  // Get ALL client payments grouped by stage (for all clients)
  const clientIds = clients.map((c) => c.clientId);

  // Calculate total expected from clientPayments.totalPayment
  // Each client payment has a totalPayment field which represents the expected total for that client
  // We need to get the unique totalPayment per client (since multiple payments can have the same totalPayment)
  const clientPaymentsForExpected = clientIds.length > 0 ? await db
    .select({
      clientId: clientPayments.clientId,
      totalPayment: clientPayments.totalPayment,
    })
    .from(clientPayments)
    .where(inArray(clientPayments.clientId, clientIds))
    : [];

  // Group by clientId and get the unique totalPayment per client
  // (All payments for a client should have the same totalPayment, so we take the first one)
  const clientExpectedMap = new Map<number, number>();
  clientPaymentsForExpected.forEach((payment) => {
    if (!clientExpectedMap.has(payment.clientId)) {
      const totalPayment = payment.totalPayment ? parseFloat(payment.totalPayment) : 0;
      clientExpectedMap.set(payment.clientId, totalPayment);
    }
  });

  // Calculate total expected: sum of unique totalPayment for each client
  let totalExpected = 0;
  clientExpectedMap.forEach((expected) => {
    totalExpected += expected;
  });

  // Clients without payments have expected amount of 0
  // (Previously used saleTypes.amount, but saleType is no longer part of client)

  // Get client payments grouped by stage using amount (individual payment amount, not totalPayment)
  // This sums all individual payment amounts for each stage across all clients
  const clientPaymentsByStage = clientIds.length > 0 ? await db
    .select({
      stage: clientPayments.stage,
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .where(inArray(clientPayments.clientId, clientIds))
    .groupBy(clientPayments.stage)
    : [];

  // Initialize breakdown
  const breakdown = {
    initial: "0.00",
    beforeVisa: "0.00",
    afterVisa: "0.00",
    submittedVisa: "0.00",
  };

  let totalPaid = 0; // Only INITIAL + BEFORE_VISA + AFTER_VISA
  clientPaymentsByStage.forEach((payment) => {
    const amount = parseFloat(payment.total || "0");

    switch (payment.stage) {
      case "INITIAL":
        breakdown.initial = amount.toFixed(2);
        totalPaid += amount; // Include in pending calculation
        break;
      case "BEFORE_VISA":
        breakdown.beforeVisa = amount.toFixed(2);
        totalPaid += amount; // Include in pending calculation
        break;
      case "AFTER_VISA":
        breakdown.afterVisa = amount.toFixed(2);
        totalPaid += amount; // Include in pending calculation
        break;
      case "SUBMITTED_VISA":
        breakdown.submittedVisa = amount.toFixed(2);
        // Don't add to totalPaid - SUBMITTED_VISA is not counted for pending
        break;
    }
  });

  // Debug logging to trace the calculation
  // console.log("=== PENDING AMOUNT CALCULATION DEBUG ===");
  // console.log("Total Clients:", clients.length);
  // console.log("Clients with payments:", clientExpectedMap.size);
  // console.log("Clients without payments:", clientsWithoutPayments.length);
  // console.log("Total Expected (from clientPayments.totalPayment):", totalExpected);
  // console.log("Total Paid (INITIAL + BEFORE_VISA + AFTER_VISA):", totalPaid);
  // console.log("Breakdown:", breakdown);
  // console.log("Calculated Pending Amount:", totalExpected - totalPaid);
  // console.log("========================================");

  // Calculate pending amount: totalExpected - (initial + beforeVisa + afterVisa)
  const pendingAmount = totalExpected - totalPaid;

  return {
    pendingAmount: Math.max(0, pendingAmount).toFixed(2), // Don't return negative
    breakdown,
  };
};

/* ==============================
   NEW ENROLLMENTS
============================== */
// const getNewEnrollments = async (
//   filter: DashboardFilter,
//   dateRange: DateRange,
//   roleFilter?: RoleBasedFilter
// ): Promise<{ count: number; label: string }> => {
//   const startStr = toLocalDateString(dateRange.start);
//   const endStr = toLocalDateString(dateRange.end);
//   const conditions: any[] = [
//     eq(clientInformation.archived, false),
//     gte(clientInformation.enrollmentDate, startStr),
//     lte(clientInformation.enrollmentDate, endStr),
//   ];

//   const counsellorFilter = roleFilter ? buildCounsellorFilter(roleFilter, clientInformation) : undefined;
//   if (counsellorFilter) {
//     conditions.push(counsellorFilter);
//   }

//   const [result] = await db
//     .select({ count: count() })
//     .from(clientInformation)
//     .where(and(...conditions));

//   let label = "new clients";
//   switch (filter) {
//     case "today":
//       label = "new clients today";
//       break;
//     case "weekly":
//       label = "new clients this week";
//       break;
//     case "monthly":
//       label = "new clients this month";
//       break;
//     case "yearly":
//       label = "new clients this year";
//       break;
//   }

//   return {
//     count: result?.count || 0,
//     label,
//   };
// };

/* ==============================
   HELPER: Calculate Monthly Revenue
============================== */
const calculateMonthlyRevenue = async (
  monthStartStr: string,
  monthEndStr: string,
  monthStartTimestamp: string,
  monthEndTimestamp: string
): Promise<number> => {
  // 1. Client payments for this month (exclude archived clients)
  const [clientPaymentsResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.archived} = false
        AND ${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
        AND (
          (${clientPayments.paymentDate} IS NOT NULL AND ${clientPayments.paymentDate} >= ${monthStartStr} AND ${clientPayments.paymentDate} <= ${monthEndStr})
          OR
          (${clientPayments.paymentDate} IS NULL AND ${clientPayments.createdAt} >= ${monthStartTimestamp} AND ${clientPayments.createdAt} <= ${monthEndTimestamp})
        )
      )`
    );

  // 2. Product payments with amount for this month (exclude archived clients)
  const [productPaymentsWithAmount] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${clientProductPayments.amount}::numeric), 0)`,
    })
    .from(clientProductPayments)
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.archived} = false
        AND ${clientProductPayments.amount} IS NOT NULL
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL AND ${clientProductPayments.paymentDate} >= ${monthStartStr} AND ${clientProductPayments.paymentDate} <= ${monthEndStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL AND ${clientProductPayments.createdAt} >= ${monthStartTimestamp} AND ${clientProductPayments.createdAt} <= ${monthEndTimestamp})
        )
      )`
    );

  // 3. Entity-based product payments for this month (exclude archived clients)
  const productPaymentsWithEntity = await db
    .select({
      entityType: clientProductPayments.entityType,
      entityId: clientProductPayments.entityId,
    })
    .from(clientProductPayments)
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.archived} = false
        AND ${clientProductPayments.amount} IS NULL
        AND ${clientProductPayments.entityId} IS NOT NULL
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL AND ${clientProductPayments.paymentDate} >= ${monthStartStr} AND ${clientProductPayments.paymentDate} <= ${monthEndStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL AND ${clientProductPayments.createdAt} >= ${monthStartTimestamp} AND ${clientProductPayments.createdAt} <= ${monthEndTimestamp})
        )
      )`
    );

  // 4. Fetch amounts from entity tables
  let entityAmountsTotal = 0;
  if (productPaymentsWithEntity.length > 0) {
    const entityGroups: Record<string, number[]> = {};
    productPaymentsWithEntity.forEach((pp) => {
      if (pp.entityId && pp.entityType) {
        if (!entityGroups[pp.entityType]) {
          entityGroups[pp.entityType] = [];
        }
        entityGroups[pp.entityType].push(pp.entityId);
      }
    });

    for (const [entityType, entityIds] of Object.entries(entityGroups)) {
      const amount = await getEntityAmounts(entityType, entityIds);
      entityAmountsTotal += amount;
    }
  }

  const clientPaymentsTotal = parseFloat(clientPaymentsResult?.total || "0");
  const productPaymentsTotal = parseFloat(productPaymentsWithAmount?.total || "0");
  return clientPaymentsTotal + productPaymentsTotal + entityAmountsTotal;
};

/* ==============================
   REVENUE OVERVIEW (CHART DATA)
============================== */
// const getRevenueOverview = async (filter?: DashboardFilter, dateRange?: DateRange): Promise<
//   Array<{ month: string; revenue: string }>
// > => {
//   const monthNames = [
//     "Jan",
//     "Feb",
//     "Mar",
//     "Apr",
//     "May",
//     "Jun",
//     "Jul",
//     "Aug",
//     "Sep",
//     "Oct",
//     "Nov",
//     "Dec",
//   ];

//   const months: Array<{ month: string; revenue: string }> = [];

//   // Show last 12 months from current date
//   const now = new Date();
//   const currentYear = now.getFullYear();
//   const currentMonth = now.getMonth();

//   for (let i = 11; i >= 0; i--) {
//     const targetDate = new Date(currentYear, currentMonth - i, 1);
//     const year = targetDate.getFullYear();
//     const month = targetDate.getMonth();
//     const monthStart = new Date(year, month, 1);
//     monthStart.setHours(0, 0, 0, 0);
//     const monthEnd = new Date(year, month + 1, 0);
//     monthEnd.setHours(23, 59, 59, 999);

//     const monthStartStr = toLocalDateString(monthStart);
//     const monthEndStr = toLocalDateString(monthEnd);
//     const monthStartTimestamp = monthStart.toISOString();
//     const monthEndTimestamp = monthEnd.toISOString();

//     // Calculate revenue for this month
//     const revenue = await calculateMonthlyRevenue(monthStartStr, monthEndStr, monthStartTimestamp, monthEndTimestamp);

//     months.push({
//       month: monthNames[month],
//       revenue: revenue.toFixed(2),
//     });
//   }

//   return months;
// };

/* ==============================
   PERCENTAGE CHANGE CALCULATION
============================== */
const calculatePercentageChange = (
  current: number,
  previous: number
): { change: number; changeType: "increase" | "decrease" | "no-change" } => {
  if (previous === 0) {
    if (current === 0) {
      return { change: 0, changeType: "no-change" };
    }
    return { change: 100, changeType: "increase" };
  }

  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 100) / 100; // Round to 2 decimal places

  if (rounded > 0) {
    return { change: rounded, changeType: "increase" };
  } else if (rounded < 0) {
    return { change: Math.abs(rounded), changeType: "decrease" };
  } else {
    return { change: 0, changeType: "no-change" };
  }
};

/* ==============================
   NEW HELPER: Get Entity Amounts (Excluding Count-Only)
============================== */
const getEntityAmountsExcludingCountOnly = async (
  entityType: string,
  entityIds: number[]
): Promise<number> => {
  // Skip count-only entity types
  if (isCountOnlyEntityType(entityType)) {
    return 0;
  }
  return getEntityAmounts(entityType, entityIds);
};

/* ==============================
   NEW: Get Core Product Metrics (Count + Amount)
   Count and amount both use allFinance date so they stay in sync.
   For monthly/yearly: only paymentDate in range (no last month in current month).
============================== */
const getCoreProductMetrics = async (
  dateRange: DateRange,
  roleFilter?: RoleBasedFilter,
  periodFilter?: DashboardFilter
): Promise<{ count: number; amount: number }> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);

  // Core Product / revenue: only allFinance.paymentDate (no createdAt)
  const allFinanceDateCondition = sql`(
    ${allFinance.paymentDate} IS NOT NULL
    AND ${allFinance.paymentDate} >= ${startDateStr}
    AND ${allFinance.paymentDate} <= ${endDateStr}
  )`;

  // Count from same source as amount: client_product_payment JOIN allFinance, filter by allFinance date
  let countQuery = db
    .select({ count: count() })
    .from(clientProductPayments)
    .innerJoin(
      allFinance,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .where(
      sql`${clientProductPayments.productName} = ${CORE_PRODUCT} AND ${allFinanceDateCondition}`
    ) as any;

  if (roleFilter?.userRole === "counsellor" && roleFilter.counsellorId) {
    countQuery = countQuery
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId)
      )
      .where(
        sql`(
          ${clientInformation.counsellorId} = ${roleFilter.counsellorId}
          AND ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
          AND ${allFinanceDateCondition}
        )`
      ) as any;
  } else {
    countQuery = countQuery
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId)
      )
      .where(
        sql`(
          ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
          AND ${allFinanceDateCondition}
        )`
      ) as any;
  }

  const [countResult] = await countQuery;

  // Amount - same date condition so count and amount match
  let amountQuery = db
    .select({
      total: sql<string>`COALESCE(SUM(${allFinance.amount}::numeric), 0)`,
    })
    .from(allFinance)
    .innerJoin(
      clientProductPayments,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .where(
      sql`${clientProductPayments.productName} = ${CORE_PRODUCT} AND ${allFinanceDateCondition}`
    ) as any;

  if (roleFilter?.userRole === "counsellor" && roleFilter.counsellorId) {
    amountQuery = amountQuery
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId)
      )
      .where(
        sql`(
          ${clientInformation.counsellorId} = ${roleFilter.counsellorId}
          AND ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
          AND ${allFinanceDateCondition}
        )`
      ) as any;
  } else {
    amountQuery = amountQuery
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId)
      )
      .where(
        sql`(
          ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
          AND ${allFinanceDateCondition}
        )`
      ) as any;
  }

  const [amountResult] = await amountQuery;

  return {
    count: countResult?.count || 0,
    amount: parseFloat(amountResult?.total || "0"),
  };
};

/* ==============================
   Entity-based Other Product: count and amount by ENTITY TABLE date
   (ielts.enrollmentDate, visaExtension.extensionDate, etc.) so filter matches product date.
============================== */
const getEntityBasedOtherProductCountAndAmount = async (
  dateRange: DateRange,
  roleFilter?: RoleBasedFilter
): Promise<{ count: number; amount: number }> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);
  let totalCount = 0;
  let totalAmount = 0;

  const runForEntity = async (
    entityType: string,
    entityTable: any,
    entityIdCol: any,
    dateCol: any
  ): Promise<{ count: number; amount: number }> => {
    const conditions: any[] = [
      sql`${clientProductPayments.entityType} = ${entityType}`,
      sql`${clientProductPayments.productName} != ${CORE_PRODUCT}`,
      sql`${dateCol} IS NOT NULL`,
      gte(dateCol, startDateStr),
      lte(dateCol, endDateStr),
      eq(clientInformation.archived, false),
    ];
    if (roleFilter?.userRole === "counsellor" && roleFilter.counsellorId) {
      conditions.push(eq(clientInformation.counsellorId, roleFilter.counsellorId));
    }
    const rows = await db
      .select({ entityId: clientProductPayments.entityId })
      .from(clientProductPayments)
      .innerJoin(entityTable, eq(clientProductPayments.entityId, entityIdCol))
      .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
      .where(and(...conditions));
    const count = rows.length;
    const ids = rows.map((r: { entityId: number | null }) => r.entityId).filter((id): id is number => id != null);
    const amount = isCountOnlyEntityType(entityType) ? 0 : await getEntityAmountsExcludingCountOnly(entityType, ids);
    return { count, amount };
  };

  const runs: Promise<{ count: number; amount: number }>[] = [];

  runs.push(runForEntity("visaextension_id", visaExtension, visaExtension.id, visaExtension.extensionDate));
  runs.push(runForEntity("newSell_id", newSell, newSell.id, newSell.sellDate));
  runs.push(runForEntity("ielts_id", ielts, ielts.id, ielts.enrollmentDate));
  runs.push(runForEntity("loan_id", loan, loan.id, loan.disbursmentDate));
  runs.push(runForEntity("airTicket_id", airTicket, airTicket.id, airTicket.ticketDate));
  runs.push(runForEntity("insurance_id", insurance, insurance.id, insurance.insuranceDate));
  runs.push(runForEntity("forexCard_id", forexCard, forexCard.id, forexCard.cardDate));
  runs.push(runForEntity("forexFees_id", forexFees, forexFees.id, forexFees.feeDate));
  runs.push(runForEntity("tutionFees_id", tutionFees, tutionFees.id, tutionFees.feeDate));
  runs.push(runForEntity("creditCard_id", creditCard, creditCard.id, creditCard.cardDate));
  runs.push(runForEntity("simCard_id", simCard, simCard.id, simCard.simCardGivingDate));
  runs.push(runForEntity("beaconAccount_id", beaconAccount, beaconAccount.id, beaconAccount.openingDate));

  const results = await Promise.all(runs);
  results.forEach((r) => {
    totalCount += r.count;
    totalAmount += r.amount;
  });

  return { count: totalCount, amount: totalAmount };
};

/* ==============================
   NEW: Get Other Product Metrics (Count + Amount)
   - Direct rows (amount on client_product_payment): use client_product_payment.paymentDate for filter.
   - Entity-based rows: use ENTITY TABLE date (ielts.enrollmentDate, visaExtension.extensionDate, etc.) for count and sum.
============================== */
const getOtherProductMetrics = async (
  dateRange: DateRange,
  roleFilter?: RoleBasedFilter,
  _periodFilter?: DashboardFilter
): Promise<{ count: number; amount: number }> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);

  // 1) Direct: only paymentDate in range (no createdAt) – date only for filter
  const directPaymentDateCondition = sql`(
    ${clientProductPayments.paymentDate} IS NOT NULL
    AND ${clientProductPayments.paymentDate} >= ${startDateStr}
    AND ${clientProductPayments.paymentDate} <= ${endDateStr}
  )`;

  let directCountQuery = db
    .select({ count: count() })
    .from(clientProductPayments)
    .where(
      sql`${clientProductPayments.productName} != ${CORE_PRODUCT} AND ${directPaymentDateCondition}`
    ) as any;

  if (roleFilter?.userRole === "counsellor" && roleFilter.counsellorId) {
    directCountQuery = directCountQuery
      .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
      .where(
        sql`(
          ${clientInformation.counsellorId} = ${roleFilter.counsellorId}
          AND ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
          AND ${directPaymentDateCondition}
        )`
      ) as any;
  } else {
    directCountQuery = directCountQuery
      .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
      .where(
        sql`(
          ${clientInformation.archived} = false
          AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
          AND ${directPaymentDateCondition}
        )`
      ) as any;
  }

  const [directCountResult] = await directCountQuery;
  const directCount = Number(directCountResult?.count || 0);

  const countOnlyProductsList = COUNT_ONLY_PRODUCTS.map((p) => `'${p}'`).join(", ");

  let amountQuery = db
    .select({
      total: sql<string>`COALESCE(SUM(${clientProductPayments.amount}::numeric), 0)`,
    })
    .from(clientProductPayments)
    .where(
      sql`(
        ${clientProductPayments.amount} IS NOT NULL
        AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
        AND ${clientProductPayments.productName} NOT IN (${sql.raw(countOnlyProductsList)})
        AND ${directPaymentDateCondition}
      )`
    ) as any;

  if (roleFilter?.userRole === "counsellor" && roleFilter.counsellorId) {
    amountQuery = amountQuery
      .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
      .where(
        sql`(
          ${clientInformation.counsellorId} = ${roleFilter.counsellorId}
          AND ${clientInformation.archived} = false
          AND ${clientProductPayments.amount} IS NOT NULL
          AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
          AND ${clientProductPayments.productName} NOT IN (${sql.raw(countOnlyProductsList)})
          AND ${directPaymentDateCondition}
        )`
      ) as any;
  } else {
    amountQuery = amountQuery
      .innerJoin(clientInformation, eq(clientProductPayments.clientId, clientInformation.clientId))
      .where(
        sql`(
          ${clientInformation.archived} = false
          AND ${clientProductPayments.amount} IS NOT NULL
          AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
          AND ${clientProductPayments.productName} NOT IN (${sql.raw(countOnlyProductsList)})
          AND ${directPaymentDateCondition}
        )`
      ) as any;
  }

  const [amountResult1] = await amountQuery;
  const directAmount = parseFloat(amountResult1?.total || "0");

  // 2) Entity-based: count and amount by entity table date
  const entityResult = await getEntityBasedOtherProductCountAndAmount(dateRange, roleFilter);

  return {
    count: directCount + entityResult.count,
    amount: directAmount + entityResult.amount,
  };
};

/* ==============================
   NEW: Get Core Sale Amount
   Only sums INITIAL/BEFORE_VISA/AFTER_VISA payments for clients whose
   enrollment_date is in the date range. Old clients paying in the period
   do not add to this amount (revenue is separate and unchanged).
============================== */
const getCoreSaleAmount = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<number> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);

  // Revenue: only payment date (no createdAt)
  const baseConditions = sql`(
    ${clientInformation.archived} = false
    AND ${clientInformation.enrollmentDate} >= ${startDateStr}
    AND ${clientInformation.enrollmentDate} <= ${endDateStr}
    AND ${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    AND ${clientPayments.paymentDate} IS NOT NULL
    AND ${clientPayments.paymentDate} >= ${startDateStr}
    AND ${clientPayments.paymentDate} <= ${endDateStr}
  )`;

  let query = db
    .select({
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    );

  if (filter?.userRole === "counsellor" && filter.counsellorId) {
    query = query.where(
      sql`${baseConditions} AND ${clientInformation.counsellorId} = ${filter.counsellorId}`
    ) as any;
  } else {
    query = query.where(baseConditions) as any;
  }

  const [result] = await query;
  return parseFloat(result?.total || "0");
};

/* ==============================
   CHART ONLY: Core sale count/amount BY PAYMENT DATE
   Used in admin/manager chartData so each period shows payments that
   happened in that period (payment date), not enrollment date.
============================== */
const getCoreServiceCountByPaymentDate = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<number> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);
  const startTimestamp = dateRange.start.toISOString();
  const endTimestamp = dateRange.end.toISOString();

  const paymentDateCondition = sql`(
    ${clientInformation.archived} = false
    AND ${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    AND (
      (${clientPayments.paymentDate} IS NOT NULL
        AND ${clientPayments.paymentDate} >= ${startDateStr}
        AND ${clientPayments.paymentDate} <= ${endDateStr})
      OR
      (${clientPayments.paymentDate} IS NULL
        AND ${clientPayments.createdAt} >= ${startTimestamp}
        AND ${clientPayments.createdAt} <= ${endTimestamp})
    )
  )`;

  let query = db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    );

  if (filter?.userRole === "counsellor" && filter.counsellorId) {
    query = query.where(
      sql`${paymentDateCondition} AND ${clientInformation.counsellorId} = ${filter.counsellorId}`
    ) as any;
  } else {
    query = query.where(paymentDateCondition) as any;
  }

  const [result] = await query;
  return Number(result?.count ?? 0);
};

const getCoreSaleAmountByPaymentDate = async (
  dateRange: DateRange,
  filter?: RoleBasedFilter
): Promise<number> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);
  const startTimestamp = dateRange.start.toISOString();
  const endTimestamp = dateRange.end.toISOString();

  const baseConditions = sql`(
    ${clientInformation.archived} = false
    AND ${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    AND (
      (${clientPayments.paymentDate} IS NOT NULL
        AND ${clientPayments.paymentDate} >= ${startDateStr}
        AND ${clientPayments.paymentDate} <= ${endDateStr})
      OR
      (${clientPayments.paymentDate} IS NULL
        AND ${clientPayments.createdAt} >= ${startTimestamp}
        AND ${clientPayments.createdAt} <= ${endTimestamp})
    )
  )`;

  let query = db
    .select({
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    );

  if (filter?.userRole === "counsellor" && filter.counsellorId) {
    query = query.where(
      sql`${baseConditions} AND ${clientInformation.counsellorId} = ${filter.counsellorId}`
    ) as any;
  } else {
    query = query.where(baseConditions) as any;
  }

  const [result] = await query;
  return parseFloat(result?.total || "0");
};

/* ==============================
   DASHBOARD LEADERBOARD (query-based, no leader_board table for stats)
   Uses client + client_payment stage (INITIAL, BEFORE_VISA, AFTER_VISA) for
   enrollments and revenue. Optional target from leader_board for display.
============================== */
const getLeaderboardDataForDashboard = async (
  dateRange: DateRange,
  userId?: number,
  userRole?: UserRole
): Promise<
  Array<{
    counsellorId: number;
    fullName: string;
    email: string;
    empId: string | null;
    managerId: number | null;
    designation: string | null;
    enrollments: number;
    revenue: number;
    target: number;
    achievedTarget: number;
    targetId: number | null;
    rank: number;
  }>
> => {
  const startDateStr = toLocalDateString(dateRange.start);
  const endDateStr = toLocalDateString(dateRange.end);
  const startTimestamp = dateRange.start.toISOString();
  const endTimestamp = dateRange.end.toISOString();

  // #region agent log
  fetch("http://127.0.0.1:7243/ingest/d82f0fb7-7505-4c44-b82a-e27972897e19", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "dashboard.model.ts:getLeaderboardDataForDashboard", message: "Dashboard leaderboard date range", data: { startDateStr, endDateStr, startTs: startTimestamp.slice(0, 19), endTs: endTimestamp.slice(0, 19) }, timestamp: Date.now(), hypothesisId: "H1,H5" }) }).catch(() => {});
  // #endregion

  // Get counsellors: all for admin and counsellor (whole leaderboard), by manager for manager
  const roleCondition = eq(users.role, "counsellor");
  const whereCondition =
    userRole === "manager" && userId != null
      ? and(roleCondition, eq(users.managerId, userId))
      : roleCondition;

  const counsellorsList = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      empId: users.emp_id,
      managerId: users.managerId,
      designation: users.designation,
    })
    .from(users)
    .where(whereCondition);

  // Per-counsellor: enrollments by ENROLLMENT DATE in period (same as leaderboard / core service), one client = one count
  const stats = await Promise.all(
    counsellorsList.map(async (c) => {
      const [enrollmentResult] = await db
        .select({ count: count() })
        .from(clientInformation)
        .where(
          and(
            eq(clientInformation.counsellorId, c.id),
            eq(clientInformation.archived, false),
            gte(clientInformation.enrollmentDate, startDateStr),
            lte(clientInformation.enrollmentDate, endDateStr),
            sql`${clientInformation.clientId} IN (
              SELECT client_id FROM client_payment
              WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
            )`
          )
        );

      const enrollments = Number(enrollmentResult?.count ?? 0);
      const revenue = await calculateCounsellorRevenue(
        c.id,
        startDateStr,
        endDateStr,
        startTimestamp,
        endTimestamp
      );

      return {
        counsellorId: c.id,
        fullName: c.fullName,
        email: c.email,
        empId: c.empId,
        managerId: c.managerId,
        designation: c.designation,
        enrollments,
        revenue: parseFloat(revenue.toFixed(2)),
        target: 0,
        achievedTarget: enrollments,
        targetId: null as number | null,
        rank: 0,
      };
    })
  );

  // Sort by enrollments desc, then revenue desc
  stats.sort((a, b) => {
    if (b.enrollments !== a.enrollments) return b.enrollments - a.enrollments;
    return b.revenue - a.revenue;
  });

  // Assign ranks
  const ranked = stats.map((s, i) => ({ ...s, rank: i + 1 }));

  // Optional: fill target/targetId from leader_board for this month (for display)
  const month = dateRange.start.getMonth() + 1;
  const year = dateRange.start.getFullYear();
  const targetRows = await db
    .select({
      counsellor_id: leaderBoard.counsellor_id,
      target: leaderBoard.target,
      id: leaderBoard.id,
    })
    .from(leaderBoard)
    .where(
      and(
        sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${year}`,
        sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${month}`
      )
    );

  const targetByCounsellor = new Map(
    targetRows.map((r) => [r.counsellor_id, { target: r.target, id: r.id }])
  );

  return ranked.map((r) => {
    const t = targetByCounsellor.get(r.counsellorId);
    return {
      ...r,
      target: t?.target ?? 0,
      targetId: t?.id ?? null,
    };
  });
};

/* ==============================
   NEW: Individual Counsellor Performance (Based on Selected Filter)
============================== */
const getIndividualCounsellorPerformance = async (
  counsellorId: number,
  filter: DashboardFilter,
  dateRange: DateRange
): Promise<{
  current: number;
  previous: number;
  change: number;
  changeType: "increase" | "decrease" | "no-change";
  periodLabel: string;
}> => {
  const roleFilter = { userRole: "counsellor" as UserRole, counsellorId };

  // Get current period count (Core Service enrollments)
  const currentCount = await getCoreServiceCount(dateRange, roleFilter);

  // Get previous period count based on filter
  let previousCount = 0;
  let periodLabel = "";

  switch (filter) {
    case "today": {
      // Today vs Yesterday
      const yesterdayStart = new Date(dateRange.start);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setHours(23, 59, 59, 999);
      yesterdayStart.setHours(0, 0, 0, 0);

      previousCount = await getCoreServiceCount(
        {
          start: yesterdayStart,
          end: yesterdayEnd,
          previousStart: new Date(yesterdayStart.getTime() - 86400000),
          previousEnd: new Date(yesterdayEnd.getTime() - 86400000),
        },
        roleFilter
      );
      periodLabel = "Today vs Yesterday";
      break;
    }
    case "weekly": {
      // This week vs Last week (7 days before)
      const lastWeekStart = new Date(dateRange.start);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(dateRange.end);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);

      previousCount = await getCoreServiceCount(
        {
          start: lastWeekStart,
          end: lastWeekEnd,
          previousStart: new Date(lastWeekStart.getTime() - 7 * 86400000),
          previousEnd: new Date(lastWeekEnd.getTime() - 7 * 86400000),
        },
        roleFilter
      );
      periodLabel = "This Week vs Last Week";
      break;
    }
    case "monthly": {
      // This month vs Last month
      const lastMonthStart = new Date(dateRange.start);
      lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
      const lastMonthEnd = new Date(dateRange.end);
      lastMonthEnd.setMonth(lastMonthEnd.getMonth() - 1);
      lastMonthEnd.setDate(new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth() + 1, 0).getDate());

      previousCount = await getCoreServiceCount(
        {
          start: lastMonthStart,
          end: lastMonthEnd,
          previousStart: new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth() - 1, 1),
          previousEnd: new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth(), 0, 23, 59, 59, 999),
        },
        roleFilter
      );
      periodLabel = "This Month vs Last Month";
      break;
    }
    case "yearly": {
      // This year vs Last year
      const lastYearStart = new Date(dateRange.start);
      lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
      const lastYearEnd = new Date(dateRange.end);
      lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);

      previousCount = await getCoreServiceCount(
        {
          start: lastYearStart,
          end: lastYearEnd,
          previousStart: new Date(lastYearStart.getFullYear() - 1, 0, 1),
          previousEnd: new Date(lastYearStart.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
        },
        roleFilter
      );
      periodLabel = "This Year vs Last Year";
      break;
    }
    case "custom": {
      const previousDateRange = {
        start: new Date(dateRange.start.getTime() - 86400000),
        end: new Date(dateRange.end.getTime() - 86400000),
        previousStart: new Date(dateRange.start.getTime() - 86400000 * 2),
        previousEnd: new Date(dateRange.end.getTime() - 86400000 * 2),
      };
      previousCount = await getCoreServiceCount(previousDateRange, roleFilter);
      periodLabel = "Custom vs Previous Custom Period";
      break;
    }
  }

  const change = calculatePercentageChange(currentCount, previousCount);

  return {
    current: currentCount,
    previous: previousCount,
    change: change.change,
    changeType: change.changeType,
    periodLabel,
  };
};

/* ==============================
   CHART DATA AGGREGATION
============================== */
type ChartRange = "today" | "week" | "month" | "year" | "custom";

interface ChartDataPoint {
  label: string;
  coreSale: { count: number; amount: number };
  coreProduct: { count: number; amount: number };
  otherProduct: { count: number; amount: number };
  revenue: number;
}

interface ChartDataPointCounsellor {
  label: string;
  /** Client count only (by enrollment date in period). No coreSale/coreProduct/otherProduct. */
  clientCount: number;
}

const getChartData = async (
  range: ChartRange,
  dateRange: DateRange,
  roleFilter?: RoleBasedFilter,
  periodFilter?: DashboardFilter
): Promise<{
  data: ChartDataPoint[];
  summary: { total: number };
}> => {
  const data: ChartDataPoint[] = [];
  let labels: string[] = [];
  let periods: Array<{ start: Date; end: Date }> = [];

  const now = new Date();
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);

  // Helper function to format day name (short)
  const getDayNameShort = (date: Date): string => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return dayNames[date.getDay()];
  };

  // Helper function to format month name
  const getMonthName = (date: Date): string => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthNames[date.getMonth()];
  };

  // Generate periods based on range using dateRange
  switch (range) {
    case "today": {
      // Weekly data (7 days) for today filter - daily breakdown
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Thu 22", "Fri 23", etc.
        const dayName = getDayNameShort(currentDate);
        const day = currentDate.getDate();
        labels.push(`${dayName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "week": {
      // Weekly data (7 days) - daily breakdown
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Thu 22", "Fri 23", etc.
        const dayName = getDayNameShort(currentDate);
        const day = currentDate.getDate();
        labels.push(`${dayName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "month": {
      // Monthly data (30 days) - daily breakdown
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Dec 30", "Dec 31", "Jan 1", etc.
        const monthName = getMonthName(currentDate);
        const day = currentDate.getDate();
        labels.push(`${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "year": {
      // Yearly data (12 months) - monthly breakdown
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth();
      const endYear = endDate.getFullYear();
      const endMonth = endDate.getMonth();

      let currentYear = startYear;
      let currentMonth = startMonth;

      while (
        currentYear < endYear ||
        (currentYear === endYear && currentMonth <= endMonth)
      ) {
        const start = new Date(currentYear, currentMonth, 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentYear, currentMonth + 1, 0);
        end.setHours(23, 59, 59, 999);

        // For the last month, use endDate instead of end of month
        if (currentYear === endYear && currentMonth === endMonth) {
          end.setTime(endDate.getTime());
        }

        periods.push({ start, end });

        // Format: "Feb 2025", "Mar 2025", etc.
        labels.push(`${monthNames[currentMonth]}`);

        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
      }
      break;
    }
    case "custom": {
      // Custom data (custom date range) - daily breakdown
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Thu 22", "Fri 23", etc.
        const dayName = getDayNameShort(currentDate);
        const monthName = getMonthName(currentDate);
        const day = currentDate.getDate();
        labels.push(`${monthName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    default:
      throw new Error("Invalid chart range");
  }

  // Calculate data for each period
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const periodDateRange: DateRange = {
      start: period.start,
      end: period.end,
    };

    // Chart: by payment date only (so data matches selected filter)
    const [coreSaleCount, coreSaleAmount, coreProductMetrics, otherProductMetrics] = await Promise.all([
      getCoreServiceCountByPaymentDate(periodDateRange, roleFilter),
      getCoreSaleAmountByPaymentDate(periodDateRange, roleFilter),
      getCoreProductMetrics(periodDateRange, roleFilter, periodFilter),
      getOtherProductMetrics(periodDateRange, roleFilter, periodFilter),
    ]);

    const revenue = coreSaleAmount + coreProductMetrics.amount + otherProductMetrics.amount;

    data.push({
      label: labels[i],
      coreSale: {
        count: coreSaleCount,
        amount: coreSaleAmount,
      },
      coreProduct: {
        count: coreProductMetrics.count,
        amount: coreProductMetrics.amount,
      },
      otherProduct: {
        count: otherProductMetrics.count,
        amount: otherProductMetrics.amount,
      },
      revenue,
    });
  }

  // Calculate summary (total for current period only)
  const total = data.reduce((sum, point) => sum + point.revenue, 0);

  return {
    data,
    summary: {
      total,
    },
  };
};

const getChartDataCounsellor = async (
  range: ChartRange,
  dateRange: DateRange,
  roleFilter: RoleBasedFilter
): Promise<{
  data: ChartDataPointCounsellor[];
  summary: { total: number };
}> => {
  const data: ChartDataPointCounsellor[] = [];
  let labels: string[] = [];
  let periods: Array<{ start: Date; end: Date }> = [];

  const now = new Date();
  const startDate = new Date(dateRange.start);
  const endDate = new Date(dateRange.end);

  // Helper function to format day name (short) - same as admin/manager
  const getDayNameShort = (date: Date): string => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return dayNames[date.getDay()];
  };

  // Helper function to format month name - same as admin/manager
  const getMonthName = (date: Date): string => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthNames[date.getMonth()];
  };

  // Generate periods based on range using dateRange (same label format as admin/manager)
  switch (range) {
    case "today": {
      // Weekly data (7 days) for today filter - daily breakdown (same as admin/manager)
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Thu 22", "Fri 23", etc. (same as admin/manager)
        const dayName = getDayNameShort(currentDate);
        const day = currentDate.getDate();
        labels.push(`${dayName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "week": {
      // Weekly data (7 days) - daily breakdown (same as admin/manager)
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Thu 22", "Fri 23", etc. (same as admin/manager)
        const dayName = getDayNameShort(currentDate);
        const day = currentDate.getDate();
        labels.push(`${dayName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "month": {
      // Monthly data (30 days) - daily breakdown (same as admin/manager)
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });

        // Format: "Dec 30", "Dec 31", "Jan 1", etc. (same as admin/manager)
        const monthName = getMonthName(currentDate);
        const day = currentDate.getDate();
        labels.push(`${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
    case "year": {
      // Yearly data (12 months) - monthly breakdown (same as admin/manager)
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth();
      const endYear = endDate.getFullYear();
      const endMonth = endDate.getMonth();

      let currentYear = startYear;
      let currentMonth = startMonth;

      while (
        currentYear < endYear ||
        (currentYear === endYear && currentMonth <= endMonth)
      ) {
        const start = new Date(currentYear, currentMonth, 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentYear, currentMonth + 1, 0);
        end.setHours(23, 59, 59, 999);

        // For the last month, use endDate instead of end of month
        if (currentYear === endYear && currentMonth === endMonth) {
          end.setTime(endDate.getTime());
        }

        periods.push({ start, end });

        // Format: "Feb 2025", "Mar 2025", etc. (same as admin/manager)
        labels.push(`${monthNames[currentMonth]}`);

        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
      }
      break;
    }
    case "custom": {
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        periods.push({ start, end });
        const dayName = getDayNameShort(currentDate);
        const day = currentDate.getDate();
        labels.push(`${dayName} ${day}`);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      break;
    }
  }

  // Counsellor chart: client count only (by enrollment date per period). No payment/product payment.
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const periodDateRange: DateRange = {
      start: period.start,
      end: period.end,
    };

    const clientCount = await getTotalClients(periodDateRange, roleFilter);

    data.push({
      label: labels[i],
      clientCount,
    });
  }

  // Summary = total client count in the period (enrollment count only)
  const total = data.reduce((sum, point) => sum + point.clientCount, 0);

  return {
    data,
    summary: {
      total,
    },
  };
};

/* ==============================
   MAIN DASHBOARD STATS FUNCTION
============================== */
export const getDashboardStats = async (
  filter: DashboardFilter,
  beforeDate?: string,
  afterDate?: string,
  userId?: number,
  userRole?: UserRole,
  range?: ChartRange
): Promise<DashboardStats> => {
  // Get date ranges
  const dateRange = getDateRange(filter, beforeDate, afterDate);
  const todayOnlyDateRange = getTodayOnlyDateRange();
  const allTimeDateRange = getAllTimeDateRange();
  // Summary cards (Core Sale, Core Product, Other Product, Total Clients) use this range only.
  // Today = today only; weekly = Mon–Sun; monthly = current calendar month only; yearly = that period.
  const summaryDateRange = filter === "today" ? todayOnlyDateRange : dateRange;

  // Determine role and build filter
  const roleFilter: RoleBasedFilter | undefined =
    userRole === "counsellor" && userId
      ? { userRole: "counsellor", userId, counsellorId: userId }
      : userRole === "admin" || userRole === "manager"
      ? { userRole }
      : undefined;

  // Handle Counsellor Dashboard
  // Summary cards use summaryDateRange (filter-based). totalPendingAmount = all clients always.
  // totalClients = clients in selected filter period (by enrollment date), not same count for every filter.
  if (userRole === "counsellor" && userId) {
    const [
      coreSaleCount,
      coreProductMetrics,
      otherProductMetrics,
      totalPendingAmount,
      totalClientsCount,
      // newEnrollmentCount,
      leaderboardData,
      individualPerformance,
      chartData,
    ] = await Promise.all([
      getCoreServiceCount(summaryDateRange, roleFilter),
      getCoreProductMetrics(summaryDateRange, roleFilter, filter),
      getOtherProductMetrics(summaryDateRange, roleFilter, filter),
      getPendingAmount(allTimeDateRange, roleFilter),
      getTotalClients(summaryDateRange, roleFilter),
      // getNewEnrollments(filter, summaryDateRange, roleFilter),
      getLeaderboardDataForDashboard(summaryDateRange, userId, userRole),
      getIndividualCounsellorPerformance(userId, filter, dateRange),
      getChartDataCounsellor(range || "today", dateRange, roleFilter!),
    ]);

    const counsellorStats: CounsellorDashboardStats = {
      coreSale: {
        number: coreSaleCount,
      },
      coreProduct: {
        number: coreProductMetrics.count,
      },
      otherProduct: {
        number: otherProductMetrics.count,
      },
      totalPendingAmount: {
        amount: totalPendingAmount.pendingAmount,
      },
      totalClients: {
        count: totalClientsCount,
      },
        // newEnrollment: {
        //   count: newEnrollmentCount.count,
        // },
      leaderboard: leaderboardData, // Same full leaderboard array as admin/manager
      individualPerformance,
      chartData,
    };

    return counsellorStats;
  }

  // Handle Admin/Manager Dashboard
  // Summary cards use summaryDateRange (filter-based). totalPendingAmount = all clients. totalClients = filter-based (like counsellor).
  const [
    // newEnrollmentCount,
    coreSaleCount,
    coreSaleAmount,
    coreProductMetrics,
    otherProductMetrics,
    totalPendingAmount,
    totalClientsCount,
    leaderboardData,
    chartData,
  ] = await Promise.all([
    // getNewEnrollments(filter, summaryDateRange, roleFilter),
    getCoreServiceCount(summaryDateRange, roleFilter),
    getCoreSaleAmount(summaryDateRange, roleFilter),
    getCoreProductMetrics(summaryDateRange, roleFilter, filter),
    getOtherProductMetrics(summaryDateRange, roleFilter, filter),
    getPendingAmount(allTimeDateRange, roleFilter),
    getTotalClients(summaryDateRange, roleFilter),
    getLeaderboardDataForDashboard(summaryDateRange, userId, userRole),
    getChartData(range || "today", dateRange, roleFilter, filter),
    // getChartData(chartRange, dateRange, roleFilter)

  ]);

  // Revenue: use same period as cards (today = today only; chart stays 7-day/weekly)
  const totalRevenue =
    coreSaleAmount + coreProductMetrics.amount + otherProductMetrics.amount;

  const adminManagerStats: AdminManagerDashboardStats = {
    // newEnrollment: {
    //   count: newEnrollmentCount.count,
    // },
    coreSale: {
      number: coreSaleCount,
      amount: coreSaleAmount.toFixed(2),
    },
    coreProduct: {
      number: coreProductMetrics.count,
      amount: coreProductMetrics.amount.toFixed(2),
    },
    otherProduct: {
      number: otherProductMetrics.count,
      amount: otherProductMetrics.amount.toFixed(2),
    },
    totalPendingAmount: {
      amount: totalPendingAmount.pendingAmount,
    },
    totalClients: {
      count: totalClientsCount,
    },
    revenue: {
      amount: totalRevenue.toFixed(2),
    },
    leaderboard: leaderboardData,
    chartData,
  };

  return adminManagerStats;
};
