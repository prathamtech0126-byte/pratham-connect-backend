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
 * @openapi
 * /api/team:
 *   get:
 *     tags: [Teams]
 *     summary: Get all teams
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of teams
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [Teams]
 *     summary: Create a team
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/team/{id}:
 *   get:
 *     tags: [Teams]
 *     summary: Get a team by ID
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
 *         description: Team
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [Teams]
 *     summary: Update a team
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
 *     tags: [Teams]
 *     summary: Delete a team
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
router.post("/", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, createTeamController);
router.get("/", requireAuth, getAllTeamsController);
router.get("/:id", requireAuth, getTeamByIdController);
router.put("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, updateTeamController);
router.delete("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, deleteTeamController);

export default router;