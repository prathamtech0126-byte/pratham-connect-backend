import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getReportController, getSaleMetricSeriesController, getSaleReportDashboardController } from "../controllers/report.controller";
import { getCounsellorReportController } from "../controllers/counsellorReport.controller";

const router = Router();

// Get report (role-based access)
// - Admin: All reports
// - Manager: Only reports for their team
// - Counsellor: Only their own reports
//
// Query parameters:
// - filter: "today" | "weekly" | "monthly" | "yearly" | "custom" (default: "monthly")
// - beforeDate: YYYY-MM-DD (required for custom filter)
// - afterDate: YYYY-MM-DD (required for custom filter)
// - GET /api/reports?filter=today
// - GET /api/reports?filter=custom&beforeDate=2026-01-01&afterDate=2026-01-31
// - GET /api/reports?filter=weekly
// - GET /api/reports?filter=monthly
// - GET /api/reports?filter=yearly
// - GET /api/reports?filter=today&saleTypeId=1
// - GET /api/reports?filter=monthly&saleTypeId=2
// - GET /api/reports?filter=weekly&saleTypeId=3
// - GET /api/reports?filter=yearly&saleTypeId=4
// - GET /api/reports?filter=custom&startDate=2026-01-01&endDate=2026-01-31&saleTypeId=1

router.get("/", requireAuth, requireRole("admin", "manager"), getReportController);

// Sales report dashboard data (cards + categories + charts)
// - GET /api/reports/sale-dashboard?filter=monthly
// - GET /api/reports/sale-dashboard?filter=custom&startDate=2026-01-01&endDate=2026-01-31
// - Admin can scope by managerId, manager can scope by counsellorId
router.get(
  "/sale-dashboard",
  requireAuth,
  requireRole("admin", "manager"),
  getSaleReportDashboardController
);

// Sales metric series for 3-month graph (fixed monthly comparison)
// - GET /api/reports/sale-graph-report?metric=core_sale
// - Admin can scope by managerId, manager can scope by counsellorId
// - metric: client | core_sale | core_product | other_product | overall_revenue
router.get(
  "/sale-graph-report",
  requireAuth,
  requireRole("admin", "manager"),
  getSaleMetricSeriesController
);

// Individual counsellor report
// - Admin: any counsellor
// - Manager (isSupervisor=true): any counsellor
// - Manager (isSupervisor=false): only own team counsellors
// - Counsellor: own report only (use "me" or own id)
//
// - GET /api/reports/counsellor/5?filter=monthly
// - GET /api/reports/counsellor/me?filter=today          (counsellor role only)
// - GET /api/reports/counsellor/12?filter=custom&startDate=2026-01-01&endDate=2026-01-31
router.get("/counsellor/:counsellorId", requireAuth, requireRole("admin", "manager", "counsellor"), getCounsellorReportController);

export default router;