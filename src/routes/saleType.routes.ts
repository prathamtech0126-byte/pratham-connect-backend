import { Router } from "express";
import {
  createSaleTypeController,
  getSaleTypesController,
  updateSaleTypeController,
  deleteSaleTypeController,
} from "../controllers/saleType.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

/**
 * Admin only
 */
router.post("/", requireAuth, requireRole("admin"), preventDuplicateRequests, createSaleTypeController);
router.get("/", requireAuth, getSaleTypesController);
router.put("/:id", requireAuth, requireRole("admin"), preventDuplicateRequests, updateSaleTypeController);
router.delete("/:id", requireAuth, requireRole("admin"), preventDuplicateRequests, deleteSaleTypeController);

export default router;
