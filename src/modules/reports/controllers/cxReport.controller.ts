import type { Request, Response } from "express";
import type { Role } from "../../../types/role";
import {
  CX_REPORT_FILTERS,
  CX_REPORT_ROLES,
} from "../constants/cxReport.constants";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import { getCachedCxReport } from "../cache/reports.cache.service";
import { isValidDateStr } from "../utils/reportDateRange";

const viewerFromReq = (req: Request) => {
  if (!req.user?.id || !req.user.role) return null;
  return { userId: req.user.id, role: req.user.role as Role };
};

const canViewCxReport = (role: Role): boolean =>
  role === "developer" ||
  (CX_REPORT_ROLES as readonly string[]).includes(role);

export const getCxReportController = async (req: Request, res: Response) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!canViewCxReport(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const filterParam = (req.query.filter as string) || "weekly";
    if (
      !CX_REPORT_FILTERS.includes(
        filterParam as (typeof CX_REPORT_FILTERS)[number]
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid filter. Must be one of: ${CX_REPORT_FILTERS.join(", ")}`,
      });
    }

    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    if (filterParam === "custom") {
      if (!fromDate || !toDate) {
        return res.status(400).json({
          success: false,
          message: "Custom filter requires fromDate and toDate (YYYY-MM-DD).",
        });
      }
      if (!isValidDateStr(fromDate) || !isValidDateStr(toDate)) {
        return res.status(400).json({
          success: false,
          message: "fromDate and toDate must be valid dates in YYYY-MM-DD format.",
        });
      }
      if (new Date(fromDate) > new Date(toDate)) {
        return res.status(400).json({
          success: false,
          message: "fromDate must be on or before toDate.",
        });
      }
    }

    const result = await getCachedCxReport(viewer, {
      filter: filterParam as (typeof CX_REPORT_FILTERS)[number],
      fromDate,
      toDate,
    });

    return res.status(200).json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch CX report";
    console.error("getCxReportController error:", error);
    const status = message.startsWith("Forbidden") ? 403 : 500;
    return res.status(status).json({ success: false, message });
  }
};
