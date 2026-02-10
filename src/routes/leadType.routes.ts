import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";
import { createLeadTypeController, getLeadTypesController,updateLeadTypeController, deleteLeadTypeController } from "../controllers/leadType.controller";

const router = Router();

/**
 * Admin only
 */
router.post("/", requireAuth, requireRole("admin"), preventDuplicateRequests, createLeadTypeController);
router.get("/", requireAuth, getLeadTypesController);
router.put("/:id", requireAuth, requireRole("admin"), preventDuplicateRequests, updateLeadTypeController);
router.delete("/:id", requireAuth, requireRole("admin"), preventDuplicateRequests, deleteLeadTypeController);

export default router;
