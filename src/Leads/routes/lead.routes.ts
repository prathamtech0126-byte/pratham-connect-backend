import { Router } from "express";
import { requireAuth, requireRole } from "../../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../../middlewares/requestDeduplication.middleware";
import {
  addLeadActivityController,
  assignLeadController,
  bulkAssignLeadsController,
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
  updateLeadController,
  searchLeadReferenceClientsController,
} from "../controllers/lead.controller";
import { csvUploadMiddleware } from "../../middlewares/csvUpload.middleware";

const router = Router();

/**
 * @openapi
 * /api/leads:
 *   get:
 *     tags: [Leads]
 *     summary: Get all leads (role-scoped) with filtering, sorting and pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by lead name
 *       - in: query
 *         name: counsellorId
 *         schema:
 *           type: integer
 *         description: Alias currentCounsellorId also accepted
 *       - in: query
 *         name: telecallerId
 *         schema:
 *           type: integer
 *         description: Alias currentTelecallerId also accepted
 *       - in: query
 *         name: assignedScope
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: progressStatus
 *         schema:
 *           type: string
 *       - in: query
 *         name: assignmentStatus
 *         schema:
 *           type: string
 *       - in: query
 *         name: eligibilityStatus
 *         schema:
 *           type: string
 *       - in: query
 *         name: leadQuality
 *         schema:
 *           type: string
 *       - in: query
 *         name: leadSource
 *         schema:
 *           type: string
 *       - in: query
 *         name: leadType
 *         schema:
 *           type: string
 *       - in: query
 *         name: isJunk
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: hasPendingFollowUp
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: nextFollowupFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: nextFollowupTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: createdFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: createdTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: withoutTelecaller
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: withTelecaller
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: metaLeadsOnly
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: sentToMeta
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: hasQuality
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: excludeUnassigned
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: updated_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: List of leads
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [Leads]
 *     summary: Create a lead
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Lead created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/telecaller/counsellor/developer only
 * /api/leads/reference/clients:
 *   get:
 *     tags: [Leads]
 *     summary: Search client references for lead form autocomplete
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Matching clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/reports:
 *   get:
 *     tags: [Leads]
 *     summary: Get lead reports
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lead report data
 *       401:
 *         description: Unauthorized
 * /api/leads/leaderboard/telecallers:
 *   get:
 *     tags: [Leads]
 *     summary: Get telecaller leaderboard
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leaderboard data
 *       401:
 *         description: Unauthorized
 * /api/leads/telecaller-summary:
 *   get:
 *     tags: [Leads]
 *     summary: Get telecaller lead summary
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary
 *       401:
 *         description: Unauthorized
 * /api/leads/telecaller/{id}/report:
 *   get:
 *     tags: [Leads]
 *     summary: Get individual telecaller report
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
 *         description: Telecaller report
 *       401:
 *         description: Unauthorized
 * /api/leads/counsellor-report:
 *   get:
 *     tags: [Leads]
 *     summary: Get counsellor lead report
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Counsellor report
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/telecaller-dashboard-stats:
 *   get:
 *     tags: [Leads]
 *     summary: Get telecaller dashboard stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *       401:
 *         description: Unauthorized
 * /api/leads/import/template:
 *   get:
 *     tags: [Leads]
 *     summary: Download CSV import template
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CSV template file
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/import:
 *   post:
 *     tags: [Leads]
 *     summary: Import leads from CSV file
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Import result
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/bulk-assign:
 *   post:
 *     tags: [Leads]
 *     summary: Bulk assign leads to a counsellor
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assigned
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/bulk-assign-strategy:
 *   post:
 *     tags: [Leads]
 *     summary: Bulk assign leads using a strategy
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assigned
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}:
 *   get:
 *     tags: [Leads]
 *     summary: Get a lead by ID
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
 *         description: Lead detail
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [Leads]
 *     summary: Update a lead
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
 * /api/leads/{id}/activities:
 *   post:
 *     tags: [Leads]
 *     summary: Add an activity to a lead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Activity added
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/assign:
 *   post:
 *     tags: [Leads]
 *     summary: Assign a lead to a counsellor
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
 *         description: Assigned
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/junk:
 *   post:
 *     tags: [Leads]
 *     summary: Mark a lead as junk
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
 *         description: Marked as junk
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/revert-junk:
 *   post:
 *     tags: [Leads]
 *     summary: Revert a lead from junk
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
 *         description: Reverted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/convert-to-client:
 *   post:
 *     tags: [Leads]
 *     summary: Convert a lead to a client
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
 *         description: Converted to client
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — counsellor only
 * /api/leads/{id}/drop:
 *   post:
 *     tags: [Leads]
 *     summary: Drop a lead (counsellor only)
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
 *         description: Lead dropped
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — counsellor only
 * /api/leads/{id}/followup:
 *   post:
 *     tags: [Leads]
 *     summary: Schedule or update a follow-up for a lead
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
 *         description: Follow-up set
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/activities/{activityId}/status:
 *   put:
 *     tags: [Leads]
 *     summary: Update activity status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/leads/{id}/activities/{activityId}:
 *   patch:
 *     tags: [Leads]
 *     summary: Update activity message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Message updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
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

export default router;
