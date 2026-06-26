import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getDashboardStatsController } from "../controllers/dashboard.controller";

const router = Router();

/**
 * @openapi
 * /api/dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard statistics (role-scoped)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: today
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for beforeDate
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for afterDate
 *     responses:
 *       200:
 *         description: Dashboard stats (shape varies by role)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/counsellor/telecaller/developer only
 */
router.get(
  "/stats",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor", "telecaller"),
  getDashboardStatsController
);

export default router;
