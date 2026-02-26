import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import { simCard } from "../schemas/simCard.schema";
import { airTicket } from "../schemas/airTicket.schema";
import { ielts } from "../schemas/ielts.schema";
import { loan } from "../schemas/loan.schema";
import { forexCard } from "../schemas/forexCard.schema";
import { forexFees } from "../schemas/forexFees.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { insurance } from "../schemas/insurance.schema";
import { beaconAccount } from "../schemas/beaconAccount.schema";
import { creditCard } from "../schemas/creditCard.schema";
import { visaExtension } from "../schemas/visaExtension.schema";
import { newSell } from "../schemas/newSell.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { eq, and, sql, count, desc, gte, lte, or, inArray } from "drizzle-orm";

// Match dashboard: Core Product = this product name; Other = rest (some are count-only for amount)
const CORE_PRODUCT = "ALL_FINANCE_EMPLOYEMENT";
// Count-only products: count the payment for metrics but NEVER add to revenue (e.g. INSURANCE — count only, no revenue)
const COUNT_ONLY_PRODUCTS = [
  "LOAN_DETAILS",
  "FOREX_CARD",
  "TUTION_FEES",
  "CREDIT_CARD",
  "SIM_CARD_ACTIVATION",
  "INSURANCE",
  "BEACON_ACCOUNT",
  "AIR_TICKET",
  "FOREX_FEES",
] as const;

// For SQL: case-insensitive exclusion so 'INSURANCE' / 'Insurance' / 'insurance' all excluded from revenue
const COUNT_ONLY_PRODUCTS_LOWER = COUNT_ONLY_PRODUCTS.map((p) => `'${p.toLowerCase()}'`).join(", ");

// Entity types for those products: count payment, do not add to revenue (insurance_id = INSURANCE, etc.)
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

const isCountOnlyEntityType = (entityType: string): boolean =>
  (COUNT_ONLY_ENTITY_TYPES as readonly string[]).includes(entityType);

// Helper function to get entity amounts (same as dashboard model)
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

// Helper function to calculate revenue for a counsellor in a date range (exported for dashboard)
export const calculateCounsellorRevenue = async (
  counsellorId: number,
  startDateStr: string,
  endDateStr: string,
  startTimestamp: string,
  endTimestamp: string
): Promise<number> => {
  // 1. Client payments (core products) for this counsellor's clients
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
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
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
      )`
    );

  // 2. Product payments with amount — exclude count-only (e.g. INSURANCE: count only, never revenue)
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
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.amount} IS NOT NULL
        AND LOWER((${clientProductPayments.productName})::text) NOT IN (${sql.raw(COUNT_ONLY_PRODUCTS_LOWER)})
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL
            AND ${clientProductPayments.paymentDate} >= ${startDateStr}
            AND ${clientProductPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL
            AND ${clientProductPayments.createdAt} >= ${startTimestamp}
            AND ${clientProductPayments.createdAt} <= ${endTimestamp})
        )
      )`
    );

  // 3. Entity-based product payments for this counsellor's clients
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
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.amount} IS NULL
        AND ${clientProductPayments.entityId} IS NOT NULL
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL
            AND ${clientProductPayments.paymentDate} >= ${startDateStr}
            AND ${clientProductPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL
            AND ${clientProductPayments.createdAt} >= ${startTimestamp}
            AND ${clientProductPayments.createdAt} <= ${endTimestamp})
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
      if (isCountOnlyEntityType(entityType)) continue;
      const amount = await getEntityAmounts(entityType, entityIds);
      entityAmountsTotal += amount;
    }
  }

  const clientPaymentsTotal = parseFloat(clientPaymentsResult?.total || "0");
  const productPaymentsTotal = parseFloat(productPaymentsWithAmount?.total || "0");
  const total = clientPaymentsTotal + productPaymentsTotal + entityAmountsTotal;

  return total;
};

