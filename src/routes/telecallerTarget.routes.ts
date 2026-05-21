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