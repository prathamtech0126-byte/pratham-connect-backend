import { Request, Response } from "express";
import {
  dismissNotification,
  getUnreadNotificationCount,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from "../models/notification.model";
import { toNotificationPayload } from "../services/notification.service";

export const listNotificationsController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const category =
      typeof req.query.category === "string" ? req.query.category : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const unreadOnly = req.query.unreadOnly === "true";

    const result = await listNotificationsForUser({
      userId: req.user.id,
      page,
      limit,
      category,
      type,
      unreadOnly,
    });

    return res.status(200).json({
      success: true,
      data: result.items.map(toNotificationPayload),
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list notifications",
    });
  }
};

export const getUnreadCountController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const category =
      typeof req.query.category === "string" ? req.query.category : undefined;

    const count = await getUnreadNotificationCount(req.user.id, category);

    return res.status(200).json({ success: true, count });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get unread count",
    });
  }
};

export const markReadController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }

    const row = await markNotificationRead(id, req.user.id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({
      success: true,
      data: toNotificationPayload(row),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to mark notification read",
    });
  }
};

export const markAllReadController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const category =
      typeof req.body?.category === "string" ? req.body.category : undefined;

    const updated = await markAllNotificationsRead(req.user.id, category);

    return res.status(200).json({ success: true, updated });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to mark all read",
    });
  }
};

export const dismissNotificationController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }

    const ok = await dismissNotification(id, req.user.id);
    if (!ok) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to dismiss notification",
    });
  }
};
