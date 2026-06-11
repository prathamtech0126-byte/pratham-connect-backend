import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  getMaintenanceStatusController,
  setMaintenanceStatusController,
} from "../controllers/maintenance.controller";

const router = Router();

/**
 * @openapi
 * /api/maintenance:
 *   get:
 *     tags: [Maintenance]
 *     summary: Get current maintenance mode status (public)
 *     responses:
 *       200:
 *         description: Maintenance status
 *   post:
 *     tags: [Maintenance]
 *     summary: Toggle maintenance mode on/off
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status updated
 *       401:
 *         description: Unauthorized
 */
router.get("/", getMaintenanceStatusController);
router.post("/", requireAuth, setMaintenanceStatusController);

export default router;
