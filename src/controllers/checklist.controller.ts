// src/controllers/checklist.controller.ts
import { Request, Response } from "express";
import {
  getAllCategories,
  getCategoryBySlug,
  getAllCountries,
  getChecklists,
  getChecklistBySlug,
  getChecklistSections,
  searchItems,
  insertChecklist,
  insertSection,
  insertItem,
  getChecklistById,
  getSectionById,
} from "../models/checklist.model";
import { redisGetJson, redisSetJson } from "../config/redis";

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
