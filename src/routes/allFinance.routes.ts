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
 * Get pending all finance approvals
 * GET /api/all-finance/pending
 * Access: admin, manager
 */
router.get(
  "/pending",
  requireAuth,
  requireRole("admin", "manager"),
  getPendingApprovalsController
);

/**
 * Approve all finance payment
 * POST /api/all-finance/:financeId/approve
 * Access: admin, manager
 */
router.post(
  "/:financeId/approve",
  requireAuth,
  requireRole("admin", "manager"),
  approveAllFinanceController
);

/**
 * Reject all finance payment
 * POST /api/all-finance/:financeId/reject
 * Access: admin, manager
 */
router.post(
  "/:financeId/reject",
  requireAuth,
  requireRole("admin", "manager"),
  rejectAllFinanceController
);

/**
 * Get approval/rejection history
 * GET /api/all-finance/history
 * Access: admin, manager
 * - Admin: all records
 * - Manager: all except their own approvals/rejections
 */
router.get(
  "/history",
  requireAuth,
  requireRole("admin", "manager"),
  getApprovalHistoryController
);

export default router;
