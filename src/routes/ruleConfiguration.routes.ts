import { Router } from "express";
import {
  getAllRuleConfigurationsController,
  getRuleConfigurationByIdController,
  createRuleConfigurationController,
  updateRuleConfigurationController,
  deleteRuleConfigurationController,
} from "../controllers/ruleConfiguration.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

const canAccess = requireRole("admin", "superadmin", "manager", "developer");

router.get("/",       requireAuth, canAccess, getAllRuleConfigurationsController);
router.get("/:id",    requireAuth, canAccess, getRuleConfigurationByIdController);

router.post("/",      requireAuth, canAccess, createRuleConfigurationController);
router.put("/:id",    requireAuth, canAccess, updateRuleConfigurationController);
router.delete("/:id", requireAuth, canAccess, deleteRuleConfigurationController);

export default router;
