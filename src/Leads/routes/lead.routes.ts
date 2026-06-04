import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../../middlewares/requestDeduplication.middleware";
import {
  addLeadActivityController,
  assignLeadController,
  bulkAssignLeadsController,
  bulkStrategyAssignLeadsController,
  createLeadController,
  downloadLeadImportTemplateController,
  getLeadByIdController,
  getLeadReportController,
  getLeadsController,
  getTelecallerLeadSummaryController,
  getTelecallerIndividualReportController,
  getCounsellorIndividualReportController,
  getTelecallerDashboardStatsController,
  getTelecallerLeaderboardController,
  importLeadsCsvController,
  markLeadFollowupController,
  markLeadJunkController,
  revertLeadJunkController,
  convertLeadToClientController,
  dropLeadByCounsellorController,
  updateLeadActivityStatusController,
  updateLeadActivityMessageController,
  updateLeadController,
  searchLeadReferenceClientsController,
  searchLeadReferenceTeamController,
  listLeadReferenceTeamDirectoryController,
  listLeadReferenceCounsellorsController,
  listLeadTransferAssigneesController,
} from "../controllers/lead.controller";
import { csvUploadMiddleware } from "../../middlewares/csvUpload.middleware";

const router = Router();

router.get("/", requireAuth, getLeadsController);
router.get(
  "/reference/clients",
  requireAuth,
  requireRole(
    "telecaller",
    "counsellor",
    "manager",
    "admin",
    "developer",
    "superadmin",
    "marketing_head"
  ),
  searchLeadReferenceClientsController
);
router.get(
  "/reference/team",
  requireAuth,
  requireRole(
    "telecaller",
    "counsellor",
    "manager",
    "admin",
    "developer",
    "superadmin",
    "marketing_head"
  ),
  searchLeadReferenceTeamController
);
router.get(
  "/reference/team-directory",
  requireAuth,
  requireRole(
    "telecaller",
    "counsellor",
    "manager",
    "admin",
    "developer",
    "superadmin",
    "marketing_head"
  ),
  listLeadReferenceTeamDirectoryController
);
router.get(
  "/reference/counsellors",
  requireAuth,
  requireRole(
    "telecaller",
    "counsellor",
    "manager",
    "admin",
    "developer",
    "superadmin",
    "marketing_head"
  ),
  listLeadReferenceCounsellorsController
);
router.get(
  "/transfer-assignees",
  requireAuth,
  requireRole(
    "telecaller",
    "counsellor",
    "manager",
    "admin",
    "developer",
    "superadmin",
    "marketing_head"
  ),
  listLeadTransferAssigneesController
);
router.get("/reports", requireAuth, getLeadReportController);
router.get("/leaderboard/telecallers", requireAuth, getTelecallerLeaderboardController);
router.get("/telecaller-summary", requireAuth, getTelecallerLeadSummaryController);
router.get(
  "/telecaller/:id/report",
  requireAuth,
  getTelecallerIndividualReportController
);
router.get(
  "/counsellor-report",
  requireAuth,
  requireRole("counsellor", "manager", "admin", "developer", "superadmin"),
  getCounsellorIndividualReportController
);
router.get("/telecaller-dashboard-stats", requireAuth, getTelecallerDashboardStatsController);

router.get(
  "/import/template",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin"),
  downloadLeadImportTemplateController
);
router.post(
  "/import",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin"),
  preventDuplicateRequests,
  csvUploadMiddleware.single("file"),
  importLeadsCsvController
);

router.post(
  "/bulk-assign",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin"),
  preventDuplicateRequests,
  bulkAssignLeadsController
);

router.post(
  "/bulk-assign-strategy",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin"),
  preventDuplicateRequests,
  bulkStrategyAssignLeadsController
);

router.get("/:id", requireAuth, getLeadByIdController);

router.post(
  "/",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  preventDuplicateRequests,
  createLeadController
);

router.put(
  "/:id",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  preventDuplicateRequests,
  updateLeadController
);

router.post(
  "/:id/activities",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  preventDuplicateRequests,
  addLeadActivityController
);

router.post(
  "/:id/assign",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  preventDuplicateRequests,
  assignLeadController
);

router.post(
  "/:id/junk",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin", "telecaller"),
  preventDuplicateRequests,
  markLeadJunkController
);

router.post(
  "/:id/revert-junk",
  requireAuth,
  requireRole("developer", "admin", "manager", "superadmin"),
  preventDuplicateRequests,
  revertLeadJunkController
);

router.post(
  "/:id/convert-to-client",
  requireAuth,
  requireRole("counsellor"),
  preventDuplicateRequests,
  convertLeadToClientController
);

router.post(
  "/:id/drop",
  requireAuth,
  requireRole("counsellor"),
  preventDuplicateRequests,
  dropLeadByCounsellorController
);

router.post(
  "/:id/followup",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  preventDuplicateRequests,
  markLeadFollowupController
);

router.put(
  "/:id/activities/:activityId/status",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  updateLeadActivityStatusController
);

router.patch(
  "/:id/activities/:activityId",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor"),
  updateLeadActivityMessageController
);

export default router;
