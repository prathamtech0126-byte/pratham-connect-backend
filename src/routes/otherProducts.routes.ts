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

// Routes
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