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
 * @openapi
 * /api/client-product-payments:
 *   post:
 *     tags: [ClientProductPayments]
 *     summary: Create a client product payment (Step 3 — optional)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 * /api/client-product-payments/client/{clientId}:
 *   get:
 *     tags: [ClientProductPayments]
 *     summary: Get product payments for a client
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
 *         description: List of product payments
 *       401:
 *         description: Unauthorized
 * /api/client-product-payments/{productPaymentId}:
 *   delete:
 *     tags: [ClientProductPayments]
 *     summary: Delete a product payment (also deletes linked entity row)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productPaymentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 */
router.post("/", requireAuth, preventDuplicateRequests, saveClientProductPaymentController);
router.get(
  "/client/:clientId",
  requireAuth,
  getClientProductPaymentsController
);
router.delete("/:productPaymentId", requireAuth, deleteClientProductPaymentController);

export default router;
