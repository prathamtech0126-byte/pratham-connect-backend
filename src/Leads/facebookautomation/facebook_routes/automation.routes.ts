import { Router } from "express";
import { requireAuth, requireRole } from "../../../middlewares/auth.middleware";
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
const allowAutomationRoles = requireRole("superadmin", "admin", "developer", "manager");

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
