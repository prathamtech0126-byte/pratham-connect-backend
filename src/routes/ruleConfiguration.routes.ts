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

/**
 * @openapi
 * /api/rule-configurations:
 *   get:
 *     tags: [RuleConfigurations]
 *     summary: Get all rule configurations
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of rule configurations
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/manager/developer only
 *   post:
 *     tags: [RuleConfigurations]
 *     summary: Create a rule configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/rule-configurations/{id}:
 *   get:
 *     tags: [RuleConfigurations]
 *     summary: Get a rule configuration by ID
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
 *         description: Rule configuration
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [RuleConfigurations]
 *     summary: Update a rule configuration
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
 *   delete:
 *     tags: [RuleConfigurations]
 *     summary: Delete a rule configuration
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
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/",       requireAuth, canAccess, getAllRuleConfigurationsController);
router.get("/:id",    requireAuth, canAccess, getRuleConfigurationByIdController);

router.post("/",      requireAuth, canAccess, createRuleConfigurationController);
router.put("/:id",    requireAuth, canAccess, updateRuleConfigurationController);
router.delete("/:id", requireAuth, canAccess, deleteRuleConfigurationController);

export default router;
