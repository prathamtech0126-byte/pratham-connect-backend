import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getReportController } from "../controllers/report.controller";
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

router.get("/", requireAuth, requireRole("admin", "manager", "counsellor"), getReportController);

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