import { Request, Response } from "express";
import { getDateRange, type DashboardFilter } from "../models/dashboard.model";
import {
  canAccessCounsellorReport,
  getCounsellorReport,
} from "../models/counsellorReport.model";
import { redisGetJson, redisSetJson } from "../config/redis";

const COUNSELLOR_REPORT_CACHE_TTL_SECONDS = 60;

/**
 * GET /api/reports/counsellor/:counsellorId
 *
 * Individual counsellor report with performance, monthly comparison, product analytics.
 *
 * Params:
 *   - counsellorId: numeric id OR "me" (counsellor role only → resolves to own id)
 *
 * Query:
 *   - filter: today | weekly | monthly | yearly | custom  (default: monthly)
 *   - beforeDate / afterDate  OR  startDate / endDate  (required for custom)
 *   - saleTypeId (or saleType): optional; when set, report is filtered by this sale type and performance includes sale_type_count
 *
 * Access:
 *   - Admin: any counsellor
 *   - Manager (isSupervisor=true): any counsellor
 *   - Manager (isSupervisor=false): only own team counsellors
 *   - Counsellor: own report only
 */
export const getCounsellorReportController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const viewerId = req.user.id as number;
    const viewerRole = req.user.role as string;

    // ── Resolve counsellor id ────────────────────────────────────
    let counsellorId: number;
    const paramId = req.params.counsellorId;

    if (paramId === "me") {
      if (viewerRole !== "counsellor") {
        return res
          .status(400)
          .json({ message: '"me" is only valid for counsellor role' });
      }
      counsellorId = viewerId;
    } else {
      counsellorId = parseInt(paramId, 10);
      if (Number.isNaN(counsellorId)) {
        return res.status(400).json({ message: "Invalid counsellorId" });
      }
    }

    // ── Access control ───────────────────────────────────────────
    const canAccess = await canAccessCounsellorReport(viewerId, viewerRole, counsellorId);
    if (!canAccess) {
      return res
        .status(403)
        .json({ message: "You don't have access to this counsellor's report" });
    }

    // ── Date range ───────────────────────────────────────────────
    // All roles: today | weekly | monthly | yearly | custom (today = today only, weekly = current week)
    const requestedFilter = (req.query.filter as DashboardFilter) || "monthly";
    const filter: DashboardFilter = requestedFilter;
    let beforeDate = req.query.beforeDate as string | undefined;
    let afterDate = req.query.afterDate as string | undefined;
    const startDateParam = req.query.startDate as string | undefined;
    const endDateParam = req.query.endDate as string | undefined;

    if (filter === "custom") {
      if (startDateParam && endDateParam) {
        beforeDate = startDateParam;
        afterDate = endDateParam;
      }
      if (!beforeDate || !afterDate) {
        return res.status(400).json({
          message:
            "Custom filter requires date range: use beforeDate & afterDate (YYYY-MM-DD) or startDate & endDate.",
        });
      }
      if (beforeDate > afterDate) {
        [beforeDate, afterDate] = [afterDate, beforeDate];
      }
    }

    const now = new Date();
    let dateRange: { start: Date; end: Date };

    if (filter === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      dateRange = { start, end };
    } else if (filter === "weekly") {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday, 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const weekEndSunday = new Date(start);
      weekEndSunday.setDate(start.getDate() + 6);
      weekEndSunday.setHours(23, 59, 59, 999);
      const end = weekEndSunday.getTime() > endOfToday.getTime() ? endOfToday : weekEndSunday;
      dateRange = { start, end };
    } else if (filter === "yearly") {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      dateRange = { start, end };
    } else {
      try {
        dateRange = getDateRange(filter, beforeDate, afterDate);
      } catch (dateError: any) {
        const msg = dateError?.message || "Invalid date range";
        if (
          typeof msg === "string" &&
          (msg.includes("Custom filter") ||
            msg.includes("beforeDate") ||
            msg.includes("afterDate") ||
            msg.includes("Invalid filter"))
        ) {
          return res.status(400).json({ message: msg });
        }
        throw dateError;
      }
    }

    // Pass explicit date strings for the selected range so all report data (today/weekly/monthly/yearly/custom) uses the same range
    const toLocalDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const dateOptions: {
      startDateStr: string;
      endDateStr: string;
      filter: DashboardFilter;
      saleTypeId?: number;
    } = {
      startDateStr: toLocalDateStr(dateRange.start),
      endDateStr: toLocalDateStr(dateRange.end),
      filter,
    };
    const saleTypeParam = req.query.saleTypeId ?? req.query.saleType;
    if (saleTypeParam != null) {
      const saleTypeId = typeof saleTypeParam === "string" ? parseInt(saleTypeParam, 10) : Number(saleTypeParam);
      if (!Number.isNaN(saleTypeId)) dateOptions.saleTypeId = saleTypeId;
    }

    const cacheKey = `reports:counsellor:${viewerId}:${viewerRole}:${counsellorId}:${dateOptions.filter}:${dateOptions.startDateStr}:${dateOptions.endDateStr}:${dateOptions.saleTypeId ?? ""}`;
    const cached = await redisGetJson<unknown>(cacheKey);
    if (cached != null) {
      return res.json(cached);
    }

    // ── Fetch report ─────────────────────────────────────────────
    const report = await getCounsellorReport(counsellorId, dateRange, dateOptions);
    await redisSetJson(cacheKey, report, COUNSELLOR_REPORT_CACHE_TTL_SECONDS);
    return res.json(report);
  } catch (err: any) {
    if (err?.message === "Counsellor not found") {
      return res.status(404).json({ message: "Counsellor not found" });
    }
    console.error("getCounsellorReportController", err);
    return res.status(500).json({ message: "Failed to load counsellor report" });
  }
};
