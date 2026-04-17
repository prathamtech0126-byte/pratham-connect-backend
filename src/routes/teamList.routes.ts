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
 * POST /api/team - Add new team (Admin only)
 */
router.post("/", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, createTeamController);

/**
 * GET /api/team - Get all teams (Authenticated users)
 */
router.get("/", requireAuth, getAllTeamsController);

/**
 * GET /api/team/:id - Get team by ID (Authenticated users)
 */
router.get("/:id", requireAuth, getTeamByIdController);

/**
 * PUT /api/team/:id - Update team (Admin only)
 */
router.put("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, updateTeamController);

/**
 * DELETE /api/team/:id - Delete team (Admin only)
 */
router.delete("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, deleteTeamController);

export default router;