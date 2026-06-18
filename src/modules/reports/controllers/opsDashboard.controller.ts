import type { Request, Response } from "express";
import type { Role } from "../../../types/role";
import { OPS_DASHBOARD_FILTERS, OPS_DASHBOARD_ROLES } from "../constants/opsDashboard.constants";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import { getCachedOpsDashboard } from "../cache/reports.cache.service";
import { isValidDateStr } from "../utils/opsDashboardScope";

const viewerFromReq = (req: Request) => {
  if (!req.user?.id || !req.user.role) return null;
  return { userId: req.user.id, role: req.user.role as Role };
};

const canViewOpsDashboard = (role: Role): boolean =>
  role === "developer" ||
  (OPS_DASHBOARD_ROLES as readonly string[]).includes(role);

export const getOpsDashboardController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!canViewOpsDashboard(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const filterParam = (req.query.filter as string) || "workload";
    if (
      !OPS_DASHBOARD_FILTERS.includes(
        filterParam as (typeof OPS_DASHBOARD_FILTERS)[number]
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid filter. Must be one of: ${OPS_DASHBOARD_FILTERS.join(", ")}`,
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

    const result = await getCachedOpsDashboard(viewer, {
      filter: filterParam as (typeof OPS_DASHBOARD_FILTERS)[number],
      fromDate,
      toDate,
    });

    return res.status(200).json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch ops dashboard";
    console.error("getOpsDashboardController error:", error);
    const status = message.startsWith("Forbidden") ? 403 : 500;
    return res.status(status).json({ success: false, message });
  }
};
