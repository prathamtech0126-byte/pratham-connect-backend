import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { getBackendDashboardController } from "../controllers/backendDashboard.controller";
import { getBackendReportController } from "../controllers/backendReport.controller";
import { getBindingReportController } from "../controllers/bindingReport.controller";
import { getCxReportController } from "../controllers/cxReport.controller";
import { getEnrollmentTrendController } from "../controllers/enrollmentTrend.controller";
import { getOpsDashboardController } from "../controllers/opsDashboard.controller";

const router = Router();

/**
 * Modules reports API (DATABASE_URL_SECOND).
 * - backend-report: admin / manager / branch manager analytics (full report)
 * - enrollment-trend: admin / manager / branch manager (6 / 12 / max months chart)
 * - backend-dashboard: admin / manager / branch manager (team leaderboard)
 * - ops-dashboard: cx / binding / application (personal dashboard)
 * - cx-report: cx (personal performance report)
 * - binding-report: binding (personal performance report)
 */
router.get("/backend-report", requireAuth, getBackendReportController);
router.get("/enrollment-trend", requireAuth, getEnrollmentTrendController);
router.get("/backend-dashboard", requireAuth, getBackendDashboardController);
router.get("/ops-dashboard", requireAuth, getOpsDashboardController);
router.get("/cx-report", requireAuth, getCxReportController);
router.get("/binding-report", requireAuth, getBindingReportController);

export default router;
