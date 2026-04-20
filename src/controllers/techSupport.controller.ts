import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { AuthenticatedRequest } from "../types/express-auth";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import {
  addTicketEvent,
  claimTicket,
  createTechSupportRequest,
  createTechSupportTicket,
  getAllTechSupportRequests,
  getBoardTickets,
  getTechSupportRequestById,
  getMyTechSupportRequests,
  getMyTechSupportTickets,
  getTicketById,
  getTicketDetailsWithTimeline,
  updateTechSupportRequestReview,
  updateTicketStatus,
} from "../models/techSupport.model";
import { getTechAgentPerformance, getTechSupportOverviewMetrics, emitTechSupportEvent } from "../services/techSupport.service";
import { redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";
import { emitToCounsellor } from "../config/socket";

const isAdminLike = (role: string) => role === "admin" || role === "superadmin" || role === "manager";
const isTechRole = (role: string) => role === "tech_support";
const BOARD_CACHE_KEY = "techsupport:board:v1";
const REQUESTS_ALL_CACHE_KEY = "techsupport:requests:all:v1";
const CACHE_TTL_SECONDS = 5;

const invalidateTechSupportCaches = async () => {
  await Promise.all([
    redisDelByPrefix("techsupport:board:"),
    redisDelByPrefix("techsupport:requests:all:"),
    redisDelByPrefix("techsupport:my:tickets:"),
    redisDelByPrefix("techsupport:my:requests:"),
    redisDelByPrefix("techsupport:analytics:"),
  ]);
};

export const createTechSupportTicketController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const [me] = await db
      .select({ id: users.id, fullName: users.fullName, role: users.role })
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!me) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const body = req.body || {};
    const payload = {
      deviceType: body.deviceType,
      issueCategory: String(body.issueCategory || "").trim(),
      customDeviceType: body.customDeviceType,
      description: String(body.description || "").trim(),
      priority: body.priority || "medium",
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
    };

    if (!payload.description || payload.description.length < 10) {
      return res.status(400).json({ success: false, message: "Description must be at least 10 characters" });
    }
    if (!payload.deviceType) {
      return res.status(400).json({ success: false, message: "Device type is required" });
    }
    if (!payload.issueCategory || payload.issueCategory.length < 2) {
      return res.status(400).json({ success: false, message: "Issue category is required" });
    }

    const ticket = await createTechSupportTicket(payload as any, {
      id: me.id,
      fullName: me.fullName,
      role: me.role,
    });

    await invalidateTechSupportCaches();
    emitTechSupportEvent("techSupport:ticketCreated", { ticketId: ticket.id, status: ticket.status });
    emitToCounsellor(ticket.counsellorId, "techSupport:ticketCreated", {
      ticketId: ticket.id,
      counsellorId: ticket.counsellorId,
      status: ticket.status,
    });
    return res.status(201).json({ success: true, data: ticket });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to create ticket" });
  }
};

export const createTechSupportRequestController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const [me] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);
    if (!me) return res.status(404).json({ success: false, message: "User not found" });

    const body = req.body || {};
    const requestType = String(body.requestType || "");
    if (!["device_request", "recharge_sim_request"].includes(requestType)) {
      return res.status(400).json({ success: false, message: "Invalid request type" });
    }

    if (!body.priority) {
      return res.status(400).json({ success: false, message: "Priority is required" });
    }

    if (requestType === "device_request") {
      if (!body.reason || String(body.reason).trim().length < 5) {
        return res.status(400).json({ success: false, message: "Reason is required for device request" });
      }
      if (!body.deviceType) {
        return res.status(400).json({ success: false, message: "Device type is required for device request" });
      }
    }

    if (requestType === "recharge_sim_request") {
      if (!body.phoneNumber || !String(body.phoneNumber).trim()) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
      }
      if (!body.rechargeRequestType) {
        return res.status(400).json({ success: false, message: "Request type is required" });
      }
      if (!body.currentRechargeExpiryDate || !String(body.currentRechargeExpiryDate).trim()) {
        return res.status(400).json({ success: false, message: "Current recharge expiry date is required" });
      }
    }

    const normalizedReason = body.reason ? String(body.reason).trim() : "";
    const derivedReason =
      requestType === "recharge_sim_request"
        ? normalizedReason || `Current recharge expiry date: ${String(body.currentRechargeExpiryDate).trim()}`
        : normalizedReason;

    const row = await createTechSupportRequest(
      {
        requestType: requestType as any,
        deviceType: body.deviceType,
        deviceRequestType: body.deviceRequestType,
        phoneNumber: body.phoneNumber,
        rechargeRequestType: body.rechargeRequestType,
        currentRechargeExpiryDate: body.currentRechargeExpiryDate,
        amountOrPlan: body.amountOrPlan,
        reason: derivedReason,
        priority: body.priority,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
      },
      { id: me.id, fullName: me.fullName },
    );

    await invalidateTechSupportCaches();
    emitTechSupportEvent("techSupport:requestCreated", { requestId: row.id, status: row.status });
    emitToCounsellor(row.requesterId, "techSupport:requestCreated", {
      requestId: row.id,
      requesterId: row.requesterId,
      status: row.status,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to create request" });
  }
};

