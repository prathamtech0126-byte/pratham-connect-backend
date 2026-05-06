import { Router } from "express";
import {
  createTeamController,
  getAllTeamsController,
  getTeamByIdController,
  updateTeamController,
  deleteTeamController,
} from "../controllers/teamList.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * POST /api/team - Add new team (admin or superadmin)
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  createTeamController
);

/**
 * GET /api/team - Get all teams (Authenticated users)
 */
router.get("/", requireAuth, requireRole("admin", "superadmin"), getAllTeamsController);

/**
 * GET /api/team/:id - Get team by ID (Authenticated users)
 */
router.get("/:id", requireAuth, requireRole("admin", "superadmin"), getTeamByIdController);

/**
 * PUT /api/team/:id - Update team (admin or superadmin)
 */
router.put(
  "/:id",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  updateTeamController
);

/**
 * DELETE /api/team/:id - Delete team (admin or superadmin)
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  deleteTeamController
);

export default router;