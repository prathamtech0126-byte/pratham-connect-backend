import { Request, Response } from "express";
import { saveClient, getClientFullDetailsById, getClientsByCounsellor, getAllCounsellorIds, getAllClientsForAdmin, getAllClientsForManager, getArchivedClientsByCounsellor, getAllArchivedClientsForAdmin, getAllArchivedClientsForManager, updateClientArchiveStatus, getAllClients, updateClientCounsellor, getClientsByEnrollmentDateRange } from "../models/client.model";
import { getProductPaymentsByClientId } from "../models/clientProductPayments.model";
import { emitToCounsellor, emitToAdmin, emitDashboardUpdate, emitToCounsellors } from "../config/socket";
import { getDashboardStats, getDateRange, type DashboardFilter } from "../models/dashboard.model";
import { getLeaderboard, getMonthlyEnrollmentGoal } from "../models/leaderboard.model";
import { emitManagerTargetUpdateForManager } from "./managerTargets.controller";
import { logActivity } from "../services/activityLog.service";
import { db } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { users } from "../schemas/users.schema";
import { eq, and } from "drizzle-orm";
import { getCounsellorById } from "../models/user.model";
import { redisDel, redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";

const CLIENT_CACHE_TTL_SECONDS = 45;

const clientCacheKeys = {
  listAll: () => `clients:list:all`,
  listManager: (managerId: number) => `clients:list:manager:${managerId}`,
  listCounsellor: (counsellorId: number) => `clients:list:counsellor:${counsellorId}`,
  archivedAll: () => `clients:archived:all`,
  archivedManager: (managerId: number) => `clients:archived:manager:${managerId}`,
  archivedCounsellor: (counsellorId: number) => `clients:archived:counsellor:${counsellorId}`,
  full: (clientId: number) => `clients:full:${clientId}`,
  complete: (clientId: number) => `clients:complete:${clientId}`,
};

const invalidateClientCaches = async (opts: {
  clientId?: number;
  counsellorIds?: number[];
}) => {
  const keys: string[] = [];

  if (opts.clientId) {
    keys.push(clientCacheKeys.full(opts.clientId));
    keys.push(clientCacheKeys.complete(opts.clientId));
  }

  // Always clear global lists; cheap and prevents stale UI.
  keys.push(clientCacheKeys.listAll());
  keys.push(clientCacheKeys.archivedAll());

  // Target counsellor lists when known.
  (opts.counsellorIds || []).forEach((id) => {
    keys.push(clientCacheKeys.listCounsellor(id));
    keys.push(clientCacheKeys.archivedCounsellor(id));
  });

  await redisDel(keys);

  // Manager caches: unknown mapping (many managers). Clear by prefix (small keyspace).
  await redisDelByPrefix("clients:list:manager:");
  await redisDelByPrefix("clients:archived:manager:");

  // Dashboard and leaderboard depend on clients; clear so next load is fresh.
  await redisDelByPrefix("dashboard:");
  await redisDelByPrefix("leaderboard:");
};

/* ==============================
   CREATE CLIENT
============================== */
// export const createClientController = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const client = await createClient(req.body);

//     res.status(201).json({
//       success: true,
//       data: client,
//     });
//   } catch (error: any) {
//     res.status(400).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };
export const saveClientController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Fetch old value if updating
    let oldValue = null;
    if (req.body.clientId) {
      try {
        const [oldClient] = await db
          .select()
          .from(clientInformation)
          .where(eq(clientInformation.clientId, req.body.clientId));
        if (oldClient) {
          oldValue = {
            clientId: oldClient.clientId,
            fullName: oldClient.fullName,
            enrollmentDate: oldClient.enrollmentDate,
            passportDetails: oldClient.passportDetails,
            leadTypeId: oldClient.leadTypeId,
            counsellorId: oldClient.counsellorId,
          };
        }
      } catch (error) {
        // Continue even if fetching old value fails
        console.error("Error fetching old client value:", error);
      }
    }

    console.log("req.body client", req.body);
    const client = await saveClient(req.body, req.user.id);

    // Invalidate client caches so next reads are fresh
    try {
      const counsellorId = Number(client?.client?.counsellorId ?? req.user.id);
      await invalidateClientCaches({
        clientId: Number(client?.client?.clientId),
        counsellorIds: Number.isFinite(counsellorId) ? [counsellorId] : [],
      });
    } catch {
      // ignore cache issues
    }

    // Log activity ONLY when a real insert or real update happens (rowCount > 0 or action is CREATED)
    // Skip logging if action is NO_CHANGE (data was identical, no actual update occurred)
    if (client.action !== "NO_CHANGE") {
      try {
        const action = client.action === "CREATED" ? "CREATE" : "UPDATE";
        await logActivity(req, {
          entityType: "client",
          entityId: client.client.clientId,
          clientId: client.client.clientId,
          action: action,
          oldValue: oldValue,
          newValue: client.client,
          description: client.action === "CREATED"
            ? `Client created: ${client.client.fullName}`
            : `Client updated: ${client.client.fullName}`,
          performedBy: req.user.id,
        });
      } catch (activityError) {
        // Don't fail the request if activity log fails
        console.error("Activity log error in saveClientController:", activityError);
      }
    }

    // Emit WebSocket event for real-time updates
    try {
      const counsellorId = req.user.id;
      const eventName = client.action === "CREATED" ? "client:created" : "client:updated";

      // Get counsellor's client list
      const counsellorClients = await getClientsByCounsellor(counsellorId);

      // Get all clients for admin
      const adminClients = await getAllClientsForAdmin();

      // Prepare event data for counsellor
      const counsellorEventData = {
        action: client.action,
        client: client.client,
        clients: counsellorClients, // Counsellor's list
      };

      // Prepare event data for admin
      const adminEventData = {
        action: client.action,
        client: client.client,
        clients: adminClients, // Full admin list
      };

      // Log the structure being sent (for debugging)
      console.log(`📤 Emitting ${eventName} to counsellor ${counsellorId}:`, {
        action: counsellorEventData.action,
        clientId: counsellorEventData.client?.clientId,
        clientsStructure: {
          type: typeof counsellorEventData.clients,
          isArray: Array.isArray(counsellorEventData.clients),
          keys: typeof counsellorEventData.clients === 'object' ? Object.keys(counsellorEventData.clients) : null,
          sampleYear: typeof counsellorEventData.clients === 'object' && !Array.isArray(counsellorEventData.clients)
            ? Object.keys(counsellorEventData.clients)[0]
            : null,
        },
      });

      // Emit to counsellor's room
      emitToCounsellor(counsellorId, eventName, counsellorEventData);

      // Emit to admin room
      emitToAdmin(eventName, adminEventData);

      // Emit dashboard update for "today" filter
      try {
        const dashboardStats = await getDashboardStats("today");
        emitDashboardUpdate("dashboard:updated", {
          filter: "today",
          data: dashboardStats,
        });
      } catch (dashboardError) {
        console.error("Dashboard update emit error:", dashboardError);
      }

      // Emit leaderboard and enrollment goal updates for current month
      try {
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        // Get updated leaderboard data (includes summary)
        const leaderboardResult = await getLeaderboard(currentMonth, currentYear);

        // Emit leaderboard update to all counselors (for Image 1)
        emitToCounsellors("leaderboard:updated", {
          month: currentMonth,
          year: currentYear,
          leaderboard: leaderboardResult.leaderboard,
          summary: leaderboardResult.summary,
        });

        // Emit enrollment goal update for the counselor who created/updated the client
        const enrollmentGoalData = await getMonthlyEnrollmentGoal(
          counsellorId,
          currentMonth,
          currentYear
        );
        emitToCounsellor(counsellorId, "enrollment-goal:updated", {
          month: currentMonth,
          year: currentYear,
          data: enrollmentGoalData,
        });

        // Also emit to admin and manager rooms for enrollment goal updates
        // Admin and managers can view any counselor's enrollment goal
        emitToAdmin("enrollment-goal:updated", {
          month: currentMonth,
          year: currentYear,
          counsellorId: counsellorId,
          data: enrollmentGoalData,
        });

        // Emit manager target update so manager's achieved (client count / revenue) updates instantly
        const [counsellorUser] = await db
          .select({ managerId: users.managerId })
          .from(users)
          .where(eq(users.id, counsellorId))
          .limit(1);
        if (counsellorUser?.managerId) {
          await emitManagerTargetUpdateForManager(counsellorUser.managerId);
        }
      } catch (leaderboardError) {
        console.error("Leaderboard/enrollment goal update emit error:", leaderboardError);
      }
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error:", wsError);
    }

    res.status(200).json({
      success: true,
      data: client,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getClientFullDetailsController = async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.clientId);

    if (!clientId) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    // Cache: full details by clientId
    const cacheKey = clientCacheKeys.full(clientId);
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const data = await getClientFullDetailsById(clientId);

    if (!data) {
      return res.status(404).json({ message: "Client not found" });
    }

    await redisSetJson(cacheKey, data, CLIENT_CACHE_TTL_SECONDS);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /counsellor-clients: by role return that user's clients. Response includes user: { id, role } so frontend knows whose data it is.
// Admin → all clients; Manager → team clients (or all if supervisor); Counsellor → own clients.
export const getAllClientsController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userRole = req.user.role as string;
    const userId = req.user.id as number;
    const userPayload = { id: userId, role: userRole };

    const allowedRoles = ["admin", "manager", "counsellor"];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Only admin, manager, or counsellor can access this endpoint",
      });
    }

    let clients: unknown;

    if (userRole === "admin") {
      const cacheKey = clientCacheKeys.listAll();
      const cached = await redisGetJson<unknown>(cacheKey);
      if (cached) {
        return res.status(200).json({ success: true, data: cached, user: userPayload, cached: true });
      }
      clients = await getAllClientsForAdmin();
      await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);
      try {
        emitToAdmin("clients:fetched", { clients, timestamp: new Date().toISOString() });
      } catch (wsError) {
        console.error("WebSocket emit error in getAllClientsController (admin):", wsError);
      }
    } else if (userRole === "manager") {
      const [manager] = await db
        .select({ id: users.id, isSupervisor: users.isSupervisor })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!manager) {
        return res.status(404).json({ success: false, message: "Manager not found" });
      }

      if (manager.isSupervisor) {
        const cacheKey = clientCacheKeys.listAll();
        const cached = await redisGetJson<unknown>(cacheKey);
        if (cached) {
          return res.status(200).json({ success: true, data: cached, user: userPayload, cached: true });
        }
        clients = await getAllClientsForAdmin();
        await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);
        try {
          emitToAdmin("clients:fetched", { clients, timestamp: new Date().toISOString() });
        } catch (wsError) {
          console.error("WebSocket emit error in getAllClientsController (supervisor manager):", wsError);
        }
      } else {
        const cacheKey = clientCacheKeys.listManager(userId);
        const cached = await redisGetJson<unknown>(cacheKey);
        if (cached) {
          return res.status(200).json({ success: true, data: cached, user: userPayload, cached: true });
        }
        clients = await getAllClientsForManager(userId);
        await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);
        try {
          emitToCounsellor(userId, "clients:fetched", { counsellorId: userId, clients, timestamp: new Date().toISOString() });
        } catch (wsError) {
          console.error("WebSocket emit error in getAllClientsController (regular manager):", wsError);
        }
      }
    } else {
      const cacheKey = clientCacheKeys.listCounsellor(userId);
      const cached = await redisGetJson<unknown>(cacheKey);
      if (cached) {
        return res.status(200).json({ success: true, data: cached, user: userPayload, cached: true });
      }
      clients = await getClientsByCounsellor(userId);
      await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);
      try {
        emitToCounsellor(userId, "clients:fetched", { counsellorId: userId, clients, timestamp: new Date().toISOString() });
      } catch (wsError) {
        console.error("WebSocket emit error in getAllClientsController (counsellor):", wsError);
      }
    }

    res.status(200).json({
      success: true,
      data: clients,
      user: userPayload,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Filtered clients by date. Accepts id and role (query or body); returns that user's clients.
 * Query/body: id (or userId), role (admin|manager|counsellor). If omitted, uses logged-in user.
 * Admin → all clients in range; Manager → own (team) clients; Counsellor → own clients.
 */
export const getCounsellorClientsWithFilterController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const loggedInId = req.user.id as number;
    const loggedInRole = req.user.role as string;
    const [loggedInUser] = await db
      .select({ isSupervisor: users.isSupervisor })
      .from(users)
      .where(eq(users.id, loggedInId))
      .limit(1);
    const isSupervisorManager = loggedInRole === "manager" && !!loggedInUser?.isSupervisor;

    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const targetIdParam = req.query.userId ?? req.query.id ?? body.userId ?? body.id;
    const targetRoleParam = req.query.role ?? body.role;
    const targetId = targetIdParam != null ? Number(targetIdParam) : NaN;
    const targetRole = typeof targetRoleParam === "string" ? targetRoleParam.trim().toLowerCase() : "";

    const useTarget = Number.isFinite(targetId) && targetId > 0 && ["admin", "manager", "counsellor"].includes(targetRole);
    const idToUse = useTarget ? targetId : loggedInId;
    const roleToUse = useTarget ? targetRole : loggedInRole;

    const filter = (req.query.filter as DashboardFilter) || "monthly";
    const beforeDate = req.query.beforeDate as string | undefined;
    const afterDate = req.query.afterDate as string | undefined;
    const startDateParam = req.query.startDate as string | undefined;
    const endDateParam = req.query.endDate as string | undefined;
    let before = beforeDate;
    let after = afterDate;
    if (filter === "custom") {
      if (startDateParam && endDateParam) {
        before = startDateParam;
        after = endDateParam;
      }
      if (!before || !after) {
        return res.status(400).json({
          success: false,
          message: "Custom filter requires beforeDate & afterDate (or startDate & endDate)",
        });
      }
    }

    let dateRange: { start: Date; end: Date };
    try {
      dateRange = getDateRange(filter, before, after);
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        message: e?.message ?? "Invalid date range",
      });
    }
    const startStr = dateRange.start.toISOString().split("T")[0];
    const endStr = dateRange.end.toISOString().split("T")[0];

    if (useTarget) {
      const [targetUser] = await db
        .select({ id: users.id, role: users.role, managerId: users.managerId, isSupervisor: users.isSupervisor })
        .from(users)
        .where(eq(users.id, idToUse))
        .limit(1);
      const targetRoleLower = (targetUser?.role ?? "").toString().toLowerCase();
      if (!targetUser || targetRoleLower !== roleToUse) {
        return res.status(400).json({
          success: false,
          message: "User not found or role does not match",
        });
      }
      if (loggedInRole === "counsellor" && idToUse !== loggedInId) {
        return res.status(403).json({ success: false, message: "Counsellor can only view own clients" });
      }
      if (loggedInRole === "manager" && !isSupervisorManager && loggedInId !== idToUse) {
        if (roleToUse === "counsellor") {
          if (targetUser.managerId !== loggedInId) {
            return res.status(403).json({ success: false, message: "You can only view your team counsellor's clients" });
          }
        } else if (roleToUse === "admin" || (roleToUse === "manager" && idToUse !== loggedInId)) {
          return res.status(403).json({ success: false, message: "Manager can only view own or team counsellor clients" });
        }
      }
    }

    // Own clients only: clients where counsellor_id = this user (admin/manager/counsellor who added the client)
    const counsellorIds: number[] = [idToUse];

    if (counsellorIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        user: { id: idToUse, role: roleToUse },
        filter,
        filter_start_date: startStr,
        filter_end_date: endStr,
      });
    }

    const clients = await getClientsByEnrollmentDateRange(counsellorIds, startStr, endStr);
    return res.status(200).json({
      success: true,
      data: clients,
      user: { id: idToUse, role: roleToUse },
      filter,
      filter_start_date: startStr,
      filter_end_date: endStr,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message ?? "Failed to fetch clients",
    });
  }
};

