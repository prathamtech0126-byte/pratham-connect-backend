import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  dismissNotificationController,
  getUnreadCountController,
  listNotificationsController,
  markAllReadController,
  markReadController,
} from "../controllers/notification.controller";

const router = Router();

/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of notifications
 *       401:
 *         description: Unauthorized
 */
router.get("/", requireAuth, listNotificationsController);

/**
 * @openapi
 * /api/notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get count of unread notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 *       401:
 *         description: Unauthorized
 */
router.get("/unread-count", requireAuth, getUnreadCountController);

/**
 * @openapi
 * /api/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All marked as read
 *       401:
 *         description: Unauthorized
 */
router.patch("/read-all", requireAuth, markAllReadController);

/**
 * @openapi
 * /api/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark a notification as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Marked as read
 *       401:
 *         description: Unauthorized
 */
router.patch("/:id/read", requireAuth, markReadController);

/**
 * @openapi
 * /api/notifications/{id}/dismiss:
 *   patch:
 *     tags: [Notifications]
 *     summary: Dismiss a notification
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Dismissed
 *       401:
 *         description: Unauthorized
 */
router.patch("/:id/dismiss", requireAuth, dismissNotificationController);

export default router;
