// src/routes/checklist.routes.ts
import { Router } from "express";
import {
  categoriesController,
  categoryBySlugController,
  countriesController,
  checklistsController,
  checklistBySlugController,
  checklistSectionsController,
  searchController,
  createChecklistController,
  createSectionController,
  createItemController,
} from "../controllers/checklist.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

// Public read routes
router.get("/categories", categoriesController);
router.get("/categories/:slug", categoryBySlugController);
router.get("/countries", countriesController);
router.get("/checklists", checklistsController);
// /sections must come before /:slug to avoid route shadowing
router.get("/checklists/:slug/sections", checklistSectionsController);
router.get("/checklists/:slug", checklistBySlugController);
router.get("/search", searchController);

// Admin write routes
router.post(
  "/admin/checklists",
  requireAuth,
  requireRole("admin", "superadmin"),
  createChecklistController
);
router.post(
  "/admin/checklists/:checklistId/sections",
  requireAuth,
  requireRole("admin", "superadmin"),
  createSectionController
);
router.post(
  "/admin/sections/:sectionId/items",
  requireAuth,
  requireRole("admin", "superadmin"),
  createItemController
);

export default router;