/** Core Sale client count for one counsellor: distinct clients with INITIAL/BEFORE_VISA/AFTER_VISA payment in the period. */
export const getCounsellorCoreSaleClientCount = async (
  counsellorId: number,
  startDateStr: string,
  endDateStr: string,
  startTimestamp: string,
  endTimestamp: string
): Promise<number> => {
  const [result] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
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
      )`
    );
  return Number(result?.count ?? 0);
};

/** Core Sale amount for one counsellor: client_payment (INITIAL/BEFORE_VISA/AFTER_VISA) where payment falls in the period.
 *  If payment is in current month it counts in current month, even if client was enrolled earlier (no enrollment_date filter). */
export const getCounsellorCoreSaleAmount = async (
  counsellorId: number,
  startDateStr: string,
  endDateStr: string,
  startTimestamp: string,
  endTimestamp: string
): Promise<number> => {
  const [result] = await db
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
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
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
      )`
    );
  return parseFloat(result?.total || "0");
};

/** Core Product (ALL_FINANCE_EMPLOYEMENT): main payment by paymentDate, another payment by anotherPaymentDate. */
export const getCounsellorCoreProductMetrics = async (
  counsellorId: number,
  startDateStr: string,
  endDateStr: string
): Promise<{ count: number; amount: number }> => {
  const allFinanceDateCondition = sql`(
    ${allFinance.paymentDate} IS NOT NULL
    AND ${allFinance.paymentDate} >= ${startDateStr}
    AND ${allFinance.paymentDate} <= ${endDateStr}
  )`;
  const [countResult] = await db
    .select({ count: count() })
    .from(clientProductPayments)
    .innerJoin(
      allFinance,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
        AND ${allFinanceDateCondition}
      )`
    );
  const [amountResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${allFinance.amount}::numeric), 0)`,
    })
    .from(allFinance)
    .innerJoin(
      clientProductPayments,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
        AND ${allFinanceDateCondition}
      )`
    );

  // Another payment: count and amount by anotherPaymentDate (partial/second payment)
  const anotherDateCondition = sql`(
    ${allFinance.anotherPaymentDate} IS NOT NULL
    AND ${allFinance.anotherPaymentDate} >= ${startDateStr}
    AND ${allFinance.anotherPaymentDate} <= ${endDateStr}
    AND ${allFinance.anotherPaymentAmount} IS NOT NULL
  )`;
  const [countAnotherResult] = await db
    .select({ count: count() })
    .from(clientProductPayments)
    .innerJoin(
      allFinance,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
        AND ${anotherDateCondition}
      )`
    );
  const [amountAnotherResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${allFinance.anotherPaymentAmount}::numeric), 0)`,
    })
    .from(allFinance)
    .innerJoin(
      clientProductPayments,
      sql`${clientProductPayments.entityId} = ${allFinance.financeId} AND ${clientProductPayments.entityType} = 'allFinance_id'`
    )
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.productName} = ${CORE_PRODUCT}
        AND ${anotherDateCondition}
      )`
    );

  const mainCount = countResult?.count ?? 0;
  const mainAmount = parseFloat(amountResult?.total || "0");
  const anotherCount = countAnotherResult?.count ?? 0;
  const anotherAmount = parseFloat(amountAnotherResult?.total || "0");

  return {
    count: mainCount + anotherCount,
    amount: mainAmount + anotherAmount,
  };
};

