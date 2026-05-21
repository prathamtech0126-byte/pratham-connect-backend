import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { managerTargets } from "../schemas/managerTargets.schema";
import {
  getCounsellorEnrollmentCountByEnrollmentDate,
  getCounsellorCoreSaleAmount,
  getCounsellorCoreProductMetrics,
  getCounsellorOtherProductMetrics,
} from "./leaderboard.model";
import {
  getCoreServiceCount,
  getCoreSaleAmount,
  getCoreProductMetrics,
  getOtherProductMetrics,
} from "./dashboard.model";
import type { DateRange } from "./dashboard.model";
import { eq, and, asc, lte, gte, inArray, or, sql } from "drizzle-orm";
import type { TargetType } from "../schemas/managerTargets.schema";

const buildDateRange = (startDateStr: string, endDateStr: string): DateRange => {
  const [y1, m1, d1] = startDateStr.split("-").map(Number);
  const [y2, m2, d2] = endDateStr.split("-").map(Number);
  return {
    start: new Date(y1, m1 - 1, d1, 0, 0, 0, 0),
    end: new Date(y2, m2 - 1, d2, 23, 59, 59, 999),
  };
};

export interface ManagerAchieved {
  coreSale: { clients: number; revenue: number };
  coreProduct: { clients: number; revenue: number };
  otherProduct: { clients: number; revenue: number };
}

/** Per-counsellor achieved in same shape as target (individual count under a manager). */
export interface CounsellorAchievedItem {
  counsellor_id: number;
  full_name: string;
  email: string | null;
  core_sale_achieved_clients: number;
  core_sale_achieved_revenue: number;
  core_product_achieved_clients: number;
  core_product_achieved_revenue: number;
  other_product_achieved_clients: number;
  other_product_achieved_revenue: number;
}

/** Manager achieved plus breakdown by each counsellor under that manager. */
export interface ManagerAchievedWithBreakdown {
  achieved: ManagerAchieved;
  byCounsellor: CounsellorAchievedItem[];
}

export interface CreateManagerTargetInput {
  /** Single manager; when multiple managers use manager_ids, pass null here. */
  manager_id: number | null;
  /** When set, one row is created for all these managers with single target/overall. */
  manager_ids?: number[];
  start_date: string; // YYYY-MM-DD
  end_date: string;
  target_type?: TargetType;
  no_of_clients?: number;
  revenue?: string | number;
  core_sale_target_clients?: number;
  core_sale_target_revenue?: string | number;
  core_product_target_clients?: number;
  core_product_target_revenue?: string | number;
  other_product_target_clients?: number;
  other_product_target_revenue?: string | number;
  overall?: string | number;
}

export interface UpdateManagerTargetInput {
  manager_id?: number | null;
  manager_ids?: number[];
  start_date?: string;
  end_date?: string;
  target_type?: TargetType;
  no_of_clients?: number;
  revenue?: string | number;
  core_sale_target_clients?: number;
  core_sale_target_revenue?: string | number;
  core_product_target_clients?: number;
  core_product_target_revenue?: string | number;
  other_product_target_clients?: number;
  other_product_target_revenue?: string | number;
  overall?: string | number;
}

/** Get counsellor IDs for this manager. Supervisor managers return ALL active counsellors. */
export const getCounsellorIdsByManagerId = async (
  managerId: number
): Promise<{ ids: number[]; isSupervisor: boolean }> => {
  const [manager] = await db
    .select({ id: users.id, role: users.role, isSupervisor: users.isSupervisor })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);

  if (!manager || manager.role !== "manager") return { ids: [], isSupervisor: false };

  if (manager.isSupervisor) {
    const counsellors = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "counsellor"), eq(users.status, true)));
    return { ids: counsellors.map((c) => c.id), isSupervisor: true };
  }

  const counsellors = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "counsellor"), eq(users.managerId, managerId)));
  return { ids: counsellors.map((c) => c.id), isSupervisor: false };
};

