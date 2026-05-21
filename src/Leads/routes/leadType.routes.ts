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
 * Admin only.
 *
 * Lead-type rows are never hard-deleted — historical leads keep their stored
 * slug in `leads.lead_source`. The DELETE verb is kept for backward compat
 * with existing frontend clients but is implemented as a soft archive.
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
