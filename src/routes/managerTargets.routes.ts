import { Router } from "express";
import {
  createManagerTargetController,
  getManagerTargetByIdController,
  listManagerTargetsController,
  updateManagerTargetController,
  deleteManagerTargetController,
} from "../controllers/managerTargets.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * List manager targets
 * GET /api/manager-targets?managerId=1
 * Access: admin (all or filter by managerId), manager (own only)
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  listManagerTargetsController
);

/**
 * Get manager target by ID
 * GET /api/manager-targets/:id
 * Access: admin, manager (own only)
 */
router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  getManagerTargetByIdController
);

/**
 * Create manager target
 * POST /api/manager-targets
 * Body: { manager_id, start_date, end_date, core_sale_*, core_product_*, other_product_*, ... }
 * Access: admin only
 */
router.post(
  "/",
  requireAuth,
  requireRole("admin"),
  preventDuplicateRequests,
  createManagerTargetController
);

/**
 * Update manager target
 * PUT /api/manager-targets/:id
 * Access: admin only
 */
router.put(
  "/:id",
  requireAuth,
  requireRole("admin"),
  preventDuplicateRequests,
  updateManagerTargetController
);

/**
 * Delete manager target
 * DELETE /api/manager-targets/:id
 * Access: admin only
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  deleteManagerTargetController
);

export default router;
