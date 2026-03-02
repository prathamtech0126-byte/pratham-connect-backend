import { Request, Response } from "express";
import {
  getLeaderboard,
  getLeaderboardSummary,
  setTarget,
  updateTarget,
  deleteTarget,
  getMonthlyEnrollmentGoal,
  getCounsellorListForTargets,
} from "../models/leaderboard.model";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { emitToAdmin, emitToCounsellor, emitToCounsellors } from "../config/socket";
import { redisGetJson, redisSetJson, redisDelByPrefix } from "../config/redis";

const LEADERBOARD_CACHE_TTL_SECONDS = 60;


/** Apply scope to full leaderboard: admin/supervisor = all; non-supervisor manager = own team; counsellor = own row. */
function applyLeaderboardScope(
  leaderboard: Array<{ counsellorId: number; managerId: number | null; [k: string]: unknown }>,
  userId: number,
  userRole: string,
  isSupervisor: boolean
): typeof leaderboard {
  if (userRole === "admin") return leaderboard;
  if (userRole === "counsellor") return leaderboard.filter((s) => s.counsellorId === userId);
  if (userRole === "manager") {
    if (isSupervisor) return leaderboard;
    const team = leaderboard.filter((s) => s.managerId === userId);
    return team.map((s, i) => ({ ...s, rank: i + 1 }));
  }
  return leaderboard;
}

/** Recompute summary from scoped leaderboard data. */
function summaryFromData(
  data: Array<{ revenue: number; enrollments: number }>
): { totalCounsellors: number; totalEnrollments: number; totalRevenue: number } {
  return {
    totalCounsellors: data.length,
    totalEnrollments: data.reduce((s, r) => s + r.enrollments, 0),
    totalRevenue: parseFloat(data.reduce((s, r) => s + r.revenue, 0).toFixed(2)),
  };
}