export const getMyTechSupportTicketsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    const tickets = await getMyTechSupportTickets(authReq.user.id);
    return res.json({ success: true, data: tickets });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch tickets" });
  }
};

export const getTechSupportBoardController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!isTechRole(authReq.user.role) && !isAdminLike(authReq.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const cached = await redisGetJson<any>(BOARD_CACHE_KEY);
    if (cached) return res.json({ success: true, data: cached });
    const tickets = await getBoardTickets();
    const grouped = {
      pending: tickets.filter((t) => t.status === "pending"),
      in_progress: tickets.filter((t) => t.status === "in_progress" || t.status === "waiting_for_approval"),
      resolved: tickets.filter((t) => t.status === "resolved"),
    };
    await redisSetJson(BOARD_CACHE_KEY, grouped, CACHE_TTL_SECONDS);
    return res.json({ success: true, data: grouped });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch board" });
  }
};

export const getMyTechSupportRequestsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    const rows = await getMyTechSupportRequests(authReq.user.id);
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch requests" });
  }
};

export const getAllTechSupportRequestsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!isTechRole(authReq.user.role) && !isAdminLike(authReq.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const cached = await redisGetJson<any[]>(REQUESTS_ALL_CACHE_KEY);
    if (cached) return res.json({ success: true, data: cached });
    const rows = await getAllTechSupportRequests();
    await redisSetJson(REQUESTS_ALL_CACHE_KEY, rows, CACHE_TTL_SECONDS);
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch requests" });
  }
};

export const reviewTechSupportRequestController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const requestId = Number(req.params.id);
    const status = String(req.body?.status || "");
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid request id" });
    }
    if (!["pending", "approved", "rejected", "in_progress", "waiting_for_approval", "completed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }
    if (authReq.user.role === "tech_support" && status === "completed") {
      return res.status(403).json({
        success: false,
        message: "Tech support cannot complete request directly. Wait for counsellor approval.",
      });
    }

    const existing = await getTechSupportRequestById(requestId);
    if (!existing) return res.status(404).json({ success: false, message: "Request not found" });
    if (status === "completed" && existing.status !== "waiting_for_approval") {
      return res.status(400).json({
        success: false,
        message: "Request can be completed only after pending approval.",
      });
    }

    const row = await updateTechSupportRequestReview(requestId, {
      status: status as any,
      reviewComment: req.body?.reviewComment ? String(req.body.reviewComment) : undefined,
      expectedCompletionAt: req.body?.expectedCompletionAt ? new Date(req.body.expectedCompletionAt) : null,
      reviewedByUserId: authReq.user.id,
    });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });

    await invalidateTechSupportCaches();
    const message =
      status === "waiting_for_approval"
        ? "Approval request sent to counsellor."
        : "Request status updated successfully.";
    return res.json({ success: true, message, data: row });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to update request" });
  }
};