// get all clients by counsellor
export const getAllClientsByCounsellorController = async (req: Request, res: Response) => {
  try {
    const counsellorId = Number(req.params.counsellorId);

    if (isNaN(counsellorId) || counsellorId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid counsellor ID",
      });
    }

    const cacheKey = clientCacheKeys.listCounsellor(counsellorId);
    const cached = await redisGetJson<any>(cacheKey);
    const clients = cached ?? (await getClientsByCounsellor(counsellorId));
    if (!cached) {
      await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);
    }

    // Emit WebSocket event to notify all clients in this counsellor's room
    try {
      emitToCounsellor(counsellorId, "clients:fetched", {
        counsellorId,
        clients,
        timestamp: new Date().toISOString(),
      });
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error in getAllClientsByCounsellorController:", wsError);
    }

    res.status(200).json({
      success: true,
      data: clients,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// get all clients by counsellor (admin)
export const getClientsByCounsellorAdminController = async (
  req: Request,
  res: Response
) => {
  const counsellorId = Number(req.params.counsellorId);

  if (Number.isNaN(counsellorId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid counsellorId"
    });
  }

  const clients = await getClientsByCounsellor(counsellorId);

  res.status(200).json({
    success: true,
    data: clients
  });
};

// get client complete details (client info + payments + product payments with entity data)
export const getClientCompleteDetailsController = async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.clientId);

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid clientId is required",
      });
    }

    const cacheKey = clientCacheKeys.complete(clientId);
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    // Get client full details using existing function
    // This already includes productPayments with entity data
    const clientData = await getClientFullDetailsById(clientId);

    if (!clientData) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // productPayments include full entity data; for ALL_FINANCE_EMPLOYEMENT, entity has
    // amount, paymentDate, invoiceNo, partialPayment, approvalStatus, approvedBy, remarks,
    // anotherPaymentAmount, anotherPaymentDate, createdAt, approver (if approved)
    const completeDetails = {
      client: clientData.client,
      leadType: clientData.leadType,
      payments: clientData.payments,
      productPayments: clientData.productPayments,
    };

    await redisSetJson(cacheKey, completeDetails, CLIENT_CACHE_TTL_SECONDS);
    res.status(200).json({
      success: true,
      data: completeDetails,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch client details",
    });
  }
};

