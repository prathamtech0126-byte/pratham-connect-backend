import { Request, Response } from "express";
import { getDateRange, type DashboardFilter } from "../models/dashboard.model";
import { getReport, type ReportUserRole, type ReportScopeOptions } from "../models/report.model";
import { getSaleMetricSeries, getSaleReportDashboardData, type SaleMetric, type SaleReportFilter } from "../models/saleReport.model";

export const getReportController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = req.user.id as number;
    const userRole = req.user.role as ReportUserRole;
    if (!["admin", "manager"].includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const rawFilter = (req.query.filter as string) || "monthly";
    const filter = rawFilter.toLowerCase() as DashboardFilter;
    if (!["today", "weekly", "monthly", "yearly", "custom"].includes(filter)) {
      return res.status(400).json({ message: "Invalid filter; use today, weekly, monthly, yearly, or custom." });
    }
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
    const saleTypeIdParam = req.query.saleTypeId ?? req.query.saleType;
    const saleTypeId =
      saleTypeIdParam != null && saleTypeIdParam !== ""
        ? parseInt(String(saleTypeIdParam), 10)
        : undefined;

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

    const report = await getReport(userId, userRole, dateRange, options, saleTypeId);

    return res.json(report);
  } catch (err) {
    console.error("getReportController", err);
    return res.status(500).json({ message: "Failed to load report" });
  }
};

export const getSaleReportDashboardController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id as number;
    const userRole = req.user.role as ReportUserRole;
    if (!["admin", "manager"].includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const rawFilter = (req.query.filter as string) || "monthly";
    const filter = rawFilter.toLowerCase() as SaleReportFilter;
    if (!["today", "weekly", "monthly", "yearly", "custom"].includes(filter)) {
      return res.status(400).json({
        message: "Invalid filter; use today, weekly, monthly, yearly, or custom.",
      });
    }

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

    const options: ReportScopeOptions = {};
    const managerIdParam = req.query.managerId as string | undefined;
    const counsellorIdParam = req.query.counsellorId as string | undefined;
    if (userRole === "admin" && managerIdParam != null) {
      const managerId = parseInt(managerIdParam, 10);
      if (Number.isNaN(managerId)) return res.status(400).json({ message: "Invalid managerId" });
      options.managerId = managerId;
    }
    if (userRole === "manager" && counsellorIdParam != null) {
      const counsellorId = parseInt(counsellorIdParam, 10);
      if (Number.isNaN(counsellorId)) return res.status(400).json({ message: "Invalid counsellorId" });
      options.counsellorId = counsellorId;
    }

    const data = await getSaleReportDashboardData(
      userId,
      userRole,
      filter,
      beforeDate,
      afterDate,
      options
    );
    return res.json(data);
  } catch (err) {
    console.error("getSaleReportDashboardController", err);
    return res.status(500).json({ message: "Failed to load sale report dashboard" });
  }
};

export const getSaleMetricSeriesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id as number;
    const userRole = req.user.role as ReportUserRole;
    if (!["admin", "manager"].includes(userRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Fixed graph mode: always monthly 3-period comparison (current/previous/previous2).
    const filter: SaleReportFilter = "monthly";

    const rawMetric = (req.query.metric as string) || "core_sale";
    const metric = rawMetric.toLowerCase() as SaleMetric;
    if (!["client", "core_sale", "core_product", "other_product", "overall_revenue"].includes(metric)) {
      return res.status(400).json({
        message:
          "Invalid metric; use one of: client, core_sale, core_product, other_product, overall_revenue.",
      });
    }

    const options: ReportScopeOptions = {};
    const managerIdParam = req.query.managerId as string | undefined;
    const counsellorIdParam = req.query.counsellorId as string | undefined;
    if (userRole === "admin" && managerIdParam != null) {
      const managerId = parseInt(managerIdParam, 10);
      if (Number.isNaN(managerId)) return res.status(400).json({ message: "Invalid managerId" });
      options.managerId = managerId;
    }
    if (userRole === "manager" && counsellorIdParam != null) {
      const counsellorId = parseInt(counsellorIdParam, 10);
      if (Number.isNaN(counsellorId)) return res.status(400).json({ message: "Invalid counsellorId" });
      options.counsellorId = counsellorId;
    }

    const data = await getSaleMetricSeries(
      userId,
      userRole,
      filter,
      metric,
      undefined,
      undefined,
      options
    );
    return res.json(data);
  } catch (err) {
    console.error("getSaleMetricSeriesController", err);
    return res.status(500).json({ message: "Failed to load metric series" });
  }
};