/** Get counsellors for this manager with id, fullName, email. Supervisor managers return ALL active counsellors. */
export const getCounsellorsByManagerIdWithNames = async (
  managerId: number
): Promise<{ id: number; fullName: string; email: string }[]> => {
  const [manager] = await db
    .select({ id: users.id, role: users.role, isSupervisor: users.isSupervisor })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);

  if (!manager || manager.role !== "manager") return [];

  const counsellors = manager.isSupervisor
    ? await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(and(eq(users.role, "counsellor"), eq(users.status, true)))
    : await db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(and(eq(users.role, "counsellor"), eq(users.managerId, managerId)));

  return counsellors.map((c) => ({ id: c.id, fullName: c.fullName, email: c.email }));
};

/** Compute achieved (team aggregate) for a manager in a date range. */
export const getManagerAchievedForPeriod = async (
  managerId: number,
  startDateStr: string,
  endDateStr: string
): Promise<ManagerAchieved> => {
  const { ids: counsellorIds, isSupervisor } = await getCounsellorIdsByManagerId(managerId);
  const dateRange = buildDateRange(startDateStr, endDateStr);

  // Supervisor: use same global queries as dashboard admin — exact match guaranteed
  if (isSupervisor) {
    const [saleCount, saleAmount, coreProduct, otherProduct] = await Promise.all([
      getCoreServiceCount(dateRange),
      getCoreSaleAmount(dateRange),
      getCoreProductMetrics(dateRange),
      getOtherProductMetrics(dateRange),
    ]);
    return {
      coreSale: { clients: saleCount, revenue: saleAmount },
      coreProduct: { clients: coreProduct.count, revenue: coreProduct.amount },
      otherProduct: { clients: otherProduct.count, revenue: otherProduct.amount },
    };
  }

  // Non-supervisor: per-counsellor aggregation filtered to this manager's team
  const startTimestamp = `${startDateStr}T00:00:00.000Z`;
  const endTimestamp = `${endDateStr}T23:59:59.999Z`;

  const coreSale = { clients: 0, revenue: 0 };
  const coreProduct = { clients: 0, revenue: 0 };
  const otherProduct = { clients: 0, revenue: 0 };

  for (const cid of counsellorIds) {
    const [saleCount, saleAmount, coreMetrics, otherMetrics] = await Promise.all([
      getCounsellorEnrollmentCountByEnrollmentDate(cid, startDateStr, endDateStr),
      getCounsellorCoreSaleAmount(cid, startDateStr, endDateStr, startTimestamp, endTimestamp),
      getCounsellorCoreProductMetrics(cid, startDateStr, endDateStr),
      getCounsellorOtherProductMetrics(cid, startDateStr, endDateStr),
    ]);
    coreSale.clients += saleCount;
    coreSale.revenue += saleAmount;
    coreProduct.clients += coreMetrics.count;
    coreProduct.revenue += coreMetrics.amount;
    otherProduct.clients += otherMetrics.count;
    otherProduct.revenue += otherMetrics.amount;
  }

  return { coreSale, coreProduct, otherProduct };
};

/**
 * Same as getManagerAchievedForPeriod but also returns per-counsellor breakdown.
 * Each manager's counsellors are separate (Manager A → B,C,D; Manager L → F,H,P) with their own revenue/client counts.
 */