/** Other Product (non–Core Product) count and amount for one counsellor. Direct: paymentDate in range. Entity: entity table date in range. */
export const getCounsellorOtherProductMetrics = async (
  counsellorId: number,
  startDateStr: string,
  endDateStr: string
): Promise<{ count: number; amount: number }> => {
  const directCondition = sql`(
    ${clientProductPayments.paymentDate} IS NOT NULL
    AND ${clientProductPayments.paymentDate} >= ${startDateStr}
    AND ${clientProductPayments.paymentDate} <= ${endDateStr}
  )`;

  const [directCountResult] = await db
    .select({ count: count() })
    .from(clientProductPayments)
    .innerJoin(
      clientInformation,
      eq(clientProductPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
        AND ${directCondition}
      )`
    );
  const [directAmountResult] = await db
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
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
        AND ${clientProductPayments.amount} IS NOT NULL
        AND ${clientProductPayments.productName} != ${CORE_PRODUCT}
        AND LOWER((${clientProductPayments.productName})::text) NOT IN (${sql.raw(COUNT_ONLY_PRODUCTS_LOWER)})
        AND ${directCondition}
      )`
    );
  let directCount = directCountResult?.count ?? 0;
  let directAmount = parseFloat(directAmountResult?.total || "0");

  const entityPairs: Array<{ type: string; table: any; idCol: any; dateCol: any }> = [
    { type: "visaextension_id", table: visaExtension, idCol: visaExtension.id, dateCol: visaExtension.extensionDate },
    { type: "newSell_id", table: newSell, idCol: newSell.id, dateCol: newSell.sellDate },
    { type: "ielts_id", table: ielts, idCol: ielts.id, dateCol: ielts.enrollmentDate },
    { type: "loan_id", table: loan, idCol: loan.id, dateCol: loan.disbursmentDate },
    { type: "airTicket_id", table: airTicket, idCol: airTicket.id, dateCol: airTicket.ticketDate },
    { type: "insurance_id", table: insurance, idCol: insurance.id, dateCol: insurance.insuranceDate },
    { type: "forexCard_id", table: forexCard, idCol: forexCard.id, dateCol: forexCard.cardDate },
    { type: "forexFees_id", table: forexFees, idCol: forexFees.id, dateCol: forexFees.feeDate },
    { type: "tutionFees_id", table: tutionFees, idCol: tutionFees.id, dateCol: tutionFees.feeDate },
    { type: "creditCard_id", table: creditCard, idCol: creditCard.id, dateCol: creditCard.cardDate },
    { type: "simCard_id", table: simCard, idCol: simCard.id, dateCol: simCard.simCardGivingDate },
    { type: "beaconAccount_id", table: beaconAccount, idCol: beaconAccount.id, dateCol: beaconAccount.openingDate },
  ];
  for (const { type, table, idCol, dateCol } of entityPairs) {
    const rows = await db
      .select({ entityId: clientProductPayments.entityId })
      .from(clientProductPayments)
      .innerJoin(table, eq(clientProductPayments.entityId, idCol))
      .innerJoin(
        clientInformation,
        eq(clientProductPayments.clientId, clientInformation.clientId)
      )
      .where(
        and(
          sql`${clientProductPayments.entityType} = ${type}`,
          sql`${clientProductPayments.productName} != ${CORE_PRODUCT}`,
          sql`${dateCol} IS NOT NULL`,
          gte(dateCol, startDateStr),
          lte(dateCol, endDateStr),
          eq(clientInformation.archived, false),
          eq(clientInformation.counsellorId, counsellorId)
        )
      );
    directCount += rows.length;
    const ids = rows.map((r: { entityId: number | null }) => r.entityId).filter((id): id is number => id != null);
    if (ids.length > 0 && !isCountOnlyEntityType(type)) directAmount += await getEntityAmounts(type, ids);
  }

  return { count: directCount, amount: directAmount };
};

export type LeaderboardUserRole = "admin" | "manager" | "counsellor";

export type LeaderboardDateRange = { start: Date; end: Date };

