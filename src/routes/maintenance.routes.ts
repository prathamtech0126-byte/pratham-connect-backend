import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  getMaintenanceStatusController,
  setMaintenanceStatusController,
} from "../controllers/maintenance.controller";

const router = Router();

// Public — frontend polls this to check if maintenance is active
router.get("/", getMaintenanceStatusController);

// Developer-only — toggle maintenance mode on/off
router.post("/", requireAuth, setMaintenanceStatusController);

export default router;
