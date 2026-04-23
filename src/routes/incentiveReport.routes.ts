import { Router } from "express";
import { getIncentiveReportController } from "../controllers/incentiveReport.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

const canView = requireRole("admin", "superadmin", "manager", "developer");

router.get("/report", requireAuth, canView, getIncentiveReportController);

export default router;
