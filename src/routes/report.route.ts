import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { getReportController } from "../controllers/report.controller";

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

export default router;