export const getManagerAchievedWithBreakdown = async (
  managerId: number,
  startDateStr: string,
  endDateStr: string
): Promise<ManagerAchievedWithBreakdown> => {
  const { isSupervisor } = await getCounsellorIdsByManagerId(managerId);
  const counsellors = await getCounsellorsByManagerIdWithNames(managerId);
  const dateRange = buildDateRange(startDateStr, endDateStr);
  const startTimestamp = `${startDateStr}T00:00:00.000Z`;
  const endTimestamp = `${endDateStr}T23:59:59.999Z`;

  const byCounsellor: CounsellorAchievedItem[] = [];
  const perCounsellorCoreSale = { clients: 0, revenue: 0 };
  const perCounsellorCoreProduct = { clients: 0, revenue: 0 };
  const perCounsellorOtherProduct = { clients: 0, revenue: 0 };

  for (const c of counsellors) {
    const [saleCount, saleAmount, coreMetrics, otherMetrics] = await Promise.all([
      getCounsellorEnrollmentCountByEnrollmentDate(c.id, startDateStr, endDateStr),
      getCounsellorCoreSaleAmount(c.id, startDateStr, endDateStr, startTimestamp, endTimestamp),
      getCounsellorCoreProductMetrics(c.id, startDateStr, endDateStr),
      getCounsellorOtherProductMetrics(c.id, startDateStr, endDateStr),
    ]);
    byCounsellor.push({
      counsellor_id: c.id,
      full_name: c.fullName,
      email: c.email,
      core_sale_achieved_clients: saleCount,
      core_sale_achieved_revenue: saleAmount,
      core_product_achieved_clients: coreMetrics.count,
      core_product_achieved_revenue: coreMetrics.amount,
      other_product_achieved_clients: otherMetrics.count,
      other_product_achieved_revenue: otherMetrics.amount,
    });
    perCounsellorCoreSale.clients += saleCount;
    perCounsellorCoreSale.revenue += saleAmount;
    perCounsellorCoreProduct.clients += coreMetrics.count;
    perCounsellorCoreProduct.revenue += coreMetrics.amount;
    perCounsellorOtherProduct.clients += otherMetrics.count;
    perCounsellorOtherProduct.revenue += otherMetrics.amount;
  }

  // Supervisor: use global dashboard totals so achieved matches dashboard cards exactly
  if (isSupervisor) {
    const [saleCount, saleAmount, coreProduct, otherProduct] = await Promise.all([
      getCoreServiceCount(dateRange),
      getCoreSaleAmount(dateRange),
      getCoreProductMetrics(dateRange),
      getOtherProductMetrics(dateRange),
    ]);
    return {
      achieved: {
        coreSale: { clients: saleCount, revenue: saleAmount },
        coreProduct: { clients: coreProduct.count, revenue: coreProduct.amount },
        otherProduct: { clients: otherProduct.count, revenue: otherProduct.amount },
      },
      byCounsellor,
    };
  }

  return {
    achieved: {
      coreSale: perCounsellorCoreSale,
      coreProduct: perCounsellorCoreProduct,
      otherProduct: perCounsellorOtherProduct,
    },
    byCounsellor,
  };
};

/** Create a manager target. One row for single or multiple managers (same target/overall). */
export const createManagerTarget = async (
  input: CreateManagerTargetInput
) => {
  const managerIds = input.manager_ids?.length
    ? input.manager_ids
    : (input.manager_id != null ? [input.manager_id] : []);
  const [row] = await db
    .insert(managerTargets)
    .values({
      manager_id: managerIds.length === 1 ? managerIds[0] : null,
      manager_ids: managerIds,
      start_date: input.start_date,
      end_date: input.end_date,
      core_sale_target_clients: input.core_sale_target_clients ?? 0,
      core_sale_target_revenue: String(input.core_sale_target_revenue ?? 0),
      core_product_target_clients: input.core_product_target_clients ?? 0,
      core_product_target_revenue: String(input.core_product_target_revenue ?? 0),
      other_product_target_clients: input.other_product_target_clients ?? 0,
      other_product_target_revenue: String(input.other_product_target_revenue ?? 0),
      overall: String(input.overall ?? 0),
      updatedAt: new Date(),
    })
    .returning();
  return row!;
};

/**
 * Returns manager IDs that already have a target overlapping the given date range.
 * Considers both manager_id and manager_ids (one row can cover multiple managers).
 */
