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
} from "../controllers/checklist.controller";

const router = Router();

router.get("/categories", categoriesController);
router.get("/categories/:slug", categoryBySlugController);
router.get("/countries", countriesController);
router.get("/checklists", checklistsController);
// /sections must come before /:slug to avoid route shadowing
router.get("/checklists/:slug/sections", checklistSectionsController);
router.get("/checklists/:slug", checklistBySlugController);
router.get("/search", searchController);

export default router;
