import { Request, Response } from "express";
import {
  getLeaderboard,
  getLeaderboardSummary,
  setTarget,
  updateTarget,
  getMonthlyEnrollmentGoal,
} from "../models/leaderboard.model";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { emitToAdmin, emitToCounsellor, emitToCounsellors } from "../config/socket";
import { redisGetJson, redisSetJson, redisDelByPrefix } from "../config/redis";

const LEADERBOARD_CACHE_TTL_SECONDS = 60;


/* ==============================
   GET LEADERBOARD
   GET /api/leaderboard?month=1&year=2026
============================== */
export const getLeaderboardController = async (
  req: Request,
  res: Response
) => {
  try {
    // Get month and year from query params, default to current month/year
    const currentDate = new Date();
    const month = req.query.month
      ? parseInt(req.query.month as string)
      : currentDate.getMonth() + 1;
    const year = req.query.year
      ? parseInt(req.query.year as string)
      : currentDate.getFullYear();

    // Validate month and year
    if (isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Must be between 1 and 12",
      });
    }

    if (isNaN(year) || year < 2000 || year > 3000) {
      return res.status(400).json({
        success: false,
        message: "Invalid year",
      });
    }

    const cacheKey = `leaderboard:${month}:${year}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      const data = Array.isArray(cached) ? cached : cached.leaderboard;
      const summary = Array.isArray(cached) ? undefined : cached.summary;
      return res.status(200).json({
        success: true,
        data,
        summary,
        month,
        year,
        cached: true,
      });
    }

    const result = await getLeaderboard(month, year);
    await redisSetJson(cacheKey, result, LEADERBOARD_CACHE_TTL_SECONDS);

    res.status(200).json({
      success: true,
      data: result.leaderboard,
      summary: result.summary,
      month,
      year,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   GET LEADERBOARD SUMMARY
   GET /api/leaderboard/summary?month=1&year=2026
============================== */
export const getLeaderboardSummaryController = async (
  req: Request,
  res: Response
) => {
  try {
    // Get month and year from query params, default to current month/year
    const currentDate = new Date();
    const month = req.query.month
      ? parseInt(req.query.month as string)
      : currentDate.getMonth() + 1;
    const year = req.query.year
      ? parseInt(req.query.year as string)
      : currentDate.getFullYear();

    // Validate month and year
    if (isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Must be between 1 and 12",
      });
    }

    if (isNaN(year) || year < 2000 || year > 3000) {
      return res.status(400).json({
        success: false,
        message: "Invalid year",
      });
    }

    const cacheKey = `leaderboard:summary:${month}:${year}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        month,
        year,
        cached: true,
      });
    }

    const summary = await getLeaderboardSummary(month, year);
    await redisSetJson(cacheKey, summary, LEADERBOARD_CACHE_TTL_SECONDS);

    res.status(200).json({
      success: true,
      data: summary,
      month,
      year,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   SET TARGET FOR COUNSELLOR
   POST /api/leaderboard/target
   Body: { counsellorId, target, month, year }
============================== */
export const setTargetController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { counsellorId, target, month, year } = req.body;

    // Validate required fields
    if (!counsellorId || target === undefined || !month || !year) {
      return res.status(400).json({
        success: false,
        message: "counsellorId, target, month, and year are required",
      });
    }

    // Validate target
    if (typeof target !== "number" || target < 0) {
      return res.status(400).json({
        success: false,
        message: "Target must be a non-negative number",
      });
    }

    // Validate month and year
    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Must be between 1 and 12",
      });
    }

    if (year < 2000 || year > 3000) {
      return res.status(400).json({
        success: false,
        message: "Invalid year",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Determine managerId
    let managerId: number;

    if (userRole === "admin") {
      // Admin can set target for any counsellor
      // Get the counsellor's managerId, or use a default manager
      const [counsellor] = await db
        .select({
          managerId: users.managerId,
          role: users.role
        })
        .from(users)
        .where(eq(users.id, counsellorId))
        .limit(1);

      if (!counsellor) {
        return res.status(404).json({
          success: false,
          message: `User with ID ${counsellorId} not found`,
        });
      }

      if (counsellor.role !== "counsellor") {
        return res.status(400).json({
          success: false,
          message: `User with ID ${counsellorId} is not a counsellor (current role: ${counsellor.role})`,
        });
      }

      // If counsellor has no manager, we need to handle this
      // For now, use the admin's ID as managerId (or you can require managerId in request)
      managerId = counsellor.managerId || userId;
    } else if (userRole === "manager") {
      // Manager can only set target for their own counsellors
      managerId = userId;

      // Verify counsellor belongs to this manager
      const [counsellor] = await db
        .select({
          managerId: users.managerId,
          role: users.role
        })
        .from(users)
        .where(eq(users.id, counsellorId))
        .limit(1);

      if (!counsellor) {
        return res.status(404).json({
          success: false,
          message: `User with ID ${counsellorId} not found`,
        });
      }

      if (counsellor.role !== "counsellor") {
        return res.status(400).json({
          success: false,
          message: `User with ID ${counsellorId} is not a counsellor (current role: ${counsellor.role})`,
        });
      }

      if (counsellor.managerId !== managerId) {
        return res.status(403).json({
          success: false,
          message: "You can only set targets for your own counsellors",
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: "Only admin and manager can set targets",
      });
    }

    // Set the target
    const result = await setTarget(counsellorId, managerId, target, month, year);

    try {
      await redisDelByPrefix("leaderboard:");
    } catch {
      // ignore
    }

    // Log activity
    try {
      await logActivity(req, {
        entityType: "leaderboard",
        entityId: result.target.id,
        clientId: null,
        action: result.action === "CREATED" ? "CREATE" : "UPDATE",
        newValue: {
          id: result.target.id,
          counsellorId: counsellorId,
          managerId: managerId,
          target: target,
          month: month,
          year: year,
        },
        description: `Target ${result.action === "CREATED" ? "set" : "updated"} for counsellor: ${target} enrollments for ${month}/${year}`,
        performedBy: userId,
      });
    } catch (activityError) {
      console.error("Activity log error in setTargetController:", activityError);
    }

    // Emit WebSocket event for real-time updates
    try {
      // Fetch fresh leaderboard data (includes summary)
      const leaderboardResult = await getLeaderboard(month, year);

      const eventName = "leaderboard:updated";
      const eventData = {
        action: result.action,
        target: result.target,
        leaderboard: leaderboardResult.leaderboard,
        summary: leaderboardResult.summary,
        month: month,
        year: year,
      };

      // Emit to admin room
      emitToAdmin(eventName, eventData);

      // Emit to manager's room (the manager who owns the counsellor)
      // This ensures manager sees updates even if admin set the target
      if (managerId) {
        emitToCounsellor(managerId, eventName, eventData);
      }

      // Emit to counsellor's room (notify the counsellor whose target was set)
      emitToCounsellor(counsellorId, eventName, eventData);

      // Also emit enrollment goal update for this counselor
      try {
        const enrollmentGoalData = await getMonthlyEnrollmentGoal(counsellorId, month, year);
        emitToCounsellor(counsellorId, "enrollment-goal:updated", {
          month: month,
          year: year,
          data: enrollmentGoalData,
        });
        // Also emit to admin/manager
        emitToAdmin("enrollment-goal:updated", {
          month: month,
          year: year,
          counsellorId: counsellorId,
          data: enrollmentGoalData,
        });
      } catch (goalError) {
        console.error("Enrollment goal update emit error:", goalError);
      }
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error in setTargetController:", wsError);
    }

    res.status(200).json({
      success: true,
      action: result.action,
      data: result.target,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   UPDATE TARGET
   PUT /api/leaderboard/target/:id
   Body: { target }
============================== */
export const updateTargetController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const targetId = parseInt(req.params.id);
    const { target } = req.body;

    if (isNaN(targetId) || targetId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid target ID",
      });
    }

    if (target === undefined || typeof target !== "number" || target < 0) {
      return res.status(400).json({
        success: false,
        message: "Target must be a non-negative number",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Get the target record to check permissions
    const [targetRecord] = await db
      .select()
      .from(leaderBoard)
      .where(eq(leaderBoard.id, targetId))
      .limit(1);

    if (!targetRecord) {
      return res.status(404).json({
        success: false,
        message: "Target not found",
      });
    }

    // Check permissions
    if (userRole === "manager") {
      // Manager can only update targets they created (same managerId)
      if (targetRecord.manager_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only update targets you created",
        });
      }
    } else if (userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin and manager can update targets",
      });
    }

    // Update the target
    const updated = await updateTarget(targetId, target);

    try {
      await redisDelByPrefix("leaderboard:");
    } catch {
      // ignore
    }

    // Log activity
    try {
      await logActivity(req, {
        entityType: "leaderboard",
        entityId: targetId,
        clientId: null,
        action: "UPDATE",
        oldValue: targetRecord,
        newValue: updated,
        description: `Target updated: ${target} enrollments`,
        performedBy: userId,
      });
    } catch (activityError) {
      console.error("Activity log error in updateTargetController:", activityError);
    }

    // Emit WebSocket event for real-time updates
    try {
      // Get month and year from the updated target's createdAt
      const createdAt = updated.createdAt;
      if (createdAt) {
        const month = createdAt.getMonth() + 1;
        const year = createdAt.getFullYear();

        // Fetch fresh leaderboard data (includes summary)
        const leaderboardResult = await getLeaderboard(month, year);

        const eventName = "leaderboard:updated";
        const eventData = {
          action: "UPDATED",
          target: updated,
          leaderboard: leaderboardResult.leaderboard,
          summary: leaderboardResult.summary,
          month: month,
          year: year,
        };

        // Emit to admin room
        emitToAdmin(eventName, eventData);

        // Emit to manager's room (the manager who owns the counsellor)
        // This ensures manager sees updates even if admin updated the target
        if (updated.manager_id) {
          emitToCounsellor(updated.manager_id, eventName, eventData);
        }

        // Emit to counsellor's room (notify the counsellor whose target was updated)
        emitToCounsellor(updated.counsellor_id, eventName, eventData);

        // Also emit enrollment goal update for this counselor
        try {
          const enrollmentGoalData = await getMonthlyEnrollmentGoal(updated.counsellor_id, month, year);
          emitToCounsellor(updated.counsellor_id, "enrollment-goal:updated", {
            month: month,
            year: year,
            data: enrollmentGoalData,
          });
          // Also emit to admin/manager
          emitToAdmin("enrollment-goal:updated", {
            month: month,
            year: year,
            counsellorId: updated.counsellor_id,
            data: enrollmentGoalData,
          });
        } catch (goalError) {
          console.error("Enrollment goal update emit error:", goalError);
        }
      }
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error in updateTargetController:", wsError);
    }

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   GET MONTHLY ENROLLMENT GOAL
   GET /api/leaderboard/enrollment-goal?counsellorId=1&month=1&year=2026
   Access: admin, manager, counsellor
   For counsellors: can only access their own data
   For admin/manager: can access any counsellor's data
============================== */
export const getMonthlyEnrollmentGoalController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // Get counsellorId from query params
    const counsellorIdParam = req.query.counsellorId
      ? parseInt(req.query.counsellorId as string)
      : null;

    // Determine which counsellorId to use
    let counsellorId: number;

    if (userRole === "counsellor") {
      // Counsellors can only view their own data
      counsellorId = userId;
    } else if (userRole === "admin" || userRole === "manager") {
      // Admin and manager can view any counsellor's data
      if (!counsellorIdParam || isNaN(counsellorIdParam) || counsellorIdParam <= 0) {
        return res.status(400).json({
          success: false,
          message: "counsellorId is required for admin/manager",
        });
      }
      counsellorId = counsellorIdParam;
    } else {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get month and year from query params, default to current month/year
    const currentDate = new Date();
    const month = req.query.month
      ? parseInt(req.query.month as string)
      : currentDate.getMonth() + 1;
    const year = req.query.year
      ? parseInt(req.query.year as string)
      : currentDate.getFullYear();

    // Validate month and year
    if (isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month. Must be between 1 and 12",
      });
    }

    if (isNaN(year) || year < 2000 || year > 3000) {
      return res.status(400).json({
        success: false,
        message: "Invalid year",
      });
    }

    const cacheKey = `leaderboard:enrollment:${counsellorId}:${month}:${year}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        cached: true,
      });
    }

    const goalData = await getMonthlyEnrollmentGoal(counsellorId, month, year);
    await redisSetJson(cacheKey, goalData, LEADERBOARD_CACHE_TTL_SECONDS);

    res.status(200).json({
      success: true,
      data: goalData,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
