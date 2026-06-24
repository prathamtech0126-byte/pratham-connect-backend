import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import {
  getPendingApprovalsController,
  approveAllFinanceController,
  rejectAllFinanceController,
  getApprovalHistoryController,
} from "../controllers/allFinance.controller";

const router = Router();

/**
 * @openapi
 * /api/all-finance/pending:
 *   get:
 *     tags: [AllFinance]
 *     summary: Get pending all-finance payment approvals
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending approvals
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/developer only
 */
router.get(
  "/pending",
  requireAuth,
  requireRole("admin", "manager","developer"),
  getPendingApprovalsController
);

/**
 * @openapi
 * /api/all-finance/{financeId}/approve:
 *   post:
 *     tags: [AllFinance]
 *     summary: Approve an all-finance payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: financeId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Approved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/:financeId/approve",
  requireAuth,
  requireRole("admin", "manager", "developer"),
  approveAllFinanceController
);

/**
 * @openapi
 * /api/all-finance/{financeId}/reject:
 *   post:
 *     tags: [AllFinance]
 *     summary: Reject an all-finance payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: financeId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rejected
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/:financeId/reject",
  requireAuth,
  requireRole("admin", "manager", "developer"),
  rejectAllFinanceController
);

/**
 * @openapi
 * /api/all-finance/history:
 *   get:
 *     tags: [AllFinance]
 *     summary: Get all-finance approval/rejection history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Approval history
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/history",
  requireAuth,
  requireRole("admin", "manager", "developer"),
  getApprovalHistoryController
);

export default router;
