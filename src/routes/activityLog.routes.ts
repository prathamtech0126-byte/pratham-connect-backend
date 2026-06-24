import { Router } from "express";
import { getActivityLogsController } from "../controllers/activityLog.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

/**
 * @openapi
 * /api/activity-logs:
 *   get:
 *     tags: [ActivityLogs]
 *     summary: Get activity logs (scope depends on role)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           example: CREATE
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           example: client
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Activity logs
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager", "counsellor", "developer", "telecaller", "marketing_head"),
  getActivityLogsController
);

export default router;