export const getManagerIdsWithOverlappingTarget = async (
  managerIds: number[],
  startDate: string,
  endDate: string
): Promise<number[]> => {
  if (managerIds.length === 0) return [];
  const requestedSet = new Set(managerIds);
  const rows = await db
    .select({
      manager_id: managerTargets.manager_id,
      manager_ids: managerTargets.manager_ids,
    })
    .from(managerTargets)
    .where(
      and(
        lte(managerTargets.start_date, endDate),
        gte(managerTargets.end_date, startDate)
      )
    );
  const alreadyCovered = new Set<number>();
  for (const r of rows) {
    const rowManagerIds = r.manager_ids?.length ? r.manager_ids : (r.manager_id != null ? [r.manager_id] : []);
    for (const id of rowManagerIds) {
      if (requestedSet.has(id)) alreadyCovered.add(id);
    }
  }
  return [...alreadyCovered];
};

/** Get manager target by id. */
export const getManagerTargetById = async (id: number) => {
  const [row] = await db
    .select()
    .from(managerTargets)
    .where(eq(managerTargets.id, id))
    .limit(1);
  return row ?? null;
};

/** List manager targets, optionally by managerId and filter date range (overlap). */
export const getManagerTargets = async (
  managerId?: number,
  filterStartDate?: string,
  filterEndDate?: string
) => {
  const conditions = [];
  if (managerId != null) {
    conditions.push(
      or(
        eq(managerTargets.manager_id, managerId),
        sql`${managerId} = ANY(COALESCE(${managerTargets.manager_ids}, ARRAY[]::integer[]))`
      )
    );
  }
  if (filterStartDate != null && filterEndDate != null) {
    conditions.push(lte(managerTargets.start_date, filterEndDate));
    conditions.push(gte(managerTargets.end_date, filterStartDate));
  }
  if (conditions.length === 0) {
    return await db
      .select()
      .from(managerTargets)
      .orderBy(asc(managerTargets.start_date));
  }
  return await db
    .select()
    .from(managerTargets)
    .where(and(...conditions))
    .orderBy(asc(managerTargets.start_date));
};

/** Update manager target. */
export const updateManagerTarget = async (
  id: number,
  input: UpdateManagerTargetInput
) => {
  const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
  if (input.manager_ids !== undefined) {
    updatePayload.manager_ids = input.manager_ids;
    updatePayload.manager_id = input.manager_ids.length === 1 ? input.manager_ids[0] : null;
  }
  if (input.manager_id !== undefined) updatePayload.manager_id = input.manager_id;
  if (input.start_date !== undefined) updatePayload.start_date = input.start_date;
  if (input.end_date !== undefined) updatePayload.end_date = input.end_date;
  if (input.target_type !== undefined) updatePayload.target_type = input.target_type;
  if (input.no_of_clients !== undefined) updatePayload.no_of_clients = input.no_of_clients;
  if (input.revenue !== undefined) updatePayload.revenue = String(input.revenue);
  if (input.core_sale_target_clients !== undefined) updatePayload.core_sale_target_clients = input.core_sale_target_clients;
  if (input.core_sale_target_revenue !== undefined) updatePayload.core_sale_target_revenue = String(input.core_sale_target_revenue);
  if (input.core_product_target_clients !== undefined) updatePayload.core_product_target_clients = input.core_product_target_clients;
  if (input.core_product_target_revenue !== undefined) updatePayload.core_product_target_revenue = String(input.core_product_target_revenue);
  if (input.other_product_target_clients !== undefined) updatePayload.other_product_target_clients = input.other_product_target_clients;
  if (input.other_product_target_revenue !== undefined) updatePayload.other_product_target_revenue = String(input.other_product_target_revenue);
  if (input.overall !== undefined) updatePayload.overall = String(input.overall);

  const [row] = await db
    .update(managerTargets)
    .set(updatePayload as any)
    .where(eq(managerTargets.id, id))
    .returning();
  return row ?? null;
};

/** Delete manager target. */
export const deleteManagerTarget = async (id: number) => {
  const [row] = await db
    .delete(managerTargets)
    .where(eq(managerTargets.id, id))
    .returning();
  return row ?? null;
};
