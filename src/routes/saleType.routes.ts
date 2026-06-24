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
 * @openapi
 * /api/sale-types:
 *   get:
 *     tags: [SaleTypes]
 *     summary: Get all sale types
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sale types
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [SaleTypes]
 *     summary: Create a sale type
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/sale-types/{id}:
 *   put:
 *     tags: [SaleTypes]
 *     summary: Update a sale type
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
 *     tags: [SaleTypes]
 *     summary: Delete a sale type
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
router.post("/", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, createSaleTypeController);
router.get("/", requireAuth, getSaleTypesController);
router.put("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, updateSaleTypeController);
router.delete("/:id", requireAuth, requireRole("developer","admin"), preventDuplicateRequests, deleteSaleTypeController);

export default router;