/* ==============================
   GET LEADERBOARD
   Returns ranked list of counsellors with enrollments and revenue.
   Optional userId/userRole: filter so each user sees only their result (admin=all, manager=team, counsellor=own row).
   Optional dateRange: when provided (e.g. from dashboard filter), stats are for this period; otherwise use month/year.
============================== */
export const getLeaderboard = async (
  month: number,
  year: number,
  userId?: number,
  userRole?: LeaderboardUserRole,
  dateRange?: LeaderboardDateRange
) => {
  // Validate month and year (used for target lookup and when dateRange not provided)
  if (month < 1 || month > 12) {
    throw new Error("Invalid month. Must be between 1 and 12");
  }
  if (year < 2000 || year > 3000) {
    throw new Error("Invalid year");
  }

  // Use provided date range (dashboard filter) or derive from month/year
  const startDate = dateRange
    ? new Date(dateRange.start)
    : new Date(year, month - 1, 1);
  const endDate = dateRange
    ? new Date(dateRange.end)
    : new Date(year, month, 0, 23, 59, 59, 999);
  if (dateRange) {
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
  }
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();

  // Get all counsellors
  const allCounsellors = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      empId: users.emp_id,
      managerId: users.managerId,
      designation: users.designation,
    })
    .from(users)
    .where(eq(users.role, "counsellor"));

  // Calculate enrollments and revenue for each counsellor
  // Enrollment count = same as dashboard: by ENROLLMENT DATE in period, one client = one count (not payment date)
  const counsellorStats = await Promise.all(
    allCounsellors.map(async (counsellor) => {
      const [enrollmentResult] = await db
        .select({ count: count() })
        .from(clientInformation)
        .where(
          and(
            eq(clientInformation.counsellorId, counsellor.id),
            eq(clientInformation.archived, false),
            gte(clientInformation.enrollmentDate, startDateStr),
            lte(clientInformation.enrollmentDate, endDateStr),
            sql`${clientInformation.clientId} IN (
              SELECT client_id FROM client_payment
              WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
            )`
          )
        );

      const enrollments = enrollmentResult?.count ?? 0;

      // Per-counsellor breakdown: Core Sale, Core Product, Other Product (same definitions as dashboard)
      const [coreSaleAmount, coreProductMetrics, otherProductMetrics] = await Promise.all([
        getCounsellorCoreSaleAmount(counsellor.id, startDateStr, endDateStr, startTimestamp, endTimestamp),
        getCounsellorCoreProductMetrics(counsellor.id, startDateStr, endDateStr),
        getCounsellorOtherProductMetrics(counsellor.id, startDateStr, endDateStr),
      ]);

      // Revenue = Core Sale + Core Product + Other Product (formula so revenue matches sum of breakdown)
      const revenue =
        coreSaleAmount + coreProductMetrics.amount + otherProductMetrics.amount;

      // Get target from leaderboard table (if exists)
      const [targetRecord] = await db
        .select()
        .from(leaderBoard)
        .where(
          and(
            eq(leaderBoard.counsellor_id, counsellor.id),
            sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${year}`,
            sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${month}`
          )
        )
        .limit(1);

      return {
        counsellorId: counsellor.id,
        fullName: counsellor.fullName,
        email: counsellor.email,
        empId: counsellor.empId,
        managerId: counsellor.managerId,
        designation: counsellor.designation,
        enrollments,
        revenue: parseFloat(revenue.toFixed(2)),
        target: targetRecord?.target || 0,
        achievedTarget: enrollments, // Achieved target = enrollments
        targetId: targetRecord?.id || null,
        coreSale: {
          count: enrollments,
          amount: parseFloat(coreSaleAmount.toFixed(2)),
        },
        coreProduct: {
          count: coreProductMetrics.count,
          amount: parseFloat(coreProductMetrics.amount.toFixed(2)),
        },
        otherProduct: {
          count: otherProductMetrics.count,
          amount: parseFloat(otherProductMetrics.amount.toFixed(2)),
        },
      };
    })
  );

  // Sort by enrollments (descending), then by revenue (descending)
  counsellorStats.sort((a, b) => {
    if (b.enrollments !== a.enrollments) {
      return b.enrollments - a.enrollments;
    }
    return b.revenue - a.revenue;
  });

  // Assign ranks
  const rankedStats = counsellorStats.map((stat, index) => ({
    ...stat,
    rank: index + 1,
  }));

  // Persist achieved_target and rank only when using month/year (not when dashboard passes a filter date range)
  if (!dateRange) {
    const monthStartForDb = new Date(year, month - 1, 1);
    for (const stat of rankedStats) {
      const [existing] = await db
        .select()
        .from(leaderBoard)
        .where(
          and(
            eq(leaderBoard.counsellor_id, stat.counsellorId),
            sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${year}`,
            sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${month}`
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(leaderBoard)
          .set({
            achieved_target: stat.enrollments,
            rank: stat.rank,
          })
          .where(eq(leaderBoard.id, existing.id));
      } else {
        await db.insert(leaderBoard).values({
          manager_id: stat.managerId ?? null,
          counsellor_id: stat.counsellorId,
          target: 0,
          achieved_target: stat.enrollments,
          rank: stat.rank,
          createdAt: monthStartForDb,
        });
      }
    }
  }

  // Filter by role so each user sees only their relevant result
  let data: typeof rankedStats;
  if (userId != null && userRole) {
    if (userRole === "counsellor") {
      data = rankedStats.filter((s) => s.counsellorId === userId);
    } else if (userRole === "manager") {
      const team = rankedStats.filter((s) => s.managerId === userId);
      data = team.map((s, i) => ({ ...s, rank: i + 1 }));
    } else {
      data = rankedStats;
    }
  } else {
    data = rankedStats;
  }

  // Summary according to filter: same period (date range) and same scope (all / team / own)
  const totalCounsellors = data.length;
  const totalRevenue = parseFloat(
    data.reduce((sum, r) => sum + r.revenue, 0).toFixed(2)
  );
  const counsellorIds = data.map((d) => d.counsellorId);

  // Total enrollment clients: same as dashboard — by enrollment date in period, one client = one count, scoped by counsellor(s)
  let totalEnrollments = 0;
  if (counsellorIds.length > 0) {
    const [totalEnrollmentsResult] = await db
      .select({ count: count() })
      .from(clientInformation)
      .where(
        and(
          eq(clientInformation.archived, false),
          gte(clientInformation.enrollmentDate, startDateStr),
          lte(clientInformation.enrollmentDate, endDateStr),
          inArray(clientInformation.counsellorId, counsellorIds),
          sql`${clientInformation.clientId} IN (
            SELECT client_id FROM client_payment
            WHERE stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
          )`
        )
      );
    totalEnrollments = totalEnrollmentsResult?.count ?? 0;
  }

  return {
    summary: {
      totalCounsellors,
      totalEnrollments,
      totalRevenue,
    },
    leaderboard: data,
  };
};

