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
<<<<<<< HEAD
router.post("/", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, createTeamController);
=======
router.post(
  "/",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  createTeamController
);
>>>>>>> e2d1767 (my local changes)

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
<<<<<<< HEAD
router.put("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, updateTeamController);
=======
router.put(
  "/:id",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  updateTeamController
);
>>>>>>> e2d1767 (my local changes)

/**
 * DELETE /api/team/:id - Delete team (admin or superadmin)
 */
<<<<<<< HEAD
router.delete("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, deleteTeamController);
=======
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "superadmin"),
  preventDuplicateRequests,
  deleteTeamController
);
>>>>>>> e2d1767 (my local changes)

export default router;