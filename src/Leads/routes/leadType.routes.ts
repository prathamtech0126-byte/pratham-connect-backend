import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../../middlewares/requestDeduplication.middleware";
import {
  archiveLeadTypeController,
  createLeadTypeController,
  getLeadTypesController,
  unarchiveLeadTypeController,
  updateLeadTypeController,
} from "../controllers/leadType.controller";

const router = Router();

/**
 * @openapi
 * /api/lead-types:
 *   get:
 *     tags: [LeadTypes]
 *     summary: Get all lead types
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of lead types
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [LeadTypes]
 *     summary: Create a lead type
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/lead-types/{id}:
 *   put:
 *     tags: [LeadTypes]
 *     summary: Update a lead type
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
 *     tags: [LeadTypes]
 *     summary: Archive a lead type (soft delete — rows are never hard-deleted)
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
 *         description: Archived
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/lead-types/{id}/unarchive:
 *   post:
 *     tags: [LeadTypes]
 *     summary: Unarchive a lead type
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
 *         description: Unarchived
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", requireAuth, requireRole("developer", "admin"), preventDuplicateRequests, createLeadTypeController);
router.get("/", requireAuth, getLeadTypesController);
router.put("/:id", requireAuth, requireRole("developer", "admin"), preventDuplicateRequests, updateLeadTypeController);
router.delete("/:id", requireAuth, requireRole("developer", "admin"), preventDuplicateRequests, archiveLeadTypeController);
router.post(
  "/:id/unarchive",
  requireAuth,
  requireRole("developer", "admin"),
  preventDuplicateRequests,
  unarchiveLeadTypeController
);

export default router;
