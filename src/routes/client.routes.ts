import { Router } from "express";
import { saveClientController, getAllClientsByCounsellorController, getAllClientsController, getCounsellorClientsWithFilterController, getClientCompleteDetailsController, getArchivedClientsController, archiveClientController, getAllClientsForAdminController, transferClientController } from "../controllers/client.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Counsellor / Admin can create client
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
  requireRole("admin", "counsellor", "manager","developer"),
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
  "/:clientId/complete",
  requireAuth, requireRole("admin", "counsellor", "manager","developer"),
  getClientCompleteDetailsController
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
