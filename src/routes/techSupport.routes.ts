import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import {
  claimTechSupportTicketController,
  createTechSupportRequestController,
  createTechSupportTicketController,
  getAllTechSupportRequestsController,
  getMyTechSupportRequestsController,
  getMyTechSupportTicketsController,
  getTechSupportAnalyticsOverviewController,
  getTechSupportBoardController,
  getTechSupportTicketDetailsController,
  reviewTechSupportRequestController,
  updateTechSupportTicketStatusController,
  approveTechSupportResolutionController,
} from "../controllers/techSupport.controller";
import {
  uploadTicketImagesController,
  deleteTicketImageController,
} from "../controllers/ticketUpload.controller";
import { ticketUploadMiddleware, handleMulterError } from "../middlewares/ticketUpload.middleware";
import {
  createDeviceInventoryController,
  createBulkDeviceInventoryController,
  getAllDeviceInventoryController,
  getAvailableDeviceInventoryController,
  assignDeviceInventoryController,
  unassignDeviceInventoryController,
  getDeviceAssignmentHistoryController,
  getTechAssignableUsersController,
  toggleDeviceRepairStatusController,
  deleteDeviceInventoryController,
  getAssignedDeviceByUserIdController,
  updateDeviceInventoryController,
} from "../controllers/deviceInventory.controller";

const router = Router();

router.post("/tickets", requireAuth, createTechSupportTicketController);
router.get("/tickets/my", requireAuth, getMyTechSupportTicketsController);
router.post(
  "/requests",
  requireAuth,
  createTechSupportRequestController,
);
router.get("/requests/my", requireAuth, getMyTechSupportRequestsController);
router.get(
  "/requests",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getAllTechSupportRequestsController,
);
router.patch(
  "/requests/:id/review",
  requireAuth,
  reviewTechSupportRequestController,
);

router.get(
  "/board",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getTechSupportBoardController,
);

router.get(
  "/tickets/:id",
  requireAuth,
  requireRole("counsellor", "tech_support", "admin", "superadmin", "manager"),
  getTechSupportTicketDetailsController,
);

router.post(
  "/tickets/:id/claim",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  claimTechSupportTicketController,
);

router.patch(
  "/tickets/:id/status",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  updateTechSupportTicketStatusController,
);

router.post(
  "/approve/:id",
  requireAuth,
  approveTechSupportResolutionController,
);

router.get(
  "/analytics/overview",
  requireAuth,
  requireRole("admin", "superadmin", "manager"),
  getTechSupportAnalyticsOverviewController,
);

// =========================
// Ticket Image Uploads (max 2 per ticket)
// =========================
router.post(
  "/tickets/:ticketId/images",
  requireAuth,
  requireRole("counsellor", "tech_support", "admin", "superadmin", "manager"),
  (req, res, next) => {
    ticketUploadMiddleware.array("images", 2)(req, res, (err) => {
      if (err) {
        return handleMulterError(err, req, res, next);
      }
      next();
    });
  },
  uploadTicketImagesController,
);

router.delete(
  "/tickets/:ticketId/images/:filename",
  requireAuth,
  requireRole("counsellor", "tech_support", "admin", "superadmin", "manager"),
  deleteTicketImageController,
);

// =========================
// Device inventory (Tech Support)
// =========================
router.get(
  "/devices",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getAllDeviceInventoryController,
);
router.get(
  "/devices/available",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getAvailableDeviceInventoryController,
);
router.get(
  "/devices/assigned-to/:userId",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getAssignedDeviceByUserIdController,
);
router.post(
  "/devices",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  createDeviceInventoryController,
);
router.post(
  "/devices/bulk",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  createBulkDeviceInventoryController,
);
router.get(
  "/devices/assignable-users",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getTechAssignableUsersController,
);
router.post(
  "/devices/:deviceId/assign",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  assignDeviceInventoryController,
);
router.post(
  "/devices/:deviceId/unassign",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  unassignDeviceInventoryController,
);
router.get(
  "/devices/assignment-history",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  getDeviceAssignmentHistoryController,
);
router.patch(
  "/devices/:deviceId/repair",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  toggleDeviceRepairStatusController,
);
router.delete(
  "/devices/:deviceId",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  deleteDeviceInventoryController,
);
router.patch(
  "/devices/:deviceId",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  updateDeviceInventoryController,
);

export default router;

