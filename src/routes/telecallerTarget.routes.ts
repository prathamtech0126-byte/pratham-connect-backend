import { Router } from "express";
import {
  upsertTelecallerTarget,
  getTelecallerTarget,
  getLeaderboardForMonth,
  getTelecallerTargetHistory,
} from "../controllers/telecallerTarget.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * @openapi
 * /api/telecaller-targets:
 *   post:
 *     tags: [TelecallerTargets]
 *     summary: Create or update a telecaller monthly target
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Upserted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/developer/telecaller only
 * /api/telecaller-targets/leaderboard/{monthYear}:
 *   get:
 *     tags: [TelecallerTargets]
 *     summary: Get telecaller leaderboard for a month
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: monthYear
 *         required: true
 *         schema:
 *           type: string
 *           example: 2026-01
 *     responses:
 *       200:
 *         description: Leaderboard
 *       401:
 *         description: Unauthorized
 * /api/telecaller-targets/{telecallerId}/history:
 *   get:
 *     tags: [TelecallerTargets]
 *     summary: Get a telecaller's target history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: telecallerId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Target history
 *       401:
 *         description: Unauthorized
 * /api/telecaller-targets/{telecallerId}/{monthYear}:
 *   get:
 *     tags: [TelecallerTargets]
 *     summary: Get a telecaller's target for a specific month (public)
 *     parameters:
 *       - in: path
 *         name: telecallerId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: monthYear
 *         required: true
 *         schema:
 *           type: string
 *           example: 2026-01
 *     responses:
 *       200:
 *         description: Target for the month
 */
router.post(
  "/",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller"),
  preventDuplicateRequests,
  upsertTelecallerTarget
);

// Must be before /:telecallerId/:monthYear to avoid route conflict
router.get("/leaderboard/:monthYear", requireAuth, getLeaderboardForMonth);
router.get("/:telecallerId/history", requireAuth, getTelecallerTargetHistory);

router.get("/:telecallerId/:monthYear", getTelecallerTarget);

export default router;