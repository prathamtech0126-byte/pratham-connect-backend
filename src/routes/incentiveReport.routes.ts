import { Router } from "express";
import { getIncentiveReportController } from "../controllers/incentiveReport.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.get("/report", requireAuth, getIncentiveReportController);

export default router;
