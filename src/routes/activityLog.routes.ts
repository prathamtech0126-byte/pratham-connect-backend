import { Router } from "express";
import { getActivityLogsController } from "../controllers/activityLog.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

/**
 * Get activity logs (role-based access)
 * - Admin: All logs
 * - Manager: Only counsellor activities
 * - Counsellor: Own activities + Manager activities on their clients
 *
 * Query parameters:
 * - clientId: Filter by client ID
 * - action: Filter by action (CREATE, UPDATE, DELETE, etc.)
 * - entityType: Filter by entity type (client, client_payment, etc.)
 * - startDate: Filter from date (ISO string: YYYY-MM-DD)
 * - endDate: Filter to date (ISO string: YYYY-MM-DD)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager", "counsellor"),
  getActivityLogsController
);

export default router;
