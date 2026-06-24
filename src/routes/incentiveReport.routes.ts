import { Router } from "express";
import {
  getIncentiveReportController,
  getIncentiveReportAllController,
  postIncentiveActionController,
  putIncentiveActionController,
  postBulkApproveIncentivesController,
  getIncentiveBreakdownController,
  postIncentiveBreakdownActionController,
} from "../controllers/incentiveReport.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

const canView = requireRole("admin", "superadmin", "manager", "developer");
const canWrite = requireRole("admin", "superadmin", "manager", "developer");

/**
 * @openapi
 * /api/incentives/report:
 *   get:
 *     tags: [IncentiveReport]
 *     summary: Get incentive report for a counsellor/period
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Incentive report
 *       400:
 *         description: Bad request — startDate and endDate are required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/manager/developer only
 * /api/incentives/report/all:
 *   get:
 *     tags: [IncentiveReport]
 *     summary: Get incentive report for all counsellors
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: End date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: All counsellors report
 *       400:
 *         description: Bad request — startDate and endDate are required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/breakdown/{incentiveRecordId}:
 *   get:
 *     tags: [IncentiveReport]
 *     summary: Get line-item breakdown for an incentive record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: incentiveRecordId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Breakdown rows
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/breakdown/action:
 *   post:
 *     tags: [IncentiveReport]
 *     summary: Apply an action to a breakdown row
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Action applied
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/action:
 *   post:
 *     tags: [IncentiveReport]
 *     summary: First-time APPROVE/REJECT/PENDING action on an incentive record
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Action created
 *       409:
 *         description: Already approved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [IncentiveReport]
 *     summary: Edit an existing incentive action (including approved records)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/bulk-approve:
 *   post:
 *     tags: [IncentiveReport]
 *     summary: Bulk approve multiple incentive records
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bulk approved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/report", requireAuth, canView, getIncentiveReportController);
router.get("/report/all", requireAuth, canView, getIncentiveReportAllController);
router.get("/breakdown/:incentiveRecordId", requireAuth, canView, getIncentiveBreakdownController);
router.post("/breakdown/action", requireAuth, canWrite, postIncentiveBreakdownActionController);
router.post("/action", requireAuth, canWrite, postIncentiveActionController);
router.put("/action", requireAuth, canWrite, putIncentiveActionController);
router.post("/bulk-approve", requireAuth, canWrite, postBulkApproveIncentivesController);

export default router;
