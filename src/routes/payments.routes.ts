import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { assignCounsellorToPaymentController } from "../controllers/payments.controller";

const router = Router();

/**
 * PATCH /api/payments/assign-counsellor
 * Reassign clientOwner or addedBy on a payment row.
 * Access: developer, admin only
 */
router.patch(
  "/assign-counsellor",
  requireAuth,
  requireRole("developer", "admin"),
  assignCounsellorToPaymentController
);

export default router;
