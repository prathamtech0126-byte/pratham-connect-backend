import { Router } from "express";
import {
  saveClientPaymentController,
  getClientPaymentsController,
  deleteClientPaymentController,
} from "../controllers/clientPayment.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Create payment (Admin / Counsellor)
 */
router.post("/", requireAuth, requireRole("admin", "counsellor","manager"), preventDuplicateRequests, saveClientPaymentController);

/**
 * Get payments by client
 */
router.get(
  "/client/:clientId",
  requireAuth,
  getClientPaymentsController
);

/**
 * Delete payment
 */
router.delete("/:paymentId", requireAuth, requireRole("admin", "manager"), deleteClientPaymentController);

export default router;
