import { Request, Response } from "express";
import { AuthenticatedRequest } from "../types/express-auth";
import { getActivityLogs, getActivityLogsCount } from "../models/activityLog.model";
import { redisGetJson, redisSetJson } from "../config/redis";

const ACTIVITY_LOGS_CACHE_TTL_SECONDS = 90;

/**
 * Get activity logs with role-based access control
 *
 * Access rules:
 * - Admin: All logs
 * - Manager: Only counsellor activities
 * - Counsellor: Own activities + Manager activities on their clients
 */
export const getActivityLogsController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user?.id || !authReq.user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = authReq.user.id;
    const userRole = authReq.user.role;

    // Parse query parameters
    const clientId = req.query.clientId
      ? Number(req.query.clientId)
      : undefined;
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const page = req.query.page ? Number(req.query.page) : 1;

    // Validate pagination
    const validLimit = Math.min(Math.max(limit, 1), 100); // Between 1 and 100
    const validPage = Math.max(page, 1);
    const validOffset = (validPage - 1) * validLimit;

    // Validate dates
    if (startDate && isNaN(startDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid startDate format. Use ISO date string (YYYY-MM-DD)",
      });
    }

    if (endDate && isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid endDate format. Use ISO date string (YYYY-MM-DD)",
      });
    }

    const cacheKey = `activity-logs:${userId}:${userRole}:${clientId ?? ""}:${action ?? ""}:${entityType ?? ""}:${startDate?.toISOString() ?? ""}:${endDate?.toISOString() ?? ""}:${validLimit}:${validOffset}`;
    const cached = await redisGetJson<{ data: any[]; pagination: any }>(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        pagination: cached.pagination,
        cached: true,
      });
    }

    // Get activity logs with role-based filtering
    const logs = await getActivityLogs({
      userId,
      userRole,
      clientId,
      action,
      entityType,
      startDate,
      endDate,
      limit: validLimit,
      offset: validOffset,
    });

    // Get total count for pagination
    const totalCount = await getActivityLogsCount({
      userId,
      userRole,
      clientId,
      action,
      entityType,
      startDate,
      endDate,
    });

    const totalPages = Math.ceil(totalCount / validLimit);
    const payload = {
      data: logs,
      pagination: {
        page: validPage,
        limit: validLimit,
        total: totalCount,
        totalPages,
        hasNext: validPage < totalPages,
        hasPrev: validPage > 1,
      },
    };
    await redisSetJson(cacheKey, payload, ACTIVITY_LOGS_CACHE_TTL_SECONDS);

    res.json({
      success: true,
      ...payload,
    });
  } catch (error: any) {
    console.error("Error fetching activity logs:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch activity logs",
    });
  }
};
