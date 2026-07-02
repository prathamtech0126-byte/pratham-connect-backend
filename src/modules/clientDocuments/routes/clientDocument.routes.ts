import { Router } from "express";
import { requireAuth, requireRole } from "../../../middlewares/auth.middleware";
import {
  assignChecklistToClientController,
  counsellorClientAssignmentsController,
  staffChecklistUploadController,
  approveChecklistItemController,
  rejectChecklistItemController,
  staffDocumentReviewEventsController,
} from "../controllers/clientDocument.controller";
import { clientDocumentUploadMiddleware } from "../middlewares/clientDocumentUpload.middleware";

const router = Router();

const STAFF_DOCUMENT_ROLES = [
  "counsellor",
  "cx",
  "binding",
  "admin",
  "superadmin",
  "manager",
  "developer",
] as const;

router.post(
  "/assignments",
  requireAuth,
  requireRole("counsellor", "admin", "superadmin", "developer"),
  assignChecklistToClientController
);

router.get(
  "/assignments/:clientId",
  requireAuth,
  requireRole(...STAFF_DOCUMENT_ROLES),
  counsellorClientAssignmentsController
);

router.post(
  "/uploads",
  requireAuth,
  requireRole(...STAFF_DOCUMENT_ROLES),
  clientDocumentUploadMiddleware.single("file"),
  staffChecklistUploadController
);

router.post(
  "/reviews/approve",
  requireAuth,
  requireRole(...STAFF_DOCUMENT_ROLES),
  approveChecklistItemController
);

router.post(
  "/reviews/reject",
  requireAuth,
  requireRole(...STAFF_DOCUMENT_ROLES),
  rejectChecklistItemController
);

router.get(
  "/reviews/events/:clientId",
  requireAuth,
  requireRole(...STAFF_DOCUMENT_ROLES),
  staffDocumentReviewEventsController
);

export default router;
