import { Request, Response } from "express";
import { getDashboardStats, DashboardFilter } from "../models/dashboard.model";
import { redisGetJson, redisSetJson } from "../config/redis";

const DASHBOARD_CACHE_TTL_SECONDS = 60;

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!YYYY_MM_DD.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

/**
 * GET /api/dashboard/stats
 * Query params:
 * - filter: "today" | "weekly" | "monthly" | "yearly" | "custom" (default: "today")
 * - beforeDate: YYYY-MM-DD (required when filter=custom) — start of range
 * - afterDate: YYYY-MM-DD (required when filter=custom) — end of range
 */
export const getDashboardStatsController = async (
  req: Request,
  res: Response
) => {
  try {
    const filterParam = (req.query.filter as string) || "today";

    const validFilters: DashboardFilter[] = ["today", "weekly", "monthly", "yearly", "custom"];
    if (!validFilters.includes(filterParam as DashboardFilter)) {
      return res.status(400).json({
        success: false,
        message: `Invalid filter. Must be one of: ${validFilters.join(", ")}`,
      });
    }

    const filter = filterParam as DashboardFilter;

    let beforeDate: string | undefined;
    let afterDate: string | undefined;

    if (filter === "custom") {
      beforeDate = req.query.beforeDate as string;
      afterDate = req.query.afterDate as string;
      if (!beforeDate || !afterDate) {
        return res.status(400).json({
          success: false,
          message: "Custom filter requires both beforeDate and afterDate (YYYY-MM-DD).",
        });
      }
      if (!isValidDateStr(beforeDate) || !isValidDateStr(afterDate)) {
        return res.status(400).json({
          success: false,
          message: "beforeDate and afterDate must be valid dates in YYYY-MM-DD format.",
        });
      }
      if (new Date(beforeDate) > new Date(afterDate)) {
        return res.status(400).json({
          success: false,
          message: "beforeDate must be on or before afterDate.",
        });
      }
    }

    const filterToRangeMap: Record<DashboardFilter, "today" | "week" | "month" | "year" | "custom"> = {
      today: "week",
      weekly: "week",
      monthly: "month",
      yearly: "year",
      custom: "custom",
    };
    const range = filterToRangeMap[filter];

    const user = (req as any).user;
    const userId = user?.id ?? "";
    const userRole = user?.role ?? "";

    const cacheKey = `dashboard:stats:${filter}:${beforeDate ?? ""}:${afterDate ?? ""}:${userId}:${userRole}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const stats = await getDashboardStats(
      filter,
      beforeDate,
      afterDate,
      userId,
      userRole,
      range
    );

    await redisSetJson(cacheKey, stats, DASHBOARD_CACHE_TTL_SECONDS);
    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Get dashboard stats error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch dashboard stats",
    });
  }
};
