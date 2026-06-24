import { Router } from "express";
import {
  getLeaderboardController,
  getLeaderboardSummaryController,
  getLeaderboardCounsellorsController,
  getLeaderboardCategoriesController,
  getMonthTargetsController,
  setTargetController,
  updateTargetController,
  deleteTargetController,
} from "../controllers/leaderboard.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * @openapi
 * /api/leaderboard:
 *   get:
 *     tags: [Leaderboard]
 *     summary: Get ranked counsellor leaderboard
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Leaderboard
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leaderboard/summary:
 *   get:
 *     tags: [Leaderboard]
 *     summary: Get leaderboard summary (totals)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Summary stats
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leaderboard/counsellors:
 *   get:
 *     tags: [Leaderboard]
 *     summary: Get counsellor list for target dropdown
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Counsellor list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leaderboard/target:
 *   post:
 *     tags: [Leaderboard]
 *     summary: Set a counsellor target
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Target set
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leaderboard/target/{id}:
 *   put:
 *     tags: [Leaderboard]
 *     summary: Update a counsellor target
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
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   delete:
 *     tags: [Leaderboard]
 *     summary: Delete a counsellor target
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
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor"),
  getLeaderboardController
);
router.get(
  "/summary",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor"),
  getLeaderboardSummaryController
);
router.get(
  "/counsellors",
  requireAuth,
  requireRole("developer","admin", "manager"),
  getLeaderboardCounsellorsController
);


/**
 * Get sale type categories for leaderboard tabs
 * GET /api/leaderboard/categories
 */
router.get(
  "/categories",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor"),
  getLeaderboardCategoriesController
);

/**
 * Get existing targets for a month (all categories) — used to disable already-targeted counsellors in dropdown
 * GET /api/leaderboard/month-targets?month=1&year=2026
 */
router.get(
  "/month-targets",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor"),
  getMonthTargetsController
);

/**
 * Set target for counsellor
 * POST /api/leaderboard/target
 * Body: { counsellorId, target, month, year }
 * Access: admin, manager
 */

router.post(
  "/target",
  requireAuth,
  requireRole("developer","admin", "manager"),
  preventDuplicateRequests,
  setTargetController
);
router.put(
  "/target/:id",
  requireAuth,
  requireRole("developer","admin", "manager"),
  preventDuplicateRequests,
  updateTargetController
);
router.delete(
  "/target/:id",
  requireAuth,
  requireRole("developer","admin", "manager"),
  preventDuplicateRequests,
  deleteTargetController
);

export default router;
