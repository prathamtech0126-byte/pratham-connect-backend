import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import {
  createBroadcastMessageController,
  getAllMessagesController,
  getInboxMessagesController,
  getUnacknowledgedMessagesController,
  acknowledgeMessageController,
  getAcknowledgmentStatusController,
  deactivateMessageController,
} from "../controllers/message.controller";

const router = Router();

/**
 * POST /api/messages/broadcast
 * Create a broadcast message to all Managers and Counsellors
 * Access: admin only
 */
router.post(
  "/broadcast",
  requireAuth,
  requireRole("admin"),
  createBroadcastMessageController
);

/**
 * GET /api/messages
 * Get all messages (with filters)
 * Query params: active (boolean), page, limit
 * Access: admin only
 * Note: Only broadcast messages are supported
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin"),
  getAllMessagesController
);

/**
 * GET /api/messages/inbox
 * Get user's inbox (all messages - acknowledged and unacknowledged)
 * Access: authenticated users (manager, counsellor)
 */
router.get(
  "/inbox",
  requireAuth,
  getInboxMessagesController
);

/**
 * GET /api/messages/unacknowledged
 * Get user's unacknowledged messages (legacy endpoint)
 * Access: authenticated users (manager, counsellor)
 */
router.get(
  "/unacknowledged",
  requireAuth,
  getUnacknowledgedMessagesController
);

/**
 * POST /api/messages/:messageId/acknowledge
 * Acknowledge a message
 * Body: { method: "button" | "timer" | "auto" }
 * Access: authenticated users (manager, counsellor)
 */
router.post(
  "/:messageId/acknowledge",
  requireAuth,
  acknowledgeMessageController
);

/**
 * GET /api/messages/:messageId/acknowledgments
 * Get acknowledgment status for a message
 * Access: admin only
 */
router.get(
  "/:messageId/acknowledgments",
  requireAuth,
  requireRole("admin"),
  getAcknowledgmentStatusController
);

/**
 * PATCH /api/messages/:messageId/deactivate
 * Deactivate a message
 * Access: admin only
 */
router.patch(
  "/:messageId/deactivate",
  requireAuth,
  requireRole("admin"),
  deactivateMessageController
);

export default router;
