import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import {
  disconnectFacebookController,
  distributeFacebookManualBulkController,
  distributeLeadsManuallyController,
  exportFormLeadsCsvController,
  facebookCallbackController,
  facebookEventsController,
  facebookWebhookController,
  getFacebookActiveFormsController,
  getFacebookAuthUrlController,
  getFacebookFormsController,
  getFacebookImportedLeadsController,
  getFacebookLeadPreviewController,
  getFacebookManualDistributionAssigneeStatsController,
  getFacebookManualDistributionLeadsController,
  getFacebookPagesController,
  getFacebookStatusController,
  getFormLeadsPaginatedController,
  getFormStatsController,
  getFormStrategyController,
  importFacebookFormLeadsController,
  setFacebookFormStrategyController,
  toggleFacebookFormController,
  verifyFacebookWebhookController,
  getMasterDistributionController,
  saveMasterDistributionController,
  deactivateMasterFormController,
  getFormStatsBulkController,
  getFormsWithUnassignedLeadsController,
} from "../facebook_controllers/automation.controller";
import {
  getMetaConversionsStatusController,
  sendMetaConversionsEventsController,
} from "../facebook_controllers/metaConversions.controller";

const router = Router();

/** Admin only — no developer bypass (unlike requireRole). */
const allowAutomationRoles = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: insufficient role" });
  }
  next();
};

/**
 * @openapi
 * /api/automation/facebook/callback:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: OAuth callback from Facebook (public)
 *     security: []
 *     responses:
 *       302:
 *         description: Redirect after OAuth
 * /api/automation/facebook/webhook:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Facebook webhook verification challenge (public)
 *     security: []
 *     responses:
 *       200:
 *         description: Challenge response
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Receive Facebook webhook events (public, HMAC-verified)
 *     security: []
 *     responses:
 *       200:
 *         description: Event received
 * /api/automation/facebook/auth-url:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get Facebook OAuth URL
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Auth URL
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin only
 * /api/automation/facebook/status:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get Facebook connection status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/disconnect:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Disconnect Facebook integration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Disconnected
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/pages:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get connected Facebook pages
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pages list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/active-forms:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get all active Facebook lead forms
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active forms
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/leads:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get imported Facebook leads
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leads list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/events:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get Facebook automation events log
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Events log
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/manual-distribution/leads:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get unassigned leads for manual distribution
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leads for distribution
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/manual-distribution/by-assignee:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get manual distribution stats by assignee
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assignee stats
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/manual-distribution/distribute-bulk:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Bulk distribute leads manually
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Distributed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/manual-distribution/forms-with-unassigned-leads:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get forms that have unassigned leads
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Forms with unassigned leads
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/meta-conversions/status:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get Meta Conversions API status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/meta-conversions/send:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Send a Meta Conversions API event
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Event sent
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{pageId}:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get lead forms for a Facebook page
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Forms list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{pageId}/{formId}/toggle:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Toggle automation on/off for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pageId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Toggled
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/strategy:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get automation strategy for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Strategy config
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [FacebookAutomation]
 *     summary: Update automation strategy for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/stats:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get stats for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Form stats
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/paginated-leads:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get paginated leads for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated leads
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/export:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Export form leads as CSV
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: CSV file
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/distribute-manual:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Manually distribute leads from a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Distributed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/preview:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Preview leads for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lead preview
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/{formId}/import:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Import leads from a Facebook form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Imported
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/forms/stats-bulk:
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Get stats for multiple forms in bulk
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bulk stats
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/master-distribution:
 *   get:
 *     tags: [FacebookAutomation]
 *     summary: Get master distribution config
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Master distribution config
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [FacebookAutomation]
 *     summary: Save master distribution config
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/automation/facebook/master-distribution/{formId}:
 *   delete:
 *     tags: [FacebookAutomation]
 *     summary: Deactivate master distribution for a form
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: formId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deactivated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
// Public — OAuth & webhooks (no auth middleware)
router.get("/facebook/callback", facebookCallbackController);
router.get("/facebook/webhook", verifyFacebookWebhookController);
router.post("/facebook/webhook", facebookWebhookController);

// Authenticated
router.get("/facebook/auth-url", requireAuth, allowAutomationRoles, getFacebookAuthUrlController);
router.get("/facebook/status", requireAuth, allowAutomationRoles, getFacebookStatusController);
router.post("/facebook/disconnect", requireAuth, allowAutomationRoles, disconnectFacebookController);
router.get("/facebook/pages", requireAuth, allowAutomationRoles, getFacebookPagesController);
router.get("/facebook/active-forms", requireAuth, allowAutomationRoles, getFacebookActiveFormsController);

router.get(
  "/facebook/manual-distribution/leads",
  requireAuth,
  allowAutomationRoles,
  getFacebookManualDistributionLeadsController
);
router.get(
  "/facebook/manual-distribution/by-assignee",
  requireAuth,
  allowAutomationRoles,
  getFacebookManualDistributionAssigneeStatsController
);
router.post(
  "/facebook/manual-distribution/distribute-bulk",
  requireAuth,
  allowAutomationRoles,
  distributeFacebookManualBulkController
);

router.get("/facebook/leads", requireAuth, allowAutomationRoles, getFacebookImportedLeadsController);
router.get("/facebook/events", requireAuth, allowAutomationRoles, facebookEventsController);

router.get(
  "/meta-conversions/status",
  requireAuth,
  allowAutomationRoles,
  getMetaConversionsStatusController
);
router.post(
  "/meta-conversions/send",
  requireAuth,
  allowAutomationRoles,
  sendMetaConversionsEventsController
);

router.get("/facebook/forms/:pageId", requireAuth, allowAutomationRoles, getFacebookFormsController);
router.post(
  "/facebook/forms/:pageId/:formId/toggle",
  requireAuth,
  allowAutomationRoles,
  toggleFacebookFormController
);

router.get("/facebook/forms/:formId/strategy", requireAuth, allowAutomationRoles, getFormStrategyController);
router.put(
  "/facebook/forms/:formId/strategy",
  requireAuth,
  allowAutomationRoles,
  setFacebookFormStrategyController
);
router.get("/facebook/forms/:formId/stats", requireAuth, allowAutomationRoles, getFormStatsController);
router.get(
  "/facebook/forms/:formId/paginated-leads",
  requireAuth,
  allowAutomationRoles,
  getFormLeadsPaginatedController
);
router.get("/facebook/forms/:formId/export", requireAuth, allowAutomationRoles, exportFormLeadsCsvController);
router.post(
  "/facebook/forms/:formId/distribute-manual",
  requireAuth,
  allowAutomationRoles,
  distributeLeadsManuallyController
);
router.get("/facebook/forms/:formId/preview", requireAuth, allowAutomationRoles, getFacebookLeadPreviewController);
router.post("/facebook/forms/:formId/import", requireAuth, allowAutomationRoles, importFacebookFormLeadsController);
router.post("/facebook/forms/stats-bulk", requireAuth, allowAutomationRoles, getFormStatsBulkController);

router.get("/facebook/master-distribution", requireAuth, allowAutomationRoles, getMasterDistributionController);
router.post("/facebook/master-distribution", requireAuth, allowAutomationRoles, saveMasterDistributionController);
router.delete("/facebook/master-distribution/:formId", requireAuth, allowAutomationRoles, deactivateMasterFormController);

router.get("/facebook/manual-distribution/forms-with-unassigned-leads", requireAuth, allowAutomationRoles, getFormsWithUnassignedLeadsController);

export default router;
