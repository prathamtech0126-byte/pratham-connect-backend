import { Request, Response } from "express";
import {
  createBroadcastMessage,
  getAllMessages,
  getUnacknowledgedMessagesForUser,
  getAllMessagesForUser,
  acknowledgeMessage,
  getMessageAcknowledgmentStatus,
  deactivateMessage,
} from "../models/message.model";
import {
  sendBroadcastMessage,
  emitMessageAcknowledged,
} from "../services/message.service";
import { AuthenticatedRequest } from "../types/express-auth";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { eq } from "drizzle-orm";

/* ================================
   CREATE BROADCAST MESSAGE
================================ */

// Helper function to check if user is admin or superadmin
const isAdminRole = (role: string): boolean => {
  return role === "admin" || role === "superadmin";
};

export const createBroadcastMessageController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !isAdminRole(authReq.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins can create broadcast messages",
      });
    }

    const body = req.body || {};
    const { title, message, targetRoles, priority } =
      body;

    // Enhanced validation with detailed error messages
    if (!message || (typeof message === "string" && message.trim().length === 0)) {
      console.error("Create broadcast message validation error: Message is missing or empty", {
        body,
        userId: authReq.user?.id,
      });
      return res.status(400).json({
        success: false,
        message: "Message is required and cannot be empty",
      });
    }

    if (!targetRoles || !Array.isArray(targetRoles) || targetRoles.length === 0) {
      console.error("Create broadcast message validation error: Invalid targetRoles", {
        targetRoles,
        type: typeof targetRoles,
        isArray: Array.isArray(targetRoles),
        userId: authReq.user?.id,
      });
      return res.status(400).json({
        success: false,
        message: "Target roles are required and must be a non-empty array",
      });
    }

    // Get sender info
    const [sender] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender not found",
      });
    }

    // Create and send message
    const createdMessage = await sendBroadcastMessage(
      {
        title,
        message,
        targetRoles,
        priority,
      },
      authReq.user.id,
      sender.fullName
    );

    res.status(201).json({
      success: true,
      data: {
        id: createdMessage.id,
        type: "broadcast",
        title: createdMessage.title,
        message: createdMessage.message,
        targetRoles: createdMessage.targetRoles,
        priority: createdMessage.priority,
        createdAt: createdMessage.createdAt.toISOString(),
        sender: {
          id: sender.id,
          name: sender.fullName,
          role: "admin",
        },
      },
    });
  } catch (error: any) {
    console.error("Create broadcast message error:", {
      error: error.message,
      stack: error.stack,
      userId: (req as AuthenticatedRequest).user?.id,
      userRole: (req as AuthenticatedRequest).user?.role,
      body: req.body,
    });
    res.status(400).json({
      success: false,
      message: error.message || "Failed to create broadcast message",
    });
  }
};

/* ================================
   GET ALL MESSAGES (ADMIN)
================================ */

export const getAllMessagesController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !isAdminRole(authReq.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins can view all messages",
      });
    }

    const active = req.query.active
      ? req.query.active === "true"
      : undefined;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    // Only broadcast messages are supported
    const result = await getAllMessages({
      type: "broadcast",
      active,
      page,
      limit,
    });

    // Get acknowledgment status for each message
    const messagesWithStatus = await Promise.all(
      result.messages.map(async (msg) => {
        try {
          const status = await getMessageAcknowledgmentStatus(msg.id);
          return {
            ...msg,
            acknowledgmentStatus: {
              total: status.totalRecipients,
              totalRecipients: status.totalRecipients, // Alias for consistency
              acknowledged: status.acknowledged, // Keep for backward compatibility
              pending: status.pending, // Keep for backward compatibility
              acknowledgedCount: status.acknowledged, // Frontend expects this
              pendingCount: status.pending, // Frontend expects this
            },
          };
        } catch (error) {
          return {
            ...msg,
            acknowledgmentStatus: {
              total: 0,
              totalRecipients: 0,
              acknowledged: 0,
              pending: 0,
              acknowledgedCount: 0,
              pendingCount: 0,
            },
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      data: {
        messages: messagesWithStatus.map((msg) => ({
          id: msg.id,
          type: msg.messageType,
          title: msg.title,
          message: msg.message,
          targetRoles: msg.targetRoles,
          targetUserIds: msg.targetUserIds,
          priority: msg.priority,
          isActive: msg.isActive,
          createdAt: msg.createdAt.toISOString(),
          updatedAt: msg.updatedAt.toISOString(),
          acknowledgmentStatus: msg.acknowledgmentStatus,
        })),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      },
    });
  } catch (error: any) {
    console.error("Get all messages error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch messages",
    });
  }
};

/* ================================
   GET INBOX MESSAGES (USER) - ALL MESSAGES
================================ */

