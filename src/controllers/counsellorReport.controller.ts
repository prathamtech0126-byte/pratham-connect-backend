import { Request, Response } from "express";
import { getDateRange, type DashboardFilter } from "../models/dashboard.model";
import {
  canAccessCounsellorReport,
  getCounsellorReport,
} from "../models/counsellorReport.model";

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
    // Counsellor → only monthly (current month) or custom (pick month/year)
    // Admin / Manager → all filters allowed
    const requestedFilter = (req.query.filter as DashboardFilter) || "monthly";
    const filter: DashboardFilter =
      viewerRole === "counsellor" && requestedFilter !== "custom"
        ? "monthly"
        : requestedFilter;
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

    let dateRange;
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

    // Counsellor report overrides: today = only today; yearly = current year only (dashboard getDateRange differs)
    const now = new Date();
    if (filter === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      dateRange = { start, end };
    } else if (filter === "yearly") {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      dateRange = { start, end };
    }

    // Pass explicit date strings for the selected range so all report data (today/weekly/monthly/yearly/custom) uses the same range
    const toLocalDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const dateOptions = {
      startDateStr: toLocalDateStr(dateRange.start),
      endDateStr: toLocalDateStr(dateRange.end),
      filter,
    };

    // ── Fetch report ─────────────────────────────────────────────
    const report = await getCounsellorReport(counsellorId, dateRange, dateOptions);
    return res.json(report);
  } catch (err: any) {
    if (err?.message === "Counsellor not found") {
      return res.status(404).json({ message: "Counsellor not found" });
    }
    console.error("getCounsellorReportController", err);
    return res.status(500).json({ message: "Failed to load counsellor report" });
  }
};