/* ==============================
   GET LEADERBOARD
   GET /api/leaderboard?month=1&year=2026
   Admin: all counsellors. Manager (supervisor): all. Manager (not supervisor): own team. Counsellor: own row.
============================== */
export const getLeaderboardController = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = req.user?.id as number | undefined;
    const userRole = req.user?.role as string | undefined;

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
    let fullResult: { leaderboard: any[]; summary: any };
    if (cached) {
      const leaderboard = Array.isArray(cached) ? cached : cached.leaderboard;
      const summary = Array.isArray(cached) ? undefined : cached.summary;
      fullResult = { leaderboard, summary: summary ?? summaryFromData(leaderboard) };
    } else {
      fullResult = await getLeaderboard(month, year);
      await redisSetJson(cacheKey, fullResult, LEADERBOARD_CACHE_TTL_SECONDS);
    }

    let data = fullResult.leaderboard;
    let summary = fullResult.summary;

    if (userId != null && userRole) {
      let isSupervisor = false;
      if (userRole === "manager") {
        const [manager] = await db
          .select({ isSupervisor: users.isSupervisor })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        isSupervisor = manager?.isSupervisor ?? false;
      }
      data = applyLeaderboardScope(fullResult.leaderboard, userId, userRole, isSupervisor);
      summary = summaryFromData(data);
    }

    res.status(200).json({
      success: true,
      data,
      summary,
      month,
      year,
      cached: !!cached,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   GET COUNSELLORS FOR TARGET DROPDOWN
   GET /api/leaderboard/counsellors
   Returns [{ id, name }]. Admin: all; Manager (supervisor): all; Manager (not supervisor): own team; Counsellor: [].
============================== */
export const getLeaderboardCounsellorsController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const userId = req.user.id as number;
    const userRole = req.user.role as "admin" | "manager";
    if (!["admin", "manager"].includes(userRole)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const counsellors = await getCounsellorListForTargets(userId, userRole);
    return res.status(200).json({ success: true, data: counsellors });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message ?? "Failed to load counsellor list",
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

    // Emit WebSocket event: only the affected counsellor's leaderboard row (so frontend can patch that row)
    try {
      const leaderboardResult = await getLeaderboard(month, year);
      const counsellorRow = leaderboardResult.leaderboard.find(
        (row: { counsellorId: number }) => row.counsellorId === counsellorId
      );

      const eventName = "leaderboard:updated";
      const eventData = {
        action: result.action,
        target: result.target,
        counsellorRow: counsellorRow ?? null,
        month,
        year,
      };

      emitToAdmin(eventName, eventData);
      if (managerId) {
        emitToCounsellor(managerId, eventName, eventData);
      }
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

    // Emit WebSocket event: only the affected counsellor's leaderboard row
    try {
      const createdAt = updated.createdAt;
      if (createdAt) {
        const month = createdAt.getMonth() + 1;
        const year = createdAt.getFullYear();
        const leaderboardResult = await getLeaderboard(month, year);
        const counsellorRow = leaderboardResult.leaderboard.find(
          (row: { counsellorId: number }) => row.counsellorId === updated.counsellor_id
        );

        const eventName = "leaderboard:updated";
        const eventData = {
          action: "UPDATED",
          target: updated,
          counsellorRow: counsellorRow ?? null,
          month,
          year,
        };

        emitToAdmin(eventName, eventData);
        if (updated.manager_id) {
          emitToCounsellor(updated.manager_id, eventName, eventData);
        }
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
   DELETE TARGET
   DELETE /api/leaderboard/target/:id
   Emits only the affected counsellor's leaderboard row (with target 0).
============================== */
export const deleteTargetController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId) || targetId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid target ID",
      });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

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

    if (userRole === "admin") {
      // admin can delete any target
    } else if (userRole === "manager") {
      const [manager] = await db
        .select({ isSupervisor: users.isSupervisor })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const isSupervisor = manager?.isSupervisor ?? false;
      if (!isSupervisor && targetRecord.manager_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only delete targets for your own counsellors",
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: "Only admin and manager can delete targets",
      });
    }

    const deleted = await deleteTarget(targetId);

    try {
      await redisDelByPrefix("leaderboard:");
    } catch {
      // ignore
    }

    try {
      await logActivity(req, {
        entityType: "leaderboard",
        entityId: targetId,
        clientId: null,
        action: "DELETE",
        oldValue: deleted,
        newValue: null,
        description: "Target deleted",
        performedBy: userId,
      });
    } catch (activityError) {
      console.error("Activity log error in deleteTargetController:", activityError);
    }

    const createdAt = deleted.createdAt;
    if (createdAt) {
      const month = createdAt.getMonth() + 1;
      const year = createdAt.getFullYear();
      try {
        const leaderboardResult = await getLeaderboard(month, year);
        const counsellorRow = leaderboardResult.leaderboard.find(
          (row: { counsellorId: number }) => row.counsellorId === deleted.counsellor_id
        );
        const eventName = "leaderboard:updated";
        const eventData = {
          action: "DELETED",
          target: null,
          counsellorRow: counsellorRow ?? null,
          month,
          year,
        };
        emitToAdmin(eventName, eventData);
        if (deleted.manager_id) {
          emitToCounsellor(deleted.manager_id, eventName, eventData);
        }
        emitToCounsellor(deleted.counsellor_id, eventName, eventData);
        try {
          const enrollmentGoalData = await getMonthlyEnrollmentGoal(deleted.counsellor_id, month, year);
          emitToCounsellor(deleted.counsellor_id, "enrollment-goal:updated", {
            month,
            year,
            data: enrollmentGoalData,
          });
          emitToAdmin("enrollment-goal:updated", {
            month,
            year,
            counsellorId: deleted.counsellor_id,
            data: enrollmentGoalData,
          });
        } catch (goalError) {
          console.error("Enrollment goal update emit error:", goalError);
        }
      } catch (wsError) {
        console.error("WebSocket emit error in deleteTargetController:", wsError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Target deleted",
      data: { id: targetId, counsellor_id: deleted.counsellor_id },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error?.message ?? "Failed to delete target",
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
