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

/**
 * @openapi
 * /api/sale-type-categories:
 *   get:
 *     tags: [SaleTypeCategories]
 *     summary: Get all sale type categories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of categories
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [SaleTypeCategories]
 *     summary: Create a sale type category
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/sale-type-categories/{id}:
 *   get:
 *     tags: [SaleTypeCategories]
 *     summary: Get a sale type category by ID
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
 *         description: Category
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags: [SaleTypeCategories]
 *     summary: Update a sale type category
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
 *     tags: [SaleTypeCategories]
 *     summary: Delete a sale type category
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