/* ==============================
   GET LEADERBOARD SUMMARY
   Returns total counsellors, enrollments, and revenue
============================== */
export const getLeaderboardSummary = async (month: number, year: number) => {
  // Validate month and year
  if (month < 1 || month > 12) {
    throw new Error("Invalid month. Must be between 1 and 12");
  }
  if (year < 2000 || year > 3000) {
    throw new Error("Invalid year");
  }

  // Calculate date range for the month
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();

  // Total counsellors
  const [totalCounsellorsResult] = await db
    .select({
      count: count(users.id),
    })
    .from(users)
    .where(eq(users.role, "counsellor"));

  const totalCounsellors = totalCounsellorsResult?.count || 0;

  // Total enrollments (all counsellors combined): unique clients who have payments (INITIAL, BEFORE_VISA, AFTER_VISA) in this month/year
  const [totalEnrollmentsResult] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
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
          (${clientPayments.paymentDate} IS NOT NULL
            AND ${clientPayments.paymentDate} >= ${startDateStr}
            AND ${clientPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientPayments.paymentDate} IS NULL
            AND ${clientPayments.createdAt} >= ${startTimestamp}
            AND ${clientPayments.createdAt} <= ${endTimestamp})
        )
      )`
    ) as any;

  const totalEnrollments = totalEnrollmentsResult?.count || 0;

  // Total revenue (all counsellors combined)
  // 1. Client payments
  const [clientPaymentsResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${clientPayments.amount}::numeric), 0)`,
    })
    .from(clientPayments)
    .where(
      sql`(
        ${clientPayments.stage} IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
        AND (
          (${clientPayments.paymentDate} IS NOT NULL
            AND ${clientPayments.paymentDate} >= ${startDateStr}
            AND ${clientPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientPayments.paymentDate} IS NULL
            AND ${clientPayments.createdAt} >= ${startTimestamp}
            AND ${clientPayments.createdAt} <= ${endTimestamp})
        )
      )`
    );

  // 2. Product payments with amount — exclude count-only (e.g. INSURANCE: count only, never revenue)
  const [productPaymentsWithAmount] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${clientProductPayments.amount}::numeric), 0)`,
    })
    .from(clientProductPayments)
    .where(
      sql`(
        ${clientProductPayments.amount} IS NOT NULL
        AND LOWER((${clientProductPayments.productName})::text) NOT IN (${sql.raw(COUNT_ONLY_PRODUCTS_LOWER)})
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL
            AND ${clientProductPayments.paymentDate} >= ${startDateStr}
            AND ${clientProductPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL
            AND ${clientProductPayments.createdAt} >= ${startTimestamp}
            AND ${clientProductPayments.createdAt} <= ${endTimestamp})
        )
      )`
    );

  // 3. Entity-based product payments
  const productPaymentsWithEntity = await db
    .select({
      entityType: clientProductPayments.entityType,
      entityId: clientProductPayments.entityId,
    })
    .from(clientProductPayments)
    .where(
      sql`(
        ${clientProductPayments.amount} IS NULL
        AND ${clientProductPayments.entityId} IS NOT NULL
        AND (
          (${clientProductPayments.paymentDate} IS NOT NULL
            AND ${clientProductPayments.paymentDate} >= ${startDateStr}
            AND ${clientProductPayments.paymentDate} <= ${endDateStr})
          OR
          (${clientProductPayments.paymentDate} IS NULL
            AND ${clientProductPayments.createdAt} >= ${startTimestamp}
            AND ${clientProductPayments.createdAt} <= ${endTimestamp})
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
      if (isCountOnlyEntityType(entityType)) continue;
      const amount = await getEntityAmounts(entityType, entityIds);
      entityAmountsTotal += amount;
    }
  }

  const clientPaymentsTotal = parseFloat(clientPaymentsResult?.total || "0");
  const productPaymentsTotal = parseFloat(productPaymentsWithAmount?.total || "0");
  const totalRevenue = clientPaymentsTotal + productPaymentsTotal + entityAmountsTotal;

  return {
    totalCounsellors,
    totalEnrollments,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
  };
};

