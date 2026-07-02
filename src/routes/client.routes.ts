import { Router } from "express";
import { saveClientController, getAllClientsByCounsellorController, getAllClientsController, getCounsellorClientsWithFilterController, getClientCompleteDetailsController, updateClientBasicDetailsController, getArchivedClientsController, archiveClientController, getAllClientsForAdminController, transferClientController } from "../controllers/client.controller";
import {
  getPortalStatusController,
  resetPortalPasswordController,
  sendPortalInvitationController,
} from "../modules/clientPortal/controllers/clientPortalInvitation.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * @openapi
 * /api/clients:
 *   post:
 *     tags: [Clients]
 *     summary: Create a client
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Client created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/counsellor/manager/developer only
 * /api/clients/counsellor-clients:
 *   get:
 *     tags: [Clients]
 *     summary: Get all active clients (role-scoped)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/clients/counsellor-clients/filtered:
 *   get:
 *     tags: [Clients]
 *     summary: Get clients filtered by date (role-scoped)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: monthly
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *         description: Target user ID — alias "id" also accepted. Defaults to logged-in user.
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, manager, counsellor]
 *         description: Role of the target user
 *     responses:
 *       200:
 *         description: Filtered clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [Clients]
 *     summary: Get clients filtered by date (POST variant — same params in body)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Filtered clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/clients/archived-clients:
 *   get:
 *     tags: [Clients]
 *     summary: Get archived clients (role-scoped)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Archived clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [Clients]
 *     summary: Get archived clients (POST variant)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Archived clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/clients/admin/all-clients:
 *   get:
 *     tags: [Clients]
 *     summary: Get all clients (admin view — searchable)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All clients
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/clients/admin/transfer-client:
 *   put:
 *     tags: [Clients]
 *     summary: Transfer a client to another counsellor
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transferred
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/clients/{clientId}/archive:
 *   put:
 *     tags: [Clients]
 *     summary: Archive or unarchive a client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Archive status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/clients/{clientId}/complete:
 *   get:
 *     tags: [Clients]
 *     summary: Get complete client details (payments + product payments + entity data)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Complete client data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/clients/{counsellorId}:
 *   get:
 *     tags: [Clients]
 *     summary: Get clients by counsellor ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: counsellorId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clients for the counsellor
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  preventDuplicateRequests,
  saveClientController
);

/**
 * Get all clients (for counsellor / admin) - excludes archived clients
 */
router.get(
  "/counsellor-clients",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer",),
  getAllClientsController
);

/**
 * Filtered clients by date. Pass user id and role (query or body) to get that user's own clients only.
 * Admin → clients admin added; Manager → clients manager added; Counsellor → own clients. If id/role omitted, uses logged-in user.
 */
router.get(
  "/counsellor-clients/filtered",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  getCounsellorClientsWithFilterController
);

router.post(
  "/counsellor-clients/filtered",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  getCounsellorClientsWithFilterController
);

/**
 * Get archived clients (same pattern as counsellor-clients/filtered). Pass user id and role (query or body) for that user's full archived list.
 * Counsellor/Manager/Admin each see their own archived list (no date filter).
 */
router.get(
  "/archived-clients",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  getArchivedClientsController
);
router.post(
  "/archived-clients",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  getArchivedClientsController
);

/**
 * Archive/Unarchive a client
 * Body: { "archived": true/false }
 */
router.put(
  "/:clientId/archive",
  requireAuth,
  requireRole("admin", "counsellor", "manager","developer"),
  preventDuplicateRequests,
  archiveClientController
);

/**
 * Get client complete details (client info + payments + product payments with entity data)
 * ⚠️ This must come BEFORE /:counsellorId route to avoid route conflicts
 */
router.get(
  "/:clientId/portal-status",
  requireAuth,
  requireRole("admin", "counsellor", "manager", "developer"),
  getPortalStatusController
);

router.post(
  "/:clientId/portal-invitation",
  requireAuth,
  requireRole("admin", "counsellor", "manager", "developer"),
  preventDuplicateRequests,
  sendPortalInvitationController
);

router.post(
  "/:clientId/portal-reset-password",
  requireAuth,
  requireRole("admin", "counsellor", "manager", "developer"),
  preventDuplicateRequests,
  resetPortalPasswordController
);

/**
 * Get client complete details (client info + payments + product payments with entity data)
 * ⚠️ This must come BEFORE /:counsellorId route to avoid route conflicts
 */
router.get(
  "/:clientId/complete",
  requireAuth, requireRole("admin", "counsellor", "manager", "developer", "cx", "binding", "application"),
  getClientCompleteDetailsController
);

/**
 * Update client basic details (client_information).
 * Backend ops (cx / binding / application) and admin roles.
 * Must come BEFORE /:counsellorId route to avoid route conflicts.
 */
router.patch(
  "/:clientId/basic-details",
  requireAuth,
  requireRole("admin", "manager", "developer", "cx", "binding", "application"),
  preventDuplicateRequests,
  updateClientBasicDetailsController
);

/**
 * Get client full details by ID
 */
router.get(
  "/:counsellorId",
  requireAuth, requireRole("admin", "counsellor", "manager","developer"),
  getAllClientsByCounsellorController
);


/**
 * Get all clients for admin. Optional query: search (or name, q) = filter by client name (case-insensitive partial match).
 */
router.get(
  "/admin/all-clients",
  requireAuth, requireRole("admin","developer"),
  getAllClientsForAdminController
);

// Client Transfer to another counsellor
router.put(
  "/admin/transfer-client",
  requireAuth, requireRole("admin","developer"),
  transferClientController
);
export default router;
