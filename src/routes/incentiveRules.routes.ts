import { Router } from "express";
import {
  getIncentiveRulesController,
  getSpouseRulesController,
  getVisitorRulesController,
  getCanadaStudentRulesController,
  getStudentRulesController,
  getAllFinanceRulesController,
  upsertIncentiveRulesController,
  upsertSpouseRulesController,
  upsertVisitorRulesController,
  upsertCanadaStudentRulesController,
  upsertStudentRulesController,
  upsertAllFinanceRulesController,
} from "../controllers/incentiveRules.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

const canWrite = requireRole("admin", "superadmin", "manager");

/**
 * @openapi
 * /api/incentives/rules:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get all incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All incentive rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Bulk replace all incentive rules (only keys present in body are touched)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/manager only
 * /api/incentives/rules/spouse:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get spouse incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Spouse rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Update spouse incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/rules/visitor:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get visitor incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Visitor rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Update visitor incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/rules/canada-student:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get Canada student incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Canada student rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Update Canada student incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/rules/student:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get student incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Update student incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/incentives/rules/all-finance:
 *   get:
 *     tags: [IncentiveRules]
 *     summary: Get all-finance incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All-finance rules
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [IncentiveRules]
 *     summary: Update all-finance incentive rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
// GET all rules
router.get("/rules",                requireAuth, getIncentiveRulesController);

// GET per group
router.get("/rules/spouse",         requireAuth, getSpouseRulesController);
router.get("/rules/visitor",        requireAuth, getVisitorRulesController);
router.get("/rules/canada-student", requireAuth, getCanadaStudentRulesController);
router.get("/rules/student",        requireAuth, getStudentRulesController);
router.get("/rules/all-finance",    requireAuth, getAllFinanceRulesController);

// PUT per group (each saves only its own group — other groups untouched)
router.put("/rules/spouse",         requireAuth, canWrite, upsertSpouseRulesController);
router.put("/rules/visitor",        requireAuth, canWrite, upsertVisitorRulesController);
router.put("/rules/canada-student", requireAuth, canWrite, upsertCanadaStudentRulesController);
router.put("/rules/student",        requireAuth, canWrite, upsertStudentRulesController);
router.put("/rules/all-finance",    requireAuth, canWrite, upsertAllFinanceRulesController);

// PUT all rules at once (bulk replace — only keys present in body are touched)
router.put("/rules",                requireAuth, canWrite, upsertIncentiveRulesController);

export default router;
