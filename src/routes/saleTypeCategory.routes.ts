import { Router } from "express";
import {
  createSaleTypeCategoryController,
  getSaleTypeCategoriesController,
  getSaleTypeCategoryByIdController,
  updateSaleTypeCategoryController,
  deleteSaleTypeCategoryController,
} from "../controllers/saleTypeCategory.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";

const router = Router();

router.get("/", requireAuth, getSaleTypeCategoriesController);
router.get("/:id", requireAuth, getSaleTypeCategoryByIdController);
router.post(
  "/",
  requireAuth,
  requireRole("developer","admin"),
  preventDuplicateRequests,
  createSaleTypeCategoryController
);
router.put(
  "/:id",
  requireAuth,
  requireRole("developer","admin"),
  preventDuplicateRequests,
  updateSaleTypeCategoryController
);
router.delete(
  "/:id",
  requireAuth,
  requireRole("developer","admin"),
  preventDuplicateRequests,
  deleteSaleTypeCategoryController
);

export default router;
