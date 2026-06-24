import type { Request, Response } from "express";
import type { Role } from "../../../types/role";
import {
  ENROLLMENT_TREND_RANGES,
  isEnrollmentTrendRole,
  type EnrollmentTrendRange,
} from "../constants/enrollmentTrend.constants";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import { getCachedEnrollmentTrend } from "../cache/reports.cache.service";

const viewerFromReq = (req: Request) => {
  if (!req.user?.id || !req.user.role) return null;
  return { userId: req.user.id, role: req.user.role as Role };
};

export const getEnrollmentTrendController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!isEnrollmentTrendRole(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const rangeParam = (req.query.range as string) || "12_month";
    if (
      !ENROLLMENT_TREND_RANGES.includes(rangeParam as EnrollmentTrendRange)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid range. Must be one of: ${ENROLLMENT_TREND_RANGES.join(", ")}`,
      });
    }

    const branchCode = req.query.branchCode as string | undefined;

    const result = await getCachedEnrollmentTrend(viewer, {
      range: rangeParam as EnrollmentTrendRange,
      branchCode,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch enrollment trend";
    console.error("getEnrollmentTrendController error:", error);
    return res.status(500).json({ success: false, message });
  }
};
