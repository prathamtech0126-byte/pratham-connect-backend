import { Request, Response } from "express";
import {
  createManagerTarget,
  getManagerTargetById,
  getManagerTargets,
  getManagerIdsWithOverlappingTarget,
  updateManagerTarget,
  deleteManagerTarget,
  getManagerAchievedForPeriod,
  type UpdateManagerTargetInput,
} from "../models/managerTargets.model";
import { eq } from "drizzle-orm";
import { users } from "../schemas/users.schema";
import { db } from "../config/databaseConnection";
import { logActivity } from "../services/activityLog.service";
import { emitToAdmin, emitToCounsellor } from "../config/socket";
import { redisGetJson, redisSetJson, redisDel, redisDelByPrefix } from "../config/redis";

const MANAGER_TARGETS_CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = "manager-targets:";

const toDateStr = (d: Date | string) =>
  typeof d === "string" ? d : d.toISOString().split("T")[0];

/** Get first and last day of current month as YYYY-MM-DD. */
function getCurrentMonthRange(): { start_date: string; end_date: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    start_date: `${y}-${m}-01`,
    end_date: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Format YYYY-MM-DD as "1 Feb 2026" for leaderboard display. */
function formatDateForDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${day} ${month} ${y}`;
}

/** Normalize date to YYYY-MM-DD. Accepts YYYY-MM-DD or DD-MM-YYYY. */
function normalizeDateForDb(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return dateStr;
  const trimmed = dateStr.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // DD-MM-YYYY or D-M-YYYY
  const dmy = trimmed.split(/[-/]/).map((s) => s.padStart(2, "0"));
  if (dmy.length === 3) {
    const [d, m, y] = dmy;
    if (y.length === 4) return `${y}-${m}-${d}`;
  }
  return trimmed;
}

/** Max safe value for target client counts and revenue to avoid DB overflow. */
const MAX_SAFE_TARGET = 999_999_999;

/** Validate numeric target fields; returns user-friendly error or null. */
function validateManagerTargetNumbers(body: Record<string, unknown>): string | null {
  const check = (val: unknown, label: string): string | null => {
    if (val === undefined || val === null || val === "") return null;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return `${label} must be a valid positive number.`;
    if (n > MAX_SAFE_TARGET) return `${label} is too large. Please enter a value up to ${MAX_SAFE_TARGET.toLocaleString()}.`;
    return null;
  };
  const fields: [unknown, string][] = [
    [body.core_sale_target_clients ?? body.core_sale_clients ?? body.core_sales, "Core sales (target)"],
    [body.core_product_target_clients ?? body.core_product_clients ?? body.core_product, "Core product (target)"],
    [body.other_product_target_clients ?? body.other_product_clients ?? body.other_product, "Other product (target)"],
    [body.core_sale_target_revenue ?? body.core_sale_revenue, "Core sale revenue"],
    [body.core_product_target_revenue ?? body.core_product_revenue, "Core product revenue"],
    [body.other_product_target_revenue ?? body.other_product_revenue, "Other product revenue"],
    [body.overall ?? body.revenue, "Overall revenue"],
  ];
  for (const [val, label] of fields) {
    const err = check(val, label);
    if (err) return err;
  }
  return null;
}

/** Convert DB/technical errors into messages users can understand. */
function toFriendlyManagerTargetError(error: any): string {
  const msg = error?.message ?? String(error);
  if (!msg || typeof msg !== "string") return "Unable to save. Please check your entries and try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("failed query") || (lower.includes("update ") && lower.includes("set ")) || lower.includes("returning") || lower.includes("params:"))
    return "Unable to save. Please check that all numbers are within a reasonable range (e.g. under 1 billion).";
  if (lower.includes("out of range") || lower.includes("overflow") || lower.includes("numeric") || lower.includes("value too long"))
    return "One or more values are too large. Please enter smaller numbers.";
  if (lower.includes("invalid input") || lower.includes("invalid value"))
    return "One or more values are invalid. Please check your entries.";
  return "Unable to save. Please check your entries and try again.";
}

/**
 * Emit manager-target:updated for a manager (e.g. when their counsellor adds client/payment).
 * Call from client.controller or clientPayment.controller with the counsellor's managerId.
 */
export const emitManagerTargetUpdateForManager = async (managerId: number) => {
  try {
    await redisDelByPrefix(CACHE_PREFIX);
    const targets = await getManagerTargets(managerId);
    const withAchieved = await Promise.all(
      targets.map(async (row) => {
        const managerIds = row.manager_ids?.length ? row.manager_ids : (row.manager_id != null ? [row.manager_id] : []);
        const achievedList = await Promise.all(
          managerIds.map((mid) => getManagerAchievedForPeriod(mid, toDateStr(row.start_date), toDateStr(row.end_date)))
        );
        const achieved = achievedList.length
          ? achievedList.reduce(
              (acc, a) => ({
                coreSale: { clients: acc.coreSale.clients + a.coreSale.clients, revenue: acc.coreSale.revenue + a.coreSale.revenue },
                coreProduct: { clients: acc.coreProduct.clients + a.coreProduct.clients, revenue: acc.coreProduct.revenue + a.coreProduct.revenue },
                otherProduct: { clients: acc.otherProduct.clients + a.otherProduct.clients, revenue: acc.otherProduct.revenue + a.otherProduct.revenue },
              }),
              { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } }
            )
          : { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } };
        return { ...row, achieved };
      })
    );
    const eventData = {
      action: "ACHIEVED_UPDATED",
      managerId,
      targets: withAchieved,
    };
    emitToAdmin("manager-target:updated", eventData);
    emitToCounsellor(managerId, "manager-target:updated", eventData);
  } catch (err) {
    console.error("emitManagerTargetUpdateForManager error:", err);
  }
};

/* ==============================
   CREATE MANAGER TARGET
   POST /api/manager-targets
   Body: { manager_id, start_date, end_date, core_sale_*, core_product_*, other_product_*, ... }
   Access: admin only
============================== */
export const createManagerTargetController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const body = req.body as Record<string, unknown>;
    // Support single manager_id or manager_ids (array) for same goal for multiple managers
    const manager_ids_raw = body.manager_ids;
    const manager_id_single = body.manager_id != null ? Number(body.manager_id) : null;
    const manager_ids: number[] = Array.isArray(manager_ids_raw)
      ? manager_ids_raw.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : manager_id_single != null && Number.isFinite(manager_id_single) && manager_id_single > 0
        ? [manager_id_single]
        : [];

    const raw_start = body.start_date as string;
    const raw_end = body.end_date as string;

    if (manager_ids.length === 0 || !raw_start || !raw_end) {
      return res.status(400).json({
        success: false,
        message: "manager_id or manager_ids (array), start_date, and end_date are required",
      });
    }

    const validationError = validateManagerTargetNumbers(body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const start_date = normalizeDateForDb(raw_start);
    const end_date = normalizeDateForDb(raw_end);

    // Accept no. of clients and business revenue from admin in multiple shapes:
    // - Explicit: core_sale_target_clients, core_sale_target_revenue, ...
    // - Shorthand: core_sales (clients), core_sale_revenue; core_product, core_product_revenue; other_product, other_product_revenue
    // - Or: core_sale_clients, core_sale_revenue; core_product_clients, core_product_revenue; other_product_clients, other_product_revenue
    const num = (v: unknown): number => (v === undefined || v === null ? 0 : Number(v));
    const dec = (v: unknown): string => (v === undefined || v === null ? "0" : String(v));

    const core_sale_target_clients = num(
      body.core_sale_target_clients ?? body.core_sale_clients ?? body.core_sales
    );
    const core_sale_target_revenue = dec(
      body.core_sale_target_revenue ?? body.core_sale_revenue ?? body.core_sales_revenue
    );
    const core_product_target_clients = num(
      body.core_product_target_clients ?? body.core_product_clients ?? body.core_product
    );
    const core_product_target_revenue = dec(
      body.core_product_target_revenue ?? body.core_product_revenue ?? body.core_product_revenue
    );
    const other_product_target_clients = num(
      body.other_product_target_clients ?? body.other_product_clients ?? body.other_product
    );
    const other_product_target_revenue = dec(
      body.other_product_target_revenue ?? body.other_product_revenue ?? body.other_product_revenue
    );

    const no_of_clients = num(body.no_of_clients);
    const revenue = dec(body.revenue);
    const overall = dec(body.overall);

    // Validate all manager_ids are valid managers
    const managers = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.role, "manager"));
    const validManagerIds = new Set(managers.map((m) => m.id));
    const invalidIds = manager_ids.filter((id) => !validManagerIds.has(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid or non-manager user id(s): ${invalidIds.join(", ")}`,
      });
    }

    // Prevent adding a manager who already has a target for this date range
    const alreadyHasTarget = await getManagerIdsWithOverlappingTarget(
      manager_ids,
      start_date,
      end_date
    );
    if (alreadyHasTarget.length > 0) {
      return res.status(400).json({
        success: false,
        message: `The following manager(s) already have a target for this date range and cannot be added again: ${alreadyHasTarget.join(", ")}`,
        managerIdsAlreadyWithTarget: alreadyHasTarget,
      });
    }

    const created = await createManagerTarget({
      manager_id: manager_ids.length === 1 ? manager_ids[0] : null,
      manager_ids: manager_ids,
      start_date,
      end_date,
      target_type: (body.target_type as "Core Sale" | "Core Product" | "Other Product" | "Revenue") || "Revenue",
      no_of_clients: num(body.no_of_clients),
      revenue,
      core_sale_target_clients,
      core_sale_target_revenue,
      core_product_target_clients,
      core_product_target_revenue,
      other_product_target_clients,
      other_product_target_revenue,
      overall,
    });

    try {
      await redisDelByPrefix(CACHE_PREFIX);
    } catch {
      // ignore
    }

    const description =
      manager_ids.length === 1
        ? `Manager target created for manager ${manager_ids[0]} (${start_date} to ${end_date})`
        : `Manager target created for ${manager_ids.length} managers (${start_date} to ${end_date}) – single target/overall`;
    try {
      await logActivity(req, {
        entityType: "manager_target",
        entityId: created.id,
        action: "CREATE",
        newValue: created,
        description,
        performedBy: req.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in createManagerTargetController:", activityError);
    }

    const createdManagerIds = created.manager_ids?.length ? created.manager_ids : (created.manager_id != null ? [created.manager_id] : []);
    try {
      const achievedList = await Promise.all(
        createdManagerIds.map((mid) =>
          getManagerAchievedForPeriod(mid, toDateStr(created.start_date), toDateStr(created.end_date))
        )
      );
      const achieved = achievedList.length
        ? achievedList.reduce(
            (acc, a) => ({
              coreSale: { clients: acc.coreSale.clients + a.coreSale.clients, revenue: acc.coreSale.revenue + a.coreSale.revenue },
              coreProduct: { clients: acc.coreProduct.clients + a.coreProduct.clients, revenue: acc.coreProduct.revenue + a.coreProduct.revenue },
              otherProduct: { clients: acc.otherProduct.clients + a.otherProduct.clients, revenue: acc.otherProduct.revenue + a.otherProduct.revenue },
            }),
            { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } }
          )
        : { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } };
      const eventData = {
        action: "CREATED",
        target: created,
        achieved,
        managerId: created.manager_id ?? createdManagerIds[0] ?? null,
        managerIds: createdManagerIds,
      };
      emitToAdmin("manager-target:updated", eventData);
      for (const mid of createdManagerIds) {
        emitToCounsellor(mid, "manager-target:updated", eventData);
      }
    } catch (wsError) {
      console.error("WebSocket emit error in createManagerTargetController:", wsError);
    }

    res.status(201).json({
      success: true,
      data: created,
    });
  } catch (error: any) {
    const friendlyMessage = toFriendlyManagerTargetError(error);
    res.status(400).json({
      success: false,
      message: friendlyMessage,
    });
  }
};

