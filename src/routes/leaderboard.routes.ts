import { Router } from "express";
import {
  getLeaderboardController,
  getLeaderboardSummaryController,
  setTargetController,
  updateTargetController,
} from "../controllers/leaderboard.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Get leaderboard (ranked counsellors)
 * GET /api/leaderboard?month=1&year=2026
 * Access: admin, manager, counsellor
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager", "counsellor"),
  getLeaderboardController
);

/**
 * Get leaderboard summary (total counsellors, enrollments, revenue)
 * GET /api/leaderboard/summary?month=1&year=2026
 * Access: admin, manager, counsellor
 */
router.get(
  "/summary",
  requireAuth,
  requireRole("admin", "manager", "counsellor"),
  getLeaderboardSummaryController
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
  requireRole("admin", "manager"),
  preventDuplicateRequests,
  setTargetController
);

/**
 * Update target
 * PUT /api/leaderboard/target/:id
 * Body: { target }
 * Access: admin, manager
 */
router.put(
  "/target/:id",
  requireAuth,
  requireRole("admin", "manager"),
  preventDuplicateRequests,
  updateTargetController
);

export default router;
