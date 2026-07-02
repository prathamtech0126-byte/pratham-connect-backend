import { Router } from "express";
import { requireClientPortalAuth } from "../../clientPortal/middlewares/clientPortalAuth.middleware";
import {
  clientDocumentChecklistAssignmentsController,
  clientDocumentStorageUsageController,
  clientDocumentUploadController,
  clientDocumentReviewEventsController,
} from "../controllers/clientDocument.controller";
import { clientDocumentUploadMiddleware } from "../middlewares/clientDocumentUpload.middleware";

/**
 * Client-facing document routes — mounted under /api/client-portal for URL compatibility.
 * Implementation lives in clientDocuments module (not clientPortal).
 */
const router = Router();

router.get("/checklists", requireClientPortalAuth, clientDocumentChecklistAssignmentsController);
router.get("/storage-usage", requireClientPortalAuth, clientDocumentStorageUsageController);
router.get("/review-events", requireClientPortalAuth, clientDocumentReviewEventsController);
router.post(
  "/checklists/upload",
  requireClientPortalAuth,
  clientDocumentUploadMiddleware.single("file"),
  clientDocumentUploadController
);

export default router;
