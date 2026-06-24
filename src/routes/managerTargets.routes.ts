import { Router } from "express";
import {
  createManagerTargetController,
  getManagerTargetByIdController,
  listManagerTargetsController,
  updateManagerTargetController,
  deleteManagerTargetController,
} from "../controllers/managerTargets.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * @openapi
 * /api/manager-targets:
 *   get:
 *     tags: [ManagerTargets]
 *     summary: List manager targets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: managerId
 *         schema:
 *           type: integer
 *         description: Filter by manager (admin only)
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Range start — alias "from" also accepted. Defaults to current month start.
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Range end — alias "to" also accepted. Defaults to current month end.
 *     responses:
 *       200:
 *         description: List of targets
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [ManagerTargets]
 *     summary: Create a manager target
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/manager-targets/{id}:
 *   get:
 *     tags: [ManagerTargets]
 *     summary: Get a manager target by ID
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
 *         description: Target
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [ManagerTargets]
 *     summary: Update a manager target
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
 *     tags: [ManagerTargets]
 *     summary: Delete a manager target
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
  requireRole("developer","admin", "manager"),
  listManagerTargetsController
);
router.get(
  "/:id",
  requireAuth,
  requireRole("developer","admin", "manager"),
  getManagerTargetByIdController
);
router.post(
  "/",
  requireAuth,
  requireRole("developer","admin"),
  preventDuplicateRequests,
  createManagerTargetController
);
router.put(
  "/:id",
  requireAuth,
  requireRole("developer","admin"),
  preventDuplicateRequests,
  updateManagerTargetController
);
router.delete(
  "/:id",
  requireAuth,
  requireRole("developer","admin"),
  deleteManagerTargetController
);

export default router;
