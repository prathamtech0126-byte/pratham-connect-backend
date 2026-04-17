// src/routes/checklist.routes.ts
import { Router } from "express";
import {
  categoriesController,
  categoryBySlugController,
  countriesController,
  createCountryController,
  checklistsController,
  checklistBySlugController,
  checklistSectionsController,
  searchController,
  createChecklistController,
  createSectionController,
  createItemController,
  updateChecklistController,
  updateSectionController,
  updateItemController,
  deleteChecklistController,
  deleteSectionController,
  deleteItemController,
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
  "/admin/countries",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  createCountryController
);
router.post(
  "/admin/checklists",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  createChecklistController
);
router.post(
  "/admin/checklists/:checklistId/sections",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  createSectionController
);
router.post(
  "/admin/sections/:sectionId/items",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  createItemController
);

// Admin update routes
router.put(
  "/admin/checklists/:id",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  updateChecklistController
);
router.put(
  "/admin/sections/:id",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  updateSectionController
);
router.put(
  "/admin/items/:id",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  updateItemController
);

// Admin delete routes
router.delete(
  "/admin/checklists/:id",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  deleteChecklistController
);
router.delete(
  "/admin/sections/:id",
  requireAuth,
  requireRole("admin", "superadmin","developer"),
  deleteSectionController
);
router.delete(
  "/admin/items/:id",
  requireAuth,
  requireRole("admin", "superadmin", "developer"),
  deleteItemController
);

export default router;