export const claimTechSupportTicketController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!isTechRole(authReq.user.role) && !isAdminLike(authReq.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const ticketId = Number(req.params.id);
    if (!Number.isFinite(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }

    const result = await claimTicket(ticketId, authReq.user.id, authReq.user.id);
    if (!result) return res.status(404).json({ success: false, message: "Ticket not found" });

    await addTicketEvent({
      ticketId,
      actorId: authReq.user.id,
      actorRole: authReq.user.role,
      eventType: "claimed",
      fromStatus: result.existing.status as any,
      toStatus: result.updated.status as any,
      meta: { assignedToUserId: authReq.user.id },
    });

    await invalidateTechSupportCaches();
    return res.json({ success: true, data: result.updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to claim ticket" });
  }
};

export const updateTechSupportTicketStatusController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!isTechRole(authReq.user.role) && !isAdminLike(authReq.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const ticketId = Number(req.params.id);
    const status = String(req.body?.status || "");
    if (!Number.isFinite(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }
    if (!["pending", "in_progress", "waiting_for_approval", "resolved"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }
    if (authReq.user.role === "tech_support" && status === "resolved") {
      return res.status(403).json({
        success: false,
        message: "Tech support cannot mark ticket as resolved directly. Wait for counsellor approval.",
      });
    }

    const result = await updateTicketStatus(ticketId, status as any);
    if (!result) return res.status(404).json({ success: false, message: "Ticket not found" });

    await addTicketEvent({
      ticketId,
      actorId: authReq.user.id,
      actorRole: authReq.user.role,
      eventType: "status_changed",
      fromStatus: result.existing.status as any,
      toStatus: result.updated.status as any,
      note: req.body?.note ? String(req.body.note) : undefined,
    });

    await invalidateTechSupportCaches();
    const message =
      status === "waiting_for_approval"
        ? "Approval request sent to counsellor."
        : "Ticket status updated successfully.";
    return res.json({ success: true, message, data: result.updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to update ticket" });
  }
};

export const getTechSupportTicketDetailsController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    const ticketId = Number(req.params.id);
    if (!Number.isFinite(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid ticket id" });
    }

    const ticket = await getTicketById(ticketId);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    if (authReq.user.role === "counsellor" && ticket.counsellorId !== authReq.user.id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const details = await getTicketDetailsWithTimeline(ticketId);
    return res.json({ success: true, data: details });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch details" });
  }
};

export const approveTechSupportResolutionController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const id = Number(req.params.id);
    const type = req.body.type as "ticket" | "request";

    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid id" });

    if (type === "ticket") {
      const ticket = await getTicketById(id);
      if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });
      if (ticket.counsellorId !== authReq.user.id && !isAdminLike(authReq.user.role)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      if (ticket.status !== "waiting_for_approval") {
        return res.status(400).json({ success: false, message: "Ticket is not waiting for approval" });
      }
      const result = await updateTicketStatus(id, "resolved");
      if (result) {
        await addTicketEvent({
          ticketId: id,
          actorId: authReq.user.id,
          actorRole: authReq.user.role,
          eventType: "approved_resolution",
          fromStatus: "waiting_for_approval",
          toStatus: "resolved",
        });
        await invalidateTechSupportCaches();
      }
      return res.json({ success: true, data: result?.updated });
    } else if (type === "request") {
      const result = await updateTechSupportRequestReview(id, {
        status: "completed",
        reviewedByUserId: authReq.user.id,
      });
      await invalidateTechSupportCaches();
      return res.json({ success: true, data: result });
    } else {
      return res.status(400).json({ success: false, message: "Invalid type" });
    }
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to approve" });
  }
};

export const getTechSupportAnalyticsOverviewController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });
    if (!isAdminLike(authReq.user.role)) {
      return res.status(403).json({ success: false, message: "Only admin/manager can access analytics" });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const cacheKey = `techsupport:analytics:overview:v2:${startDate || "all"}:${endDate || "all"}`;
    const cachedData = await redisGetJson<any>(cacheKey);
    if (cachedData) {
      return res.json({ success: true, data: cachedData });
    }

    const [overview, agents, boardTickets, allRequests] = await Promise.all([
      getTechSupportOverviewMetrics(startDate, endDate),
      getTechAgentPerformance(startDate, endDate),
      getBoardTickets(startDate, endDate),
      getAllTechSupportRequests(startDate, endDate),
    ]);

    // Normalize and group board data for a lightweight admin view (including requests)
    const normalizedTickets = (boardTickets || []).map((t: any) => ({
      ...t,
      uid: `ticket-${t.id}`,
      source: "ticket",
    }));

    const normalizedRequests = (allRequests || []).map((r: any) => {
      let columnStatus = "pending";
      if (r.status === "in_progress" || r.status === "waiting_for_approval" || r.status === "approved") {
        columnStatus = "in_progress";
      } else if (r.status === "completed" || r.status === "resolved") {
        columnStatus = "resolved";
      }

      return {
        ...r,
        uid: `request-${r.id}`,
        source: "request",
        columnStatus,
      };
    });

    const board = {
      pending: [
        ...normalizedTickets.filter((t: any) => t.status === "pending"),
        ...normalizedRequests.filter((r: any) => r.columnStatus === "pending"),
      ],
      in_progress: [
        ...normalizedTickets.filter((t: any) => t.status === "in_progress" || t.status === "waiting_for_approval"),
        ...normalizedRequests.filter((r: any) => r.columnStatus === "in_progress"),
      ],
      resolved: [
        ...normalizedTickets.filter((t: any) => t.status === "resolved" || t.status === "completed"),
        ...normalizedRequests.filter((r: any) => r.columnStatus === "resolved"),
      ],
    };

    const responseData = { overview, agents, board };
    await redisSetJson(cacheKey, responseData, 10); // Cache for 10 seconds for more dynamic feel

    return res.json({ success: true, data: responseData });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch analytics" });
  }
};