/* ==============================
   SET TARGET FOR COUNSELLOR
   Creates or updates target for a counsellor
============================== */
export const setTarget = async (
  counsellorId: number,
  managerId: number,
  target: number,
  month: number,
  year: number
) => {
  // Validate inputs
  if (!counsellorId || !managerId || !target || target < 0) {
    throw new Error("Invalid input parameters");
  }

  if (month < 1 || month > 12) {
    throw new Error("Invalid month. Must be between 1 and 12");
  }

  if (year < 2000 || year > 3000) {
    throw new Error("Invalid year");
  }

  // Verify counsellor exists and has correct role
  // First check if user exists
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, counsellorId))
    .limit(1);

  if (!user) {
    throw new Error(`User with ID ${counsellorId} not found`);
  }

  // Then check if user is a counsellor
  if (user.role !== "counsellor") {
    throw new Error(`User with ID ${counsellorId} is not a counsellor (current role: ${user.role})`);
  }

  // Get full counsellor data
  const [counsellor] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, counsellorId), eq(users.role, "counsellor")))
    .limit(1);

  // Verify manager exists
  const [manager] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, managerId), eq(users.role, "manager")))
    .limit(1);

  if (!manager) {
    throw new Error("Manager not found");
  }

  // Check if target already exists for this counsellor, month, and year
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();

  const [existingTarget] = await db
    .select()
    .from(leaderBoard)
    .where(
      and(
        eq(leaderBoard.counsellor_id, counsellorId),
        sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${year}`,
        sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${month}`
      )
    )
    .limit(1);

  // Achieved = distinct clients with INITIAL/BEFORE_VISA/AFTER_VISA payment in this month (not enrollment date)
  const [enrollmentResult] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
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
      )`
    ) as any;

  const achievedTarget = enrollmentResult?.count || 0;

  // Calculate rank (will be updated when leaderboard is fetched)
  // For now, set a temporary rank
  const tempRank = 0;

  if (existingTarget) {
    // Update existing target
    const [updated] = await db
      .update(leaderBoard)
      .set({
        manager_id: managerId,
        target: target,
        achieved_target: achievedTarget,
        rank: tempRank,
      })
      .where(eq(leaderBoard.id, existingTarget.id))
      .returning();

    return {
      action: "UPDATED",
      target: updated,
    };
  } else {
    // Create new target (set createdAt to 1st of month so EXTRACT(month/year) finds it)
    const [created] = await db
      .insert(leaderBoard)
      .values({
        manager_id: managerId,
        counsellor_id: counsellorId,
        target: target,
        achieved_target: achievedTarget,
        rank: tempRank,
        createdAt: new Date(year, month - 1, 1),
      })
      .returning();

    return {
      action: "CREATED",
      target: created,
    };
  }
};

/* ==============================
   UPDATE TARGET
   Updates an existing target
============================== */
export const updateTarget = async (targetId: number, target: number) => {
  if (!targetId || !target || target < 0) {
    throw new Error("Invalid input parameters");
  }

  // Get existing target
  const [existingTarget] = await db
    .select()
    .from(leaderBoard)
    .where(eq(leaderBoard.id, targetId))
    .limit(1);

  if (!existingTarget) {
    throw new Error("Target not found");
  }

  // Get month and year from createdAt
  const createdAt = existingTarget.createdAt;
  if (!createdAt) {
    throw new Error("Target createdAt is null");
  }
  const month = createdAt.getMonth() + 1;
  const year = createdAt.getFullYear();

  // Recalculate achieved target (distinct clients with INITIAL/BEFORE_VISA/AFTER_VISA in month)
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();

  const [enrollmentResult] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${existingTarget.counsellor_id}
        AND ${clientInformation.archived} = false
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
      )`
    ) as any;

  const achievedTarget = enrollmentResult?.count || 0;

  // Update target
  const [updated] = await db
    .update(leaderBoard)
    .set({
      target: target,
      achieved_target: achievedTarget,
    })
    .where(eq(leaderBoard.id, targetId))
    .returning();

  return updated;
};

