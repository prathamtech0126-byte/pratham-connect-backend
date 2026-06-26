import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getReportController, getSaleMetricSeriesController, getSaleReportDashboardController, getPaymentsListController } from "../controllers/report.controller";
import { getCounsellorReportController } from "../controllers/counsellorReport.controller";

const router = Router();

/**
 * @openapi
 * /api/reports:
 *   get:
 *     tags: [Reports]
 *     summary: Get team/counsellor report (role-scoped)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: monthly
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for beforeDate
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for afterDate
 *       - in: query
 *         name: managerId
 *         schema:
 *           type: integer
 *         description: Admin only — scope to a specific manager
 *       - in: query
 *         name: counsellorId
 *         schema:
 *           type: integer
 *         description: Manager only — scope to a specific counsellor
 *       - in: query
 *         name: saleTypeId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Report data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/developer only
 * /api/reports/sale-dashboard:
 *   get:
 *     tags: [Reports]
 *     summary: Get sales dashboard report (cards + categories + charts)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: monthly
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for beforeDate
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for afterDate
 *       - in: query
 *         name: managerId
 *         schema:
 *           type: integer
 *         description: Admin only — scope to a specific manager
 *       - in: query
 *         name: counsellorId
 *         schema:
 *           type: integer
 *         description: Manager/developer only — scope to a specific counsellor
 *     responses:
 *       200:
 *         description: Sales dashboard data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/reports/sale-graph-report:
 *   get:
 *     tags: [Reports]
 *     summary: Get 3-month sales metric series for graph
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: monthly
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [client, core_sale, core_product, other_product, overall_revenue]
 *           default: core_sale
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for beforeDate
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for afterDate
 *       - in: query
 *         name: managerId
 *         schema:
 *           type: integer
 *         description: Admin only — scope to a specific manager
 *       - in: query
 *         name: counsellorId
 *         schema:
 *           type: integer
 *         description: Manager only — scope to a specific counsellor
 *     responses:
 *       200:
 *         description: Metric series data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/reports/counsellor/{counsellorId}:
 *   get:
 *     tags: [Reports]
 *     summary: Get individual counsellor report
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: counsellorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Counsellor ID or "me"
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, weekly, monthly, yearly, custom]
 *           default: monthly
 *       - in: query
 *         name: beforeDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Required when filter=custom (alias startDate also accepted)
 *       - in: query
 *         name: afterDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Required when filter=custom (alias endDate also accepted)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for beforeDate
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Alias for afterDate
 *       - in: query
 *         name: saleTypeId
 *         schema:
 *           type: integer
 *         description: Alias saleType also accepted
 *     responses:
 *       200:
 *         description: Counsellor report
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/reports/payments-list:
 *   get:
 *     tags: [Reports]
 *     summary: Get payments list report
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [today, yesterday, today_and_yesterday, last_7_days, last_14_days, last_30_days, this_week, last_week, this_month, last_month, maximum, monthly, yearly, custom]
 *           default: today
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *         description: Required when filter=custom
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *         description: Required when filter=custom
 *       - in: query
 *         name: counsellorId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Payments list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — developer only
 */
router.get("/", requireAuth, requireRole("developer","admin", "manager"), getReportController);
router.get(
  "/sale-dashboard",
  requireAuth,
  requireRole("developer","admin", "manager"),
  getSaleReportDashboardController
);
router.get(
  "/sale-graph-report",
  requireAuth,
  requireRole("developer","admin", "manager"),
  getSaleMetricSeriesController
);
router.get("/counsellor/:counsellorId", requireAuth, requireRole("developer","admin", "manager", "counsellor"), getCounsellorReportController);
router.get("/payments-list", requireAuth, requireRole("developer"), getPaymentsListController);

export default router;