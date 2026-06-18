import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import {
  assignVisaCaseController,
  bulkAssignVisaCasesController,
  fulfillVisaCaseDocumentController,
  getVisaCaseController,
  getVisaCaseDashboardController,
  getVisaCaseProcessingStagesController,
  listAssignableUsersController,
  listVisaCaseDocumentRequestHistoryController,
  listVisaCaseDocumentRequestsController,
  listGlobalAssignableUsersController,
  listVisaCaseAssignmentsController,
  listVisaCasesController,
  requestVisaCaseDocumentController,
  syncVisaCasesForClientController,
  updateVisaCaseDecisionController,
  updateVisaCaseSponsorshipController,
  updateVisaCaseStatusController,
  updateVisaCaseTravelController,
} from "../controllers/visaCase.controller";

const router = Router();

/**
 * Visa case APIs (DATABASE_URL_SECOND).
 * Visitor/spouse: travel, sponsorship, processing, decision.
 * Student: student application data + shared processing/decision fields.
 */

router.get("/dashboard", requireAuth, getVisaCaseDashboardController);
router.get(
  "/processing-stages",
  requireAuth,
  getVisaCaseProcessingStagesController
);
router.get("/", requireAuth, listVisaCasesController);
router.post("/sync-eligible", requireAuth, syncVisaCasesForClientController);
router.get(
  "/assignable-users",
  requireAuth,
  listGlobalAssignableUsersController
);
router.post("/assign-bulk", requireAuth, bulkAssignVisaCasesController);
router.get(
  "/document-requests",
  requireAuth,
  listVisaCaseDocumentRequestHistoryController
);
router.post("/:visaCaseId/assign", requireAuth, assignVisaCaseController);
router.get(
  "/:visaCaseId/assignments",
  requireAuth,
  listVisaCaseAssignmentsController
);
router.get(
  "/:visaCaseId/assignable-users",
  requireAuth,
  listAssignableUsersController
);
router.get("/:visaCaseId", requireAuth, getVisaCaseController);

router.patch("/:visaCaseId/travel", requireAuth, updateVisaCaseTravelController);
router.patch(
  "/:visaCaseId/sponsorship",
  requireAuth,
  updateVisaCaseSponsorshipController
);
router.patch("/:visaCaseId/status", requireAuth, updateVisaCaseStatusController);
router.patch("/:visaCaseId/decision", requireAuth, updateVisaCaseDecisionController);
router.get(
  "/:visaCaseId/document-requests",
  requireAuth,
  listVisaCaseDocumentRequestsController
);
router.post(
  "/:visaCaseId/document-requests",
  requireAuth,
  requestVisaCaseDocumentController
);
router.patch(
  "/document-requests/:requestId/fulfill",
  requireAuth,
  fulfillVisaCaseDocumentController
);

export default router;
