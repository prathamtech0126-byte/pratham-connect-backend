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

/**
 * @openapi
 * /api/front-desk/stats:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Get front desk dashboard stats
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *     responses:
 *       200:
 *         description: Dashboard stats
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — front_desk/developer only
 * /api/front-desk/leads:
 *   get:
 *     tags: [FrontDesk]
 *     summary: List front desk leads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by lead name
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-05-31"
 *       - in: query
 *         name: isVerified
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *       - in: query
 *         name: leadType
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: List of leads
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/leads/export:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Export front desk leads
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Export file
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/leads/{id}:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Get front desk lead detail
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lead detail
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [FrontDesk]
 *     summary: Update a front desk lead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/leads/{id}/verify:
 *   post:
 *     tags: [FrontDesk]
 *     summary: Verify a lead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Verified
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/leads/{id}/assign:
 *   post:
 *     tags: [FrontDesk]
 *     summary: Assign a lead to a counsellor
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Assigned
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/counsellors:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Get counsellors available for assignment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of counsellors
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/sale-types:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Get sale types (front desk view)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sale types
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/front-desk/activity:
 *   get:
 *     tags: [FrontDesk]
 *     summary: Get front desk activity log
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Activity log
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
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
