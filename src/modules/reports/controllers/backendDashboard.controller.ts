import type { Request, Response } from "express";
import type { Role } from "../../../types/role";
import {
  BACKEND_DASHBOARD_FILTERS,
  BACKEND_DASHBOARD_ROLES,
} from "../constants/backendDashboard.constants";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import { getCachedBackendDashboard } from "../cache/reports.cache.service";
import { isValidDateStr } from "../utils/reportDateRange";

const viewerFromReq = (req: Request) => {
  if (!req.user?.id || !req.user.role) return null;
  return { userId: req.user.id, role: req.user.role as Role };
};

const canViewBackendDashboard = (role: Role): boolean =>
  role === "developer" ||
  (BACKEND_DASHBOARD_ROLES as readonly string[]).includes(role);

export const getBackendDashboardController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!canViewBackendDashboard(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const filterParam = (req.query.filter as string) || "monthly";
    if (
      !BACKEND_DASHBOARD_FILTERS.includes(
        filterParam as (typeof BACKEND_DASHBOARD_FILTERS)[number]
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid filter. Must be one of: ${BACKEND_DASHBOARD_FILTERS.join(", ")}`,
      });
    }

    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const branchCode = req.query.branchCode as string | undefined;

    const categoryParam = req.query.category as string | undefined;
    const VALID_CATEGORIES = ["visitor", "spouse", "student"] as const;
    type ValidCategory = (typeof VALID_CATEGORIES)[number];
    if (categoryParam && !(VALID_CATEGORIES as readonly string[]).includes(categoryParam)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }
    const category = categoryParam as ValidCategory | undefined;

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

    const result = await getCachedBackendDashboard(viewer, {
      filter: filterParam as (typeof BACKEND_DASHBOARD_FILTERS)[number],
      fromDate,
      toDate,
      branchCode,
      category,
    });

    return res.status(200).json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch backend dashboard";
    console.error("getBackendDashboardController error:", error);
    return res.status(500).json({ success: false, message });
  }
};
