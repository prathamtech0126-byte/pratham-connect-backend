// src/controllers/checklist.controller.ts
import { Request, Response } from "express";
import {
  getAllCategories,
  getCategoryBySlug,
  getAllCountries,
  insertCountry,
  getChecklists,
  getChecklistBySlug,
  getChecklistSections,
  searchItems,
  insertChecklist,
  insertSection,
  insertItem,
  getChecklistById,
  getSectionById,
  updateChecklistById,
  updateSectionById,
  updateItemById,
  deleteChecklistById,
  deleteSectionById,
  deleteItemById,
} from "../models/checklist.model";
import { redisGetJson, redisSetJson, redisDel } from "../config/redis";

const CACHE_TTL = 600; // 10 minutes

/* ============================================
   CATEGORIES
============================================ */

export const categoriesController = async (req: Request, res: Response) => {
  try {
    const cacheKey = "checklist:categories";
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const data = await getAllCategories();
    await redisSetJson(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const categoryBySlugController = async (req: Request, res: Response) => {
  try {
    const data = await getCategoryBySlug(req.params.slug);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Category not found" } });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   COUNTRIES
============================================ */

export const countriesController = async (req: Request, res: Response) => {
  try {
    const cacheKey = "checklist:countries";
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const data = await getAllCountries();
    await redisSetJson(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const createCountryController = async (req: Request, res: Response) => {
  try {
    const { name, code } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "name and code are required" },
      });
    }

    if (code.trim().length > 10) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "code must be 10 characters or fewer" },
      });
    }

    const country = await insertCountry({ name, code });

    // Invalidate countries cache so new entry shows immediately
    await redisDel("checklist:countries");

    res.status(201).json({ success: true, data: country });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({
        success: false,
        error: { code: "CONFLICT", message: "A country with that name or code already exists" },
      });
    }
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   CHECKLISTS
============================================ */

export const checklistsController = async (req: Request, res: Response) => {
  try {
    const { category, country, sub_type, page, limit, sort } = req.query;

    const result = await getChecklists({
      category: category as string | undefined,
      country: country as string | undefined,
      subType: sub_type as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sort: sort === "title" ? "title" : "display_order",
    });

    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const checklistBySlugController = async (req: Request, res: Response) => {
  try {
    const data = await getChecklistBySlug(req.params.slug);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Checklist not found" } });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const checklistSectionsController = async (req: Request, res: Response) => {
  try {
    const data = await getChecklistSections(req.params.slug);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Checklist not found" } });
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   ADMIN — CREATE CHECKLIST
============================================ */

export const createChecklistController = async (req: Request, res: Response) => {
  try {
    const { visaCategoryId, countryId, title, slug, subType, description, displayOrder, isActive } =
      req.body;

    if (!visaCategoryId || !title) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "visaCategoryId and title are required" },
      });
    }

    const checklist = await insertChecklist({
      visaCategoryId,
      countryId,
      title,
      slug,
      subType,
      description,
      displayOrder,
      isActive,
    });

    res.status(201).json({ success: true, data: checklist });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({
        success: false,
        error: { code: "CONFLICT", message: "A checklist with that slug already exists" },
      });
    }
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   ADMIN — CREATE SECTION
============================================ */

export const createSectionController = async (req: Request, res: Response) => {
  try {
    const { checklistId } = req.params;
    const { title, description, displayOrder, isConditional, conditionText } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "title is required" },
      });
    }

    const checklist = await getChecklistById(checklistId);
    if (!checklist) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Checklist not found" },
      });
    }

    const section = await insertSection({
      checklistId,
      title,
      description,
      displayOrder,
      isConditional,
      conditionText,
    });

    res.status(201).json({ success: true, data: section });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   ADMIN — CREATE ITEM
============================================ */

export const createItemController = async (req: Request, res: Response) => {
  try {
    const { sectionId } = req.params;
    const { name, notes, isMandatory, isConditional, conditionText, quantityNote, displayOrder } =
      req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "name is required" },
      });
    }

    const section = await getSectionById(sectionId);
    if (!section) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Section not found" },
      });
    }

    const item = await insertItem({
      sectionId,
      name,
      notes,
      isMandatory,
      isConditional,
      conditionText,
      quantityNote,
      displayOrder,
    });

    res.status(201).json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   ADMIN — UPDATE
============================================ */

export const updateChecklistController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, subType, countryId, visaCategoryId, displayOrder, isActive } = req.body;

    const existing = await getChecklistById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Checklist not found" } });
    }

    const updated = await updateChecklistById(id, { title, subType, countryId, visaCategoryId, displayOrder, isActive });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const updateSectionController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, displayOrder, isConditional, conditionText } = req.body;

    const existing = await getSectionById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Section not found" } });
    }

    const updated = await updateSectionById(id, { title, description, displayOrder, isConditional, conditionText });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const updateItemController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, notes, isMandatory, isConditional, conditionText, quantityNote, displayOrder } = req.body;

    const updated = await updateItemById(id, { name, notes, isMandatory, isConditional, conditionText, quantityNote, displayOrder });
    if (!updated) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Item not found" } });
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   ADMIN — DELETE
============================================ */

export const deleteChecklistController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await getChecklistById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Checklist not found" } });
    }

    await deleteChecklistById(id);
    await redisDel("checklist:categories"); // invalidate cached counts so tabs refresh
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const deleteSectionController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await getSectionById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Section not found" } });
    }

    await deleteSectionById(id);
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

export const deleteItemController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteItemById(id);
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};

/* ============================================
   SEARCH
============================================ */

export const searchController = async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || "").trim();
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: { code: "BAD_REQUEST", message: "q must be at least 2 characters" },
      });
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const result = await searchItems(q, page, limit);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err: any) {
    res
      .status(500)
      .json({ success: false, error: { code: "INTERNAL_ERROR", message: err.message } });
  }
};
