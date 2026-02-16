import { Router } from "express";
import {
  saveClientProductPaymentController,
  getClientProductPaymentsController,
  deleteClientProductPaymentController,
} from "../controllers/clientProductPayment.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Create product payment (Step-3 optional)
 */
router.post("/", requireAuth, preventDuplicateRequests, saveClientProductPaymentController);

/**
 * Get product payments by client
 */
router.get(
  "/client/:clientId",
  requireAuth,
  getClientProductPaymentsController
);

/**
 * Delete product payment by id (also deletes linked entity row when present)
 */
router.delete("/:productPaymentId", requireAuth, deleteClientProductPaymentController);

export default router;
