import { Router } from "express";
import { requireAuth, requireRole } from "../../../middlewares/auth.middleware";
import {
  getDashboardStatsController,
  listFrontDeskLeads,
  getFrontDeskLeadDetailController,
  verifyLeadController,
  assignLeadController,
  updateLeadDetailsController,
  getCounsellorsForAssignment,
  getSaleTypesController,
  getActivityLogsController,
  exportLeadsController,
} from "../controllers/frontdesk.controller";

const router = Router();

const fd = [requireAuth, requireRole("front_desk", "developer")];
const fdActivity = [requireAuth, requireRole("front_desk", "developer", "admin", "superadmin")];

router.get("/stats", ...fd, getDashboardStatsController);
router.get("/leads", ...fd, listFrontDeskLeads);
router.get("/leads/export", ...fd, exportLeadsController);
router.get("/leads/:id", ...fd, getFrontDeskLeadDetailController);
router.post("/leads/:id/verify", ...fd, verifyLeadController);
router.post("/leads/:id/assign", ...fd, assignLeadController);
router.put("/leads/:id", ...fd, updateLeadDetailsController);
router.get("/counsellors", ...fd, getCounsellorsForAssignment);
router.get("/sale-types", ...fd, getSaleTypesController);
router.get("/activity", ...fdActivity, getActivityLogsController);

export default router;