/* ==============================
   GET MANAGER TARGET BY ID
   GET /api/manager-targets/:id
   Access: admin, or manager (own targets only)
============================== */
export const getManagerTargetByIdController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid target ID",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    const cacheKey = `${CACHE_PREFIX}id:${id}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      const canAccess =
        userRole !== "manager" ||
        cached.manager_id === userId ||
        (Array.isArray(cached.manager_ids) && cached.manager_ids.includes(userId));
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own targets",
        });
      }
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const target = await getManagerTargetById(id);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Manager target not found",
      });
    }

    const managerCanAccess =
      target.manager_id === userId ||
      (Array.isArray(target.manager_ids) && target.manager_ids.length > 0 && target.manager_ids.includes(userId));
    if (userRole === "manager" && !managerCanAccess) {
      return res.status(403).json({
        success: false,
        message: "You can only view your own targets",
      });
    }

    const managerIds = target.manager_ids?.length ? target.manager_ids : (target.manager_id != null ? [target.manager_id] : []);
    const achievedList = await Promise.all(
      managerIds.map((mid) =>
        getManagerAchievedForPeriod(mid, toDateStr(target.start_date), toDateStr(target.end_date))
      )
    );
    const achieved = achievedList.reduce(
      (acc, a) => ({
        coreSale: { clients: acc.coreSale.clients + a.coreSale.clients, revenue: acc.coreSale.revenue + a.coreSale.revenue },
        coreProduct: { clients: acc.coreProduct.clients + a.coreProduct.clients, revenue: acc.coreProduct.revenue + a.coreProduct.revenue },
        otherProduct: { clients: acc.otherProduct.clients + a.otherProduct.clients, revenue: acc.otherProduct.revenue + a.otherProduct.revenue },
      }),
      { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } }
    );
    const payload = {
      ...target,
      achieved,
    };
    await redisSetJson(cacheKey, payload, MANAGER_TARGETS_CACHE_TTL_SECONDS);

    res.status(200).json({
      success: true,
      data: payload,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   LIST MANAGER TARGETS
   GET /api/manager-targets?managerId=1&start_date=2026-02-01&end_date=2026-02-19
   Query: managerId (optional), start_date + end_date or from + to (optional; default: current month)
   Access: admin (all or by managerId), manager (own only, managerId ignored)
   - Returns only targets that overlap the selected date range.
   - Achieved is computed for the selected period (or current month by default).
============================== */
export const listManagerTargetsController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;
    const queryManagerId = req.query.managerId
      ? Number(req.query.managerId)
      : undefined;

    let managerId: number | undefined;
    if (userRole === "admin") {
      managerId = queryManagerId;
    } else if (userRole === "manager") {
      managerId = userId;
    } else {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const rawStart = (req.query.start_date ?? req.query.from) as string | undefined;
    const rawEnd = (req.query.end_date ?? req.query.to) as string | undefined;
    let filterStart: string;
    let filterEnd: string;
    if (rawStart && rawEnd) {
      filterStart = normalizeDateForDb(rawStart);
      filterEnd = normalizeDateForDb(rawEnd);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filterStart) || !/^\d{4}-\d{2}-\d{2}$/.test(filterEnd)) {
        return res.status(400).json({
          success: false,
          message: "Invalid start_date or end_date",
        });
        }
      if (filterStart > filterEnd) {
        return res.status(400).json({
          success: false,
          message: "start_date must be before or equal to end_date",
        });
      }
    } else {
      const current = getCurrentMonthRange();
      filterStart = current.start_date;
      filterEnd = current.end_date;
    }

    const cacheKey = managerId != null
      ? `${CACHE_PREFIX}list:manager:${managerId}:${filterStart}:${filterEnd}`
      : `${CACHE_PREFIX}list:all:${filterStart}:${filterEnd}`;
    const cached = await redisGetJson<any>(cacheKey);
    const cachedList = Array.isArray(cached) ? cached : cached?.data;
    if (cachedList && Array.isArray(cachedList)) {
      return res.status(200).json({
        success: true,
        data: cachedList,
        count: cachedList.length,
        filter_start_date: filterStart,
        filter_end_date: filterEnd,
        filter_period_display: `${formatDateForDisplay(filterStart)} - ${formatDateForDisplay(filterEnd)}`,
        cached: true,
      });
    }

    const rows = await getManagerTargets(managerId, filterStart, filterEnd);
    const withAchieved = await Promise.all(
      rows.map(async (row) => {
        const managerIds = row.manager_ids?.length ? row.manager_ids : (row.manager_id != null ? [row.manager_id] : []);
        const achievedList = await Promise.all(
          managerIds.map((mid) => getManagerAchievedForPeriod(mid, filterStart, filterEnd))
        );
        const achieved = achievedList.reduce(
          (acc, a) => ({
            coreSale: { clients: acc.coreSale.clients + a.coreSale.clients, revenue: acc.coreSale.revenue + a.coreSale.revenue },
            coreProduct: { clients: acc.coreProduct.clients + a.coreProduct.clients, revenue: acc.coreProduct.revenue + a.coreProduct.revenue },
            otherProduct: { clients: acc.otherProduct.clients + a.otherProduct.clients, revenue: acc.otherProduct.revenue + a.otherProduct.revenue },
          }),
          { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } }
        );
        return { ...row, achieved };
      })
    );
    const totalRevenue = (item: { achieved?: { coreSale?: { revenue: number }; coreProduct?: { revenue: number }; otherProduct?: { revenue: number } } }) =>
      (item.achieved?.coreSale?.revenue ?? 0) +
      (item.achieved?.coreProduct?.revenue ?? 0) +
      (item.achieved?.otherProduct?.revenue ?? 0);
    withAchieved.sort((a, b) => totalRevenue(b) - totalRevenue(a));

    await redisSetJson(
      cacheKey,
      { data: withAchieved },
      MANAGER_TARGETS_CACHE_TTL_SECONDS
    );

    res.status(200).json({
      success: true,
      data: withAchieved,
      count: withAchieved.length,
      filter_start_date: filterStart,
      filter_end_date: filterEnd,
      filter_period_display: `${formatDateForDisplay(filterStart)} - ${formatDateForDisplay(filterEnd)}`,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   UPDATE MANAGER TARGET
   PUT /api/manager-targets/:id
   Access: admin only
============================== */
export const updateManagerTargetController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid target ID",
      });
    }

    const body = req.body as Record<string, unknown>;
    const validationError = validateManagerTargetNumbers(body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }
    const existing = await getManagerTargetById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Manager target not found",
      });
    }

    const num = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number(v));
    const dec = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

    const updatePayload: UpdateManagerTargetInput = {};
    const manager_ids_raw = body.manager_ids;
    if (Array.isArray(manager_ids_raw) && manager_ids_raw.length > 0) {
      const manager_ids = manager_ids_raw.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
      if (manager_ids.length > 0) updatePayload.manager_ids = manager_ids;
    }
    if (body.start_date != null) updatePayload.start_date = normalizeDateForDb(String(body.start_date));
    if (body.end_date != null) updatePayload.end_date = normalizeDateForDb(String(body.end_date));
    if (body.target_type != null) updatePayload.target_type = body.target_type as UpdateManagerTargetInput["target_type"];
    if (body.no_of_clients !== undefined) updatePayload.no_of_clients = num(body.no_of_clients) ?? 0;
    if (body.revenue !== undefined) updatePayload.revenue = dec(body.revenue) ?? "0";
    if (body.core_sale_target_clients !== undefined || body.core_sale_clients !== undefined || body.core_sales !== undefined)
      updatePayload.core_sale_target_clients = num(body.core_sale_target_clients ?? body.core_sale_clients ?? body.core_sales) ?? 0;
    if (body.core_sale_target_revenue !== undefined || body.core_sale_revenue !== undefined || body.core_sales_revenue !== undefined)
      updatePayload.core_sale_target_revenue = dec(body.core_sale_target_revenue ?? body.core_sale_revenue ?? body.core_sales_revenue) ?? "0";
    if (body.core_product_target_clients !== undefined || body.core_product_clients !== undefined || body.core_product !== undefined)
      updatePayload.core_product_target_clients = num(body.core_product_target_clients ?? body.core_product_clients ?? body.core_product) ?? 0;
    if (body.core_product_target_revenue !== undefined || body.core_product_revenue !== undefined)
      updatePayload.core_product_target_revenue = dec(body.core_product_target_revenue ?? body.core_product_revenue) ?? "0";
    if (body.other_product_target_clients !== undefined || body.other_product_clients !== undefined || body.other_product !== undefined)
      updatePayload.other_product_target_clients = num(body.other_product_target_clients ?? body.other_product_clients ?? body.other_product) ?? 0;
    if (body.other_product_target_revenue !== undefined || body.other_product_revenue !== undefined)
      updatePayload.other_product_target_revenue = dec(body.other_product_target_revenue ?? body.other_product_revenue) ?? "0";
    if (body.overall !== undefined) updatePayload.overall = dec(body.overall) ?? "0";

    const updated = await updateManagerTarget(id, updatePayload);
    if (!updated) {
      return res.status(500).json({
        success: false,
        message: "Update failed",
      });
    }

    const idCacheKey = `${CACHE_PREFIX}id:${id}`;
    try {
      await redisDel(idCacheKey);
      await redisDelByPrefix(CACHE_PREFIX);
    } catch {
      // ignore
    }

    try {
      await logActivity(req, {
        entityType: "manager_target",
        entityId: id,
        action: "UPDATE",
        oldValue: existing,
        newValue: updated,
        description: `Manager target ${id} updated`,
        performedBy: req.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in updateManagerTargetController:", activityError);
    }

    try {
      const updatedManagerIds = updated.manager_ids?.length ? updated.manager_ids : (updated.manager_id != null ? [updated.manager_id] : []);
      const achievedList = await Promise.all(
        updatedManagerIds.map((mid) =>
          getManagerAchievedForPeriod(mid, toDateStr(updated.start_date), toDateStr(updated.end_date))
        )
      );
      const achieved = achievedList.length
        ? achievedList.reduce(
            (acc, a) => ({
              coreSale: { clients: acc.coreSale.clients + a.coreSale.clients, revenue: acc.coreSale.revenue + a.coreSale.revenue },
              coreProduct: { clients: acc.coreProduct.clients + a.coreProduct.clients, revenue: acc.coreProduct.revenue + a.coreProduct.revenue },
              otherProduct: { clients: acc.otherProduct.clients + a.otherProduct.clients, revenue: acc.otherProduct.revenue + a.otherProduct.revenue },
            }),
            { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } }
          )
        : { coreSale: { clients: 0, revenue: 0 }, coreProduct: { clients: 0, revenue: 0 }, otherProduct: { clients: 0, revenue: 0 } };
      // Write-through: update Redis cache for this ID so GET by id returns fresh data immediately
      const cachePayload = { ...updated, achieved };
      await redisSetJson(idCacheKey, cachePayload, MANAGER_TARGETS_CACHE_TTL_SECONDS);
      const eventData = {
        action: "UPDATED",
        target: updated,
        achieved,
        managerId: updated.manager_id ?? updatedManagerIds[0] ?? null,
        managerIds: updatedManagerIds,
      };
      emitToAdmin("manager-target:updated", eventData);
      for (const mid of updatedManagerIds) {
        emitToCounsellor(mid, "manager-target:updated", eventData);
      }
    } catch (wsError) {
      console.error("WebSocket emit error in updateManagerTargetController:", wsError);
    }

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    const friendlyMessage = toFriendlyManagerTargetError(error);
    res.status(400).json({
      success: false,
      message: friendlyMessage,
    });
  }
};

