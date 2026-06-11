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
 * @openapi
 * /api/messages:
 *   get:
 *     tags: [Messages]
 *     summary: Get all broadcast messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of messages
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/messages/broadcast:
 *   post:
 *     tags: [Messages]
 *     summary: Create a broadcast message to all managers and counsellors
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Message created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/messages/inbox:
 *   get:
 *     tags: [Messages]
 *     summary: Get current user's inbox (all messages)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inbox messages
 *       401:
 *         description: Unauthorized
 * /api/messages/unacknowledged:
 *   get:
 *     tags: [Messages]
 *     summary: Get current user's unacknowledged messages
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unacknowledged messages
 *       401:
 *         description: Unauthorized
 * /api/messages/{messageId}/acknowledge:
 *   post:
 *     tags: [Messages]
 *     summary: Acknowledge a message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Acknowledged
 *       401:
 *         description: Unauthorized
 * /api/messages/{messageId}/acknowledgments:
 *   get:
 *     tags: [Messages]
 *     summary: Get acknowledgment status for a message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Acknowledgment status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/messages/{messageId}/deactivate:
 *   patch:
 *     tags: [Messages]
 *     summary: Deactivate a broadcast message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deactivated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 */
router.post(
  "/broadcast",
  requireAuth,
  requireRole("developer","admin"),
  createBroadcastMessageController
);
router.get(
  "/",
  requireAuth,
  requireRole("developer","admin"),
  getAllMessagesController
);
router.get(
  "/inbox",
  requireAuth,
  getInboxMessagesController
);
router.get(
  "/unacknowledged",
  requireAuth,
  getUnacknowledgedMessagesController
);
router.post(
  "/:messageId/acknowledge",
  requireAuth,
  acknowledgeMessageController
);
router.get(
  "/:messageId/acknowledgments",
  requireAuth,
  requireRole("developer","admin"),
  getAcknowledgmentStatusController
);
router.patch(
  "/:messageId/deactivate",
  requireAuth,
  requireRole("developer","admin"),
  deactivateMessageController
);

export default router;
