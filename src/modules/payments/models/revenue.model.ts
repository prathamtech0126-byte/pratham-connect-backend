import {
  and,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { dbSecond } from "../../../config/databaseConnectionSecond";
import { clients } from "../../clients/schemas/client_convert.schema";
import { personModule } from "../../clients/schemas/person.schema";
import { products } from "../../products/schemas/product.schema";
import { users } from "../../users/schemas/user.schema";
import {
  COUNT_ONLY_PRODUCTS,
  REVENUE_CORE_STAGES,
} from "../constants/revenue.constants";
import { amounts } from "../schemas/amount.schema";
import { dates } from "../schemas/date.schema";

export type RevenuePaymentRow = {
  amountId: string;
  amount: string;
  /** From dates.date — sole source for current-month filter */
  paymentDate: string;
  paymentType: "CORE" | "PRODUCT";
  consultancyStage: string | null;
  productName: string | null;
  counsellorLegacyUserId: number;
  counsellorFullName: string | null;
  counsellorEmpId: string | null;
  clientId: string;
  clientCode: string;
  legacyClientId: number | null;
  clientFullName: string;
};

/** Counsellor on the payment row: dates.action_by, then amounts.action_by */
const counsellorLegacyIdSql = sql<number>`COALESCE(${dates.actionBy}, ${amounts.actionBy})`;

const currentMonthOnDatesSql = (year: number, month: number) =>
  sql`EXTRACT(YEAR FROM ${dates.date}) = ${year} AND EXTRACT(MONTH FROM ${dates.date}) = ${month}`;

const revenueEligibilityFilter = or(
  and(
    eq(amounts.type, "CORE"),
    inArray(amounts.consultancyStage, [...REVENUE_CORE_STAGES])
  ),
  and(
    eq(amounts.type, "PRODUCT"),
    or(
      sql`${products.productName} IS NULL`,
      notInArray(products.productName, [...COUNT_ONLY_PRODUCTS])
    )
  )
);

/**
 * Revenue rows from amounts + dates only.
 * Month filter uses dates.date (year + month).
 */
export const getMonthRevenuePayments = async (
  year: number,
  month: number,
  counsellorLegacyUserId?: number
): Promise<RevenuePaymentRow[]> => {
  const filters = [currentMonthOnDatesSql(year, month), revenueEligibilityFilter];

  if (counsellorLegacyUserId != null) {
    filters.push(eq(counsellorLegacyIdSql, counsellorLegacyUserId));
  }

  const rows = await dbSecond
    .select({
      amountId: amounts.id,
      amount: amounts.amount,
      paymentDate: dates.date,
      paymentType: amounts.type,
      consultancyStage: amounts.consultancyStage,
      productName: products.productName,
      counsellorLegacyUserId: counsellorLegacyIdSql,
      counsellorFullName: users.fullName,
      counsellorEmpId: users.empId,
      clientId: clients.id,
      clientCode: clients.clientCode,
      legacyClientId: clients.legacyClientId,
      clientFullName: personModule.fullName,
    })
    .from(amounts)
    .innerJoin(dates, eq(dates.amountId, amounts.id))
    .innerJoin(clients, eq(clients.id, amounts.clientId))
    .innerJoin(personModule, eq(personModule.id, clients.personId))
    .leftJoin(products, eq(products.id, amounts.productId))
    .leftJoin(users, eq(users.legacyUserId, counsellorLegacyIdSql))
    .where(and(...filters))
    .orderBy(desc(dates.date), desc(amounts.createdAt));

  return rows.map((row) => ({
    amountId: row.amountId,
    amount: row.amount,
    paymentDate: row.paymentDate,
    paymentType: row.paymentType,
    consultancyStage: row.consultancyStage,
    productName: row.productName,
    counsellorLegacyUserId: Number(row.counsellorLegacyUserId),
    counsellorFullName: row.counsellorFullName,
    counsellorEmpId: row.counsellorEmpId,
    clientId: row.clientId,
    clientCode: row.clientCode,
    legacyClientId: row.legacyClientId,
    clientFullName: row.clientFullName,
  }));
};
