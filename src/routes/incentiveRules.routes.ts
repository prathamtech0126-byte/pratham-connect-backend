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
