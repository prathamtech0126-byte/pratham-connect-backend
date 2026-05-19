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

router.get("/report", requireAuth, canView, getIncentiveReportController);
router.get("/report/all", requireAuth, canView, getIncentiveReportAllController);
router.get("/breakdown/:incentiveRecordId", requireAuth, canView, getIncentiveBreakdownController);
router.post("/breakdown/action", requireAuth, canWrite, postIncentiveBreakdownActionController);
router.post("/action", requireAuth, canWrite, postIncentiveActionController);
router.put("/action", requireAuth, canWrite, putIncentiveActionController);
router.post("/bulk-approve", requireAuth, canWrite, postBulkApproveIncentivesController);

export default router;
