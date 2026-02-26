import { Request, Response } from "express";
import { getDateRange, type DashboardFilter } from "../models/dashboard.model";
import { getReport, type ReportUserRole, type ReportScopeOptions } from "../models/report.model";

/**
 * GET /api/reports
 * Query:
 *   - filter (today | weekly | monthly | yearly | custom), beforeDate, afterDate (required for custom).
 *   - managerId (admin only): show that manager's report only (their counsellors + their target/achieved).
 *   - counsellorId (manager only): show that counsellor's report only (must be under this manager).
 */
export const getReportController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = req.user.id as number;
    const userRole = req.user.role as ReportUserRole;
    if (!["admin", "manager", "counsellor"].includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const filter = (req.query.filter as DashboardFilter) || "monthly";
    // Custom range: accept beforeDate/afterDate (dashboard convention) or startDate/endDate (intuitive)
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
            "Custom filter requires date range: use beforeDate & afterDate (YYYY-MM-DD) or startDate & endDate (startDate = start, endDate = end).",
        });
      }
      // Ensure start <= end: use smaller as start, larger as end so either order works
      if (beforeDate > afterDate) {
        [beforeDate, afterDate] = [afterDate, beforeDate];
      }
    }
    const managerIdParam = req.query.managerId as string | undefined;
    const counsellorIdParam = req.query.counsellorId as string | undefined;

    const options: ReportScopeOptions = {};
    if (userRole === "admin" && managerIdParam != null) {
      const managerId = parseInt(managerIdParam, 10);
      if (Number.isNaN(managerId)) {
        return res.status(400).json({ message: "Invalid managerId" });
      }
      options.managerId = managerId;
    }
    if (userRole === "manager" && counsellorIdParam != null) {
      const counsellorId = parseInt(counsellorIdParam, 10);
      if (Number.isNaN(counsellorId)) {
        return res.status(400).json({ message: "Invalid counsellorId" });
      }
      options.counsellorId = counsellorId;
    }

    let dateRange;
    try {
      dateRange = getDateRange(filter, beforeDate, afterDate);
    } catch (dateError: any) {
      const msg = dateError?.message || "Invalid date range";
      if (
        typeof msg === "string" &&
        (msg.includes("Custom filter") || msg.includes("beforeDate") || msg.includes("afterDate") || msg.includes("Invalid filter"))
      ) {
        return res.status(400).json({ message: msg });
      }
      throw dateError;
    }

    const report = await getReport(userId, userRole, dateRange, options);

    return res.json(report);
  } catch (err) {
    console.error("getReportController", err);
    return res.status(500).json({ message: "Failed to load report" });
  }
};
