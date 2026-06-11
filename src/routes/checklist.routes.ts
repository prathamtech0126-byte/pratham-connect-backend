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

/**
 * @openapi
 * /api/v1/categories:
 *   get:
 *     tags: [Checklist]
 *     summary: Get all checklist categories (public)
 *     security: []
 *     responses:
 *       200:
 *         description: List of categories
 * /api/v1/categories/{slug}:
 *   get:
 *     tags: [Checklist]
 *     summary: Get a category by slug (public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Category
 * /api/v1/countries:
 *   get:
 *     tags: [Checklist]
 *     summary: Get all countries (public)
 *     security: []
 *     responses:
 *       200:
 *         description: List of countries
 * /api/v1/checklists:
 *   get:
 *     tags: [Checklist]
 *     summary: Get all checklists (public)
 *     security: []
 *     responses:
 *       200:
 *         description: List of checklists
 * /api/v1/checklists/{slug}/sections:
 *   get:
 *     tags: [Checklist]
 *     summary: Get sections for a checklist (public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Checklist sections
 * /api/v1/checklists/{slug}:
 *   get:
 *     tags: [Checklist]
 *     summary: Get a checklist by slug (public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Checklist
 * /api/v1/search:
 *   get:
 *     tags: [Checklist]
 *     summary: Search checklists (public)
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 * /api/v1/admin/countries:
 *   post:
 *     tags: [Checklist]
 *     summary: Create a country
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/superadmin/developer only
 * /api/v1/admin/checklists:
 *   post:
 *     tags: [Checklist]
 *     summary: Create a checklist
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/v1/admin/checklists/{checklistId}/sections:
 *   post:
 *     tags: [Checklist]
 *     summary: Add a section to a checklist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: checklistId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Section created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/v1/admin/sections/{sectionId}/items:
 *   post:
 *     tags: [Checklist]
 *     summary: Add an item to a section
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sectionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Item created
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/v1/admin/checklists/{id}:
 *   put:
 *     tags: [Checklist]
 *     summary: Update a checklist
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
 *     tags: [Checklist]
 *     summary: Delete a checklist
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
 * /api/v1/admin/sections/{id}:
 *   put:
 *     tags: [Checklist]
 *     summary: Update a section
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
 *     tags: [Checklist]
 *     summary: Delete a section
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
 * /api/v1/admin/items/{id}:
 *   put:
 *     tags: [Checklist]
 *     summary: Update a checklist item
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
 *     tags: [Checklist]
 *     summary: Delete a checklist item
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
