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
  updateUserRetainedAccessoriesController,
} from "../controllers/deviceInventory.controller";

const router = Router();

/**
 * @openapi
 * /api/tech-support/tickets:
 *   post:
 *     tags: [TechSupport]
 *     summary: Create a tech support ticket
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Ticket created
 *       401:
 *         description: Unauthorized
 * /api/tech-support/tickets/my:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get my tech support tickets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My tickets
 *       401:
 *         description: Unauthorized
 * /api/tech-support/requests:
 *   post:
 *     tags: [TechSupport]
 *     summary: Create a tech support request
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Request created
 *       401:
 *         description: Unauthorized
 *   get:
 *     tags: [TechSupport]
 *     summary: Get all tech support requests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All requests
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — tech_support/admin/superadmin/manager only
 * /api/tech-support/requests/my:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get my tech support requests
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My requests
 *       401:
 *         description: Unauthorized
 * /api/tech-support/requests/{id}/review:
 *   patch:
 *     tags: [TechSupport]
 *     summary: Review a tech support request
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
 *         description: Reviewed
 *       401:
 *         description: Unauthorized
 * /api/tech-support/board:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get tech support board (kanban view)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Board data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/tickets/{id}:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get ticket details
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
 *         description: Ticket details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/tickets/{id}/claim:
 *   post:
 *     tags: [TechSupport]
 *     summary: Claim a ticket (tech support staff)
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
 *         description: Claimed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/tickets/{id}/status:
 *   patch:
 *     tags: [TechSupport]
 *     summary: Update ticket status
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
 *         description: Status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/approve/{id}:
 *   post:
 *     tags: [TechSupport]
 *     summary: Approve a tech support resolution
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
 *         description: Approved
 *       401:
 *         description: Unauthorized
 * /api/tech-support/analytics/overview:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get tech support analytics overview
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/manager only
 * /api/tech-support/tickets/{ticketId}/images:
 *   post:
 *     tags: [TechSupport]
 *     summary: Upload images to a ticket (max 2)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Images uploaded
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/tickets/{ticketId}/images/{filename}:
 *   delete:
 *     tags: [TechSupport]
 *     summary: Delete a ticket image
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get all device inventory
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Devices list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [TechSupport]
 *     summary: Create a device inventory record
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/available:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get available devices
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available devices
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/bulk:
 *   post:
 *     tags: [TechSupport]
 *     summary: Bulk create device inventory records
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/assignable-users:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get users eligible to be assigned a device
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assignable users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/assignment-history:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get device assignment history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assignment history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/assigned-to/{userId}:
 *   get:
 *     tags: [TechSupport]
 *     summary: Get device assigned to a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Assigned device
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/{deviceId}/assign:
 *   post:
 *     tags: [TechSupport]
 *     summary: Assign a device to a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
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
 * /api/tech-support/devices/{deviceId}/unassign:
 *   post:
 *     tags: [TechSupport]
 *     summary: Unassign a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Unassigned
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/{deviceId}/repair:
 *   patch:
 *     tags: [TechSupport]
 *     summary: Toggle device repair status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Repair status toggled
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/devices/{deviceId}:
 *   patch:
 *     tags: [TechSupport]
 *     summary: Update a device inventory record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
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
 *     tags: [TechSupport]
 *     summary: Delete a device inventory record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/tech-support/users/{userId}/retained-accessories:
 *   patch:
 *     tags: [TechSupport]
 *     summary: Update retained accessories for a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
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
 */
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
router.patch(
  "/users/:userId/retained-accessories",
  requireAuth,
  requireRole("tech_support", "admin", "superadmin", "manager"),
  updateUserRetainedAccessoriesController,
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

