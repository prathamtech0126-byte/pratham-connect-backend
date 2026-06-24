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
 * @openapi
 * /api/client-payments:
 *   post:
 *     tags: [ClientPayments]
 *     summary: Create a client payment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Payment created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/counsellor/manager/developer only
 * /api/client-payments/client/{clientId}:
 *   get:
 *     tags: [ClientPayments]
 *     summary: Get payments for a client
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
 *         description: List of payments
 *       401:
 *         description: Unauthorized
 * /api/client-payments/{paymentId}:
 *   delete:
 *     tags: [ClientPayments]
 *     summary: Delete a client payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/developer only
 */
router.post("/", requireAuth, requireRole("developer","admin", "counsellor","manager"), preventDuplicateRequests, saveClientPaymentController);
router.get(
  "/client/:clientId",
  requireAuth,
  getClientPaymentsController
);
router.delete("/:paymentId", requireAuth, requireRole("developer","admin", "manager"), deleteClientPaymentController);

export default router;
