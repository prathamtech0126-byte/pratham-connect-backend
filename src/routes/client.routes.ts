import { Router } from "express";
import { saveClientController, getAllClientsByCounsellorController, getAllClientsController, getClientCompleteDetailsController, getArchivedClientsController, archiveClientController, getAllClientsForAdminController, transferClientController } from "../controllers/client.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Counsellor / Admin can create client
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin", "counsellor", "manager"),
  preventDuplicateRequests,
  saveClientController
);

/**
 * Get all clients (for counsellor / admin) - excludes archived clients
 */
router.get(
  "/counsellor-clients",
  requireAuth,
  requireRole("admin", "counsellor", "manager"),
  getAllClientsController
);

/**
 * Get archived clients (for counsellor / admin / manager) - only archived clients
 */
router.get(
  "/archived-clients",
  requireAuth,
  requireRole("admin", "counsellor", "manager"),
  getArchivedClientsController
);

/**
 * Archive/Unarchive a client
 * Body: { "archived": true/false }
 */
router.put(
  "/:clientId/archive",
  requireAuth,
  requireRole("admin", "counsellor", "manager"),
  preventDuplicateRequests,
  archiveClientController
);

/**
 * Get client complete details (client info + payments + product payments with entity data)
 * ⚠️ This must come BEFORE /:counsellorId route to avoid route conflicts
 */
router.get(
  "/:clientId/complete",
  requireAuth, requireRole("admin", "counsellor", "manager"),
  getClientCompleteDetailsController
);

/**
 * Get client full details by ID
 */
router.get(
  "/:counsellorId",
  requireAuth, requireRole("admin", "counsellor", "manager"),
  getAllClientsByCounsellorController
);


/**
 * Get all clients for admin
 */
router.get(
  "/admin/all-clients",
  requireAuth, requireRole("admin"),
  getAllClientsForAdminController
);

// Client Transfer to another counsellor
router.put(
  "/admin/transfer-client",
  requireAuth, requireRole("admin"),
  transferClientController
);
export default router;
