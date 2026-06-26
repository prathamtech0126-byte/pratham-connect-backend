import { Router } from "express";
import * as otherProductsController from "../controllers/otherProducts.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

// Define roles that have access
const ADMIN_DEV_ROLES = ["admin", "superadmin", "developer"] as const;

// Apply authentication to ALL routes
router.use(requireAuth);

// Apply role check to ALL routes - spread the array as arguments
router.use(requireRole(...ADMIN_DEV_ROLES));

/**
 * @openapi
 * /api/other-products:
 *   get:
 *     tags: [OtherProducts]
 *     summary: Get all other products (soft-deleted excluded)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of products
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/developer only
 *   post:
 *     tags: [OtherProducts]
 *     summary: Create an other product
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/other-products/grouped:
 *   get:
 *     tags: [OtherProducts]
 *     summary: Get other products grouped by category
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Products grouped by category
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/other-products/categories:
 *   get:
 *     tags: [OtherProducts]
 *     summary: Get distinct product categories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of categories
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/other-products/bulk/status:
 *   post:
 *     tags: [OtherProducts]
 *     summary: Bulk update product status (soft-delete / restore)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/other-products/{id}:
 *   get:
 *     tags: [OtherProducts]
 *     summary: Get an other product by ID
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
 *         description: Product
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *   put:
 *     tags: [OtherProducts]
 *     summary: Update an other product
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
 *     tags: [OtherProducts]
 *     summary: Soft-delete an other product
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
 *         description: Soft-deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/other-products/{id}/permanent:
 *   delete:
 *     tags: [OtherProducts]
 *     summary: Permanently delete an other product
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
 *         description: Permanently deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/", otherProductsController.getProducts);
router.get("/grouped", otherProductsController.getProductsByCategory);
router.get("/categories", otherProductsController.getCategories);
router.get("/:id", otherProductsController.getProduct);
router.post("/", otherProductsController.createProduct);
router.put("/:id", otherProductsController.updateProduct);
router.delete("/:id", otherProductsController.deleteProduct);
router.delete("/:id/permanent", otherProductsController.hardDeleteProduct);
router.post("/bulk/status", otherProductsController.bulkUpdateStatus);

export default router;