/* ==============================
   GET MONTHLY ENROLLMENT GOAL
   Returns enrollment goal data for a specific counsellor (Image 2)
   Shows: target, achieved, remaining, percentage completed
============================== */
export const getMonthlyEnrollmentGoal = async (
  counsellorId: number,
  month?: number,
  year?: number
) => {
  // Default to current month/year if not provided
  const currentDate = new Date();
  const targetMonth = month || currentDate.getMonth() + 1;
  const targetYear = year || currentDate.getFullYear();

  // Validate month and year
  if (targetMonth < 1 || targetMonth > 12) {
    throw new Error("Invalid month. Must be between 1 and 12");
  }
  if (targetYear < 2000 || targetYear > 3000) {
    throw new Error("Invalid year");
  }

  // Verify counsellor exists
  const [counsellor] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, counsellorId))
    .limit(1);

  if (!counsellor) {
    throw new Error("Counsellor not found");
  }

  if (counsellor.role !== "counsellor") {
    throw new Error("User is not a counsellor");
  }

  // Calculate date range for the month
  const startDate = new Date(targetYear, targetMonth - 1, 1);
  const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];
  const startTimestamp = startDate.toISOString();
  const endTimestamp = endDate.toISOString();

  // Count enrollments (achieved) for this month/year: unique clients who have payments (INITIAL, BEFORE_VISA, AFTER_VISA)
  const [enrollmentResult] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${clientPayments.clientId})`,
    })
    .from(clientPayments)
    .innerJoin(
      clientInformation,
      eq(clientPayments.clientId, clientInformation.clientId)
    )
    .where(
      sql`(
        ${clientInformation.counsellorId} = ${counsellorId}
        AND ${clientInformation.archived} = false
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
      )`
    ) as any;

  const achieved = enrollmentResult?.count || 0;

  // Get target from leaderboard table (if exists)
  const [targetRecord] = await db
    .select()
    .from(leaderBoard)
    .where(
      and(
        eq(leaderBoard.counsellor_id, counsellorId),
        sql`EXTRACT(YEAR FROM ${leaderBoard.createdAt}) = ${targetYear}`,
        sql`EXTRACT(MONTH FROM ${leaderBoard.createdAt}) = ${targetMonth}`
      )
    )
    .limit(1);

  const target = targetRecord?.target || 0;
  const remaining = Math.max(0, target - achieved);
  const percentageCompleted = target > 0 ? Math.round((achieved / target) * 100) : 0;

  return {
    counsellorId: counsellor.id,
    fullName: counsellor.fullName,
    target,
    achieved,
    remaining,
    percentageCompleted,
    month: targetMonth,
    year: targetYear,
  };
};