/* ==============================
   DELETE MANAGER TARGET
   DELETE /api/manager-targets/:id
   Access: admin only
============================== */
export const deleteManagerTargetController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid target ID",
      });
    }

    const existing = await getManagerTargetById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Manager target not found",
      });
    }

    const managerIdsToEmit = existing.manager_ids?.length ? existing.manager_ids : (existing.manager_id != null ? [existing.manager_id] : []);
    await deleteManagerTarget(id);

    const idCacheKey = `${CACHE_PREFIX}id:${id}`;
    try {
      await redisDel(idCacheKey);
      await redisDelByPrefix(CACHE_PREFIX);
    } catch {
      // ignore
    }

    try {
      await logActivity(req, {
        entityType: "manager_target",
        entityId: id,
        action: "DELETE",
        oldValue: existing,
        description: `Manager target ${id} deleted`,
        performedBy: req.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in deleteManagerTargetController:", activityError);
    }

    try {
      const eventData = {
        action: "DELETED",
        targetId: id,
        managerIds: managerIdsToEmit,
      };
      emitToAdmin("manager-target:updated", eventData);
      for (const mid of managerIdsToEmit) {
        emitToCounsellor(mid, "manager-target:updated", eventData);
      }
    } catch (wsError) {
      console.error("WebSocket emit error in deleteManagerTargetController:", wsError);
    }

    res.status(200).json({
      success: true,
      message: "Manager target deleted",
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