/* ==============================
   GET ARCHIVED CLIENTS (same pattern as counsellor-clients/filtered)
   Accept id and role (query or body). Return that user's full archived list (no date filter).
   Counsellor / Manager / Admin each see their own archived clients (counsellor_id = that user).
============================== */
export const getArchivedClientsController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const loggedInId = req.user.id as number;
    const loggedInRole = req.user.role as string;
    const [loggedInUser] = await db
      .select({ isSupervisor: users.isSupervisor })
      .from(users)
      .where(eq(users.id, loggedInId))
      .limit(1);
    const isSupervisorManager = loggedInRole === "manager" && !!loggedInUser?.isSupervisor;

    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const targetIdParam = req.query.userId ?? req.query.id ?? body.userId ?? body.id;
    const targetRoleParam = req.query.role ?? body.role;
    const targetId = targetIdParam != null ? Number(targetIdParam) : NaN;
    const targetRole = typeof targetRoleParam === "string" ? targetRoleParam.trim().toLowerCase() : "";

    const useTarget = Number.isFinite(targetId) && targetId > 0 && ["admin", "manager", "counsellor"].includes(targetRole);
    const idToUse = useTarget ? targetId : loggedInId;
    const roleToUse = useTarget ? targetRole : loggedInRole;

    const allowedRoles = ["admin", "manager", "counsellor"];
    if (!allowedRoles.includes((loggedInRole || "").toString().toLowerCase())) {
      return res.status(403).json({ success: false, message: "Only admin, manager, or counsellor can access archived clients" });
    }

    if (useTarget) {
      const [targetUser] = await db
        .select({ id: users.id, role: users.role, managerId: users.managerId })
        .from(users)
        .where(eq(users.id, idToUse))
        .limit(1);
      const targetRoleLower = (targetUser?.role ?? "").toString().toLowerCase();
      if (!targetUser || targetRoleLower !== roleToUse) {
        return res.status(400).json({ success: false, message: "User not found or role does not match" });
      }
      if (loggedInRole === "counsellor" && idToUse !== loggedInId) {
        return res.status(403).json({ success: false, message: "Counsellor can only view own archived clients" });
      }
      if (loggedInRole === "manager" && !isSupervisorManager && loggedInId !== idToUse) {
        if (roleToUse === "counsellor" && targetUser.managerId !== loggedInId) {
          return res.status(403).json({ success: false, message: "You can only view your team counsellor's archived clients" });
        }
        if (roleToUse === "admin" || (roleToUse === "manager" && idToUse !== loggedInId)) {
          return res.status(403).json({ success: false, message: "Manager can only view own or team counsellor archived clients" });
        }
      }
    }

    const cacheKey = clientCacheKeys.archivedCounsellor(idToUse);
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, user: { id: idToUse, role: roleToUse }, cached: true });
    }
    const clients = await getArchivedClientsByCounsellor(idToUse);
    await redisSetJson(cacheKey, clients, CLIENT_CACHE_TTL_SECONDS);

    try {
      emitToCounsellor(idToUse, "archived-clients:fetched", {
        counsellorId: idToUse,
        clients,
        timestamp: new Date().toISOString(),
      });
    } catch (wsError) {
      console.error("WebSocket emit error in getArchivedClientsController:", wsError);
    }

    return res.status(200).json({
      success: true,
      data: clients,
      user: { id: idToUse, role: roleToUse },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ==============================
   ARCHIVE/UNARCHIVE CLIENT
============================== */
export const archiveClientController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const clientId = Number(req.params.clientId);
    const { archived } = req.body;

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid clientId is required",
      });
    }

    if (typeof archived !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "archived field must be a boolean (true or false)",
      });
    }

    const userRole = req.user.role;
    const userId = req.user.id;

    // Get client to check ownership/permissions
    const [client] = await db
      .select({
        clientId: clientInformation.clientId,
        counsellorId: clientInformation.counsellorId,
        fullName: clientInformation.fullName,
        archived: clientInformation.archived,
      })
      .from(clientInformation)
      .where(eq(clientInformation.clientId, clientId))
      .limit(1);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // Check permissions based on role
    let hasPermission = false;

    if (userRole === "admin") {
      // Admin can archive/unarchive any client
      hasPermission = true;
    } else if (userRole === "manager") {
      // Fetch manager's isSupervisor status
      const [manager] = await db
        .select({
          id: users.id,
          isSupervisor: users.isSupervisor,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!manager) {
        return res.status(404).json({
          success: false,
          message: "Manager not found",
        });
      }

      if (manager.isSupervisor) {
        // Supervisor manager can archive/unarchive any client
        hasPermission = true;
      } else {
        // Regular manager can only archive/unarchive clients from their counsellors
        const [counsellor] = await db
          .select({
            id: users.id,
            managerId: users.managerId,
          })
          .from(users)
          .where(eq(users.id, client.counsellorId))
          .limit(1);

        if (counsellor && counsellor.managerId === userId) {
          hasPermission = true;
        }
      }
    } else if (userRole === "counsellor") {
      // Counsellor can only archive/unarchive their own clients
      if (client.counsellorId === userId) {
        hasPermission = true;
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to archive/unarchive this client",
      });
    }

    // Update archive status
    const result = await updateClientArchiveStatus(clientId, archived);

    // Invalidate caches for this client & counsellor
    try {
      await invalidateClientCaches({
        clientId,
        counsellorIds: Number.isFinite(client.counsellorId) ? [Number(client.counsellorId)] : [],
      });
    } catch {
      // ignore cache issues
    }

    // Log activity
    try {
      await logActivity(req, {
        entityType: "client",
        entityId: clientId,
        clientId: clientId,
        action: archived ? "ARCHIVE" : "UNARCHIVE",
        oldValue: result.oldValue,
        newValue: result.newValue,
        description: archived
          ? `Client archived: ${client.fullName}`
          : `Client unarchived: ${client.fullName}`,
        performedBy: userId,
      });
    } catch (activityError) {
      // Don't fail the request if activity log fails
      console.error("Activity log error in archiveClientController:", activityError);
    }

    // Emit WebSocket events for real-time updates
    try {
      const eventName = archived ? "client:archived" : "client:unarchived";

      // Get updated client lists
      const counsellorClients = await getClientsByCounsellor(client.counsellorId);
      const adminClients = await getAllClientsForAdmin();

      // Prepare event data for counsellor
      const counsellorEventData = {
        action: result.action,
        client: result.client,
        clients: counsellorClients,
      };

      // Prepare event data for admin
      const adminEventData = {
        action: result.action,
        client: result.client,
        clients: adminClients,
      };

      // Emit to counsellor's room
      emitToCounsellor(client.counsellorId, eventName, counsellorEventData);

      // Emit to admin room
      emitToAdmin(eventName, adminEventData);

      // Also emit to archived clients endpoint update
      try {
        const archivedClients = await getAllArchivedClientsForAdmin();
        emitToAdmin("archived-clients:updated", {
          clients: archivedClients,
          timestamp: new Date().toISOString(),
        });
      } catch (archivedError) {
        console.error("Archived clients emit error:", archivedError);
      }
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error:", wsError);
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// All clients for admin (optional query: search = filter by client name)
export const getAllClientsForAdminController = async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || (req.query.name as string) || (req.query.q as string) || "";
    const clients = await getAllClients(search);
    res.status(200).json({
      success: true,
      data: clients,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Client Transfer to another counsellor (single or multiple clients)
export const transferClientController = async (req: Request, res: Response) => {
  try {
    const { clientId, clientIds, counsellorId } = req.body;
    // Support both single clientId and array clientIds (prefer clientIds if both sent)
    const idsToTransfer: number[] = Array.isArray(clientIds) && clientIds.length > 0
      ? clientIds.map((id: any) => (typeof id === "number" ? id : parseInt(String(id), 10))).filter((n: number) => Number.isFinite(n))
      : typeof clientId !== "undefined"
        ? [typeof clientId === "number" ? clientId : parseInt(String(clientId), 10)]
        : [];

    if (idsToTransfer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide clientId (single) or clientIds (array) and counsellorId",
      });
    }

    const targetCounsellorId = typeof counsellorId === "number" ? counsellorId : parseInt(String(counsellorId), 10);
    if (!Number.isFinite(targetCounsellorId)) {
      return res.status(400).json({
        success: false,
        message: "Valid counsellorId is required",
      });
    }

    const counsellor = await getCounsellorById(targetCounsellorId);
    if (!counsellor) {
      return res.status(404).json({
        success: false,
        message: "Counsellor not found",
      });
    }

    const transferred: number[] = [];
    const failed: { clientId: number; reason: string }[] = [];
    const affectedCounsellorIds = new Set<number>([counsellor.id]);

    for (const cid of idsToTransfer) {
      const client = await getClientFullDetailsById(cid);
      if (!client) {
        failed.push({ clientId: cid, reason: "Client not found" });
        continue;
      }
      const oldCounsellorId = Number(client?.client?.counsellorId);
      if (Number.isFinite(oldCounsellorId)) affectedCounsellorIds.add(oldCounsellorId);

      try {
        await updateClientCounsellor(cid, counsellor.id);
        transferred.push(cid);
      } catch (err: any) {
        failed.push({ clientId: cid, reason: err?.message || "Transfer failed" });
      }
    }

    // Invalidate caches for all affected counsellor lists and transferred client details
    try {
      for (const cid of transferred) {
        await invalidateClientCaches({ clientId: cid, counsellorIds: [...affectedCounsellorIds] });
      }
    } catch {
      // ignore cache issues
    }

    res.status(200).json({
      success: true,
      data: {
        transferred,
        failed: failed.length ? failed : undefined,
        transferred_count: transferred.length,
        failed_count: failed.length,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};