export const getInboxMessagesController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userRole = authReq.user.role;
    if (userRole !== "manager" && userRole !== "counsellor") {
      return res.status(403).json({
        success: false,
        message: "Only managers and counsellors can receive messages",
      });
    }

    // Get all messages (acknowledged + unacknowledged)
    const inboxMessages = await getAllMessagesForUser(
      authReq.user.id,
      userRole
    );

    // Get sender info for each message
    const messagesWithSenders = await Promise.all(
      inboxMessages.map(async (msg) => {
        const [sender] = await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, msg.senderId))
          .limit(1);

        return {
          id: msg.id,
          type: msg.messageType,
          title: msg.title,
          message: msg.message,
          priority: msg.priority,
          createdAt: msg.createdAt.toISOString(),
          isAcknowledged: msg.isAcknowledged,
          acknowledgedAt: msg.acknowledgedAt?.toISOString() || null,
          sender: {
            id: sender?.id || msg.senderId,
            name: sender?.fullName || "Unknown",
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: messagesWithSenders,
    });
  } catch (error: any) {
    console.error("Get inbox messages error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inbox messages",
    });
  }
};

/* ================================
   GET UNACKNOWLEDGED MESSAGES (USER) - LEGACY
================================ */

export const getUnacknowledgedMessagesController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userRole = authReq.user.role;
    if (userRole !== "manager" && userRole !== "counsellor") {
      return res.status(403).json({
        success: false,
        message: "Only managers and counsellors can receive messages",
      });
    }

    const unacknowledgedMessages = await getUnacknowledgedMessagesForUser(
      authReq.user.id,
      userRole
    );

    // Get sender info for each message
    const messagesWithSenders = await Promise.all(
      unacknowledgedMessages.map(async (msg) => {
        const [sender] = await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, msg.senderId))
          .limit(1);

        return {
          id: msg.id,
          type: msg.messageType,
          title: msg.title,
          message: msg.message,
          priority: msg.priority,
          createdAt: msg.createdAt.toISOString(),
          sender: {
            id: sender?.id || msg.senderId,
            name: sender?.fullName || "Unknown",
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: messagesWithSenders,
    });
  } catch (error: any) {
    console.error("Get unacknowledged messages error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch unacknowledged messages",
    });
  }
};

/* ================================
   ACKNOWLEDGE MESSAGE
================================ */

export const acknowledgeMessageController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    // Method parameter is no longer used/returned, but kept for backward compatibility
    const body = req.body || {};
    const method = body.method || "button"; // Default value, but not validated or returned

    // Acknowledge message (method is stored but not returned)
    const acknowledgment = await acknowledgeMessage(
      messageId,
      authReq.user.id,
      method as "button" | "timer" | "auto"
    );

    // Emit WebSocket confirmation
    try {
      emitMessageAcknowledged(
        messageId,
        authReq.user.id,
        acknowledgment.acknowledgedAt
      );
    } catch (wsError) {
      console.error("WebSocket emit error in acknowledgeMessageController:", wsError);
      // Don't fail the request if WebSocket fails
    }

    res.status(200).json({
      success: true,
      data: {
        messageId: acknowledgment.messageId,
        userId: acknowledgment.userId,
        acknowledgedAt: acknowledgment.acknowledgedAt.toISOString(),
        // method removed - not returned to frontend
      },
    });
  } catch (error: any) {
    console.error("Acknowledge message error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to acknowledge message",
    });
  }
};

/* ================================
   GET ACKNOWLEDGMENT STATUS (ADMIN)
================================ */

export const getAcknowledgmentStatusController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !isAdminRole(authReq.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins can view acknowledgment status",
      });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const status = await getMessageAcknowledgmentStatus(messageId);

    // Calculate counts explicitly
    const acknowledgedCount = status.acknowledged;
    const pendingCount = status.pending;

    res.status(200).json({
      success: true,
      data: {
        messageId: status.messageId,
        messageType: status.messageType,
        totalRecipients: status.totalRecipients,
        acknowledged: status.acknowledged, // Keep for backward compatibility
        pending: status.pending, // Keep for backward compatibility
        acknowledgedCount, // Frontend expects this
        pendingCount, // Frontend expects this
        acknowledgments: status.acknowledgments.map((ack) => ({
          userId: ack.userId,
          userName: ack.userName,
          userRole: ack.userRole,
          acknowledgedAt: ack.acknowledgedAt.toISOString(),
          // method removed - not returned to frontend
        })),
        pendingUsers: status.pendingUsers,
      },
    });
  } catch (error: any) {
    console.error("Get acknowledgment status error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch acknowledgment status",
    });
  }
};

/* ================================
   DEACTIVATE MESSAGE (ADMIN)
================================ */

export const deactivateMessageController = async (
  req: Request,
  res: Response
) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !isAdminRole(authReq.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only admins can deactivate messages",
      });
    }

    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const deactivatedMessage = await deactivateMessage(messageId);

    res.status(200).json({
      success: true,
      data: {
        id: deactivatedMessage.id,
        isActive: deactivatedMessage.isActive,
        updatedAt: deactivatedMessage.updatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Deactivate message error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to deactivate message",
    });
  }
};
