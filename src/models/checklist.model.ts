// src/models/checklist.model.ts
import { db } from "../config/databaseConnection";
import {
  visaCategories,
  countries,
  checklists,
  documentSections,
  documentItems,
} from "../schemas/checklist.schema";
import { eq, ilike, and, inArray, count, asc } from "drizzle-orm";

/* ============================================
   CATEGORIES
============================================ */

export const getAllCategories = async () => {
  const cats = await db
    .select()
    .from(visaCategories)
    .orderBy(asc(visaCategories.displayOrder));

  if (cats.length === 0) return [];

  const catIds = cats.map((c) => c.id);
  const countRows = await db
    .select({ categoryId: checklists.visaCategoryId, total: count() })
    .from(checklists)
    .where(
      and(eq(checklists.isActive, true), inArray(checklists.visaCategoryId, catIds))
    )
    .groupBy(checklists.visaCategoryId);

  const countMap = new Map(countRows.map((r) => [r.categoryId, Number(r.total)]));

  return cats.map((cat) => ({
    ...cat,
    checklistCount: countMap.get(cat.id) ?? 0,
  }));
};

export const getCategoryBySlug = async (slug: string) => {
  const [cat] = await db
    .select()
    .from(visaCategories)
    .where(eq(visaCategories.slug, slug))
    .limit(1);

  if (!cat) return null;

  const catChecklists = await db
    .select()
    .from(checklists)
    .where(
      and(eq(checklists.visaCategoryId, cat.id), eq(checklists.isActive, true))
    )
    .orderBy(asc(checklists.displayOrder));

  return { ...cat, checklists: catChecklists };
};

/* ============================================
   COUNTRIES
============================================ */

export const getAllCountries = async () => {
  return db.select().from(countries).orderBy(asc(countries.name));
};

/* ============================================
   CHECKLISTS LIST
============================================ */

export interface ChecklistFilters {
  category?: string;
  country?: string;
  subType?: string;
  page?: number;
  limit?: number;
  sort?: "display_order" | "title";
}

export const getChecklists = async (filters: ChecklistFilters = {}) => {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;

  // Resolve category slug → id
  let categoryId: string | undefined;
  if (filters.category) {
    const [cat] = await db
      .select({ id: visaCategories.id })
      .from(visaCategories)
      .where(eq(visaCategories.slug, filters.category))
      .limit(1);
    if (cat) categoryId = cat.id;
    else return { data: [], meta: { total: 0, page, limit } };
  }

  // Resolve country code → id
  let countryId: string | undefined;
  if (filters.country) {
    const [cntry] = await db
      .select({ id: countries.id })
      .from(countries)
      .where(eq(countries.code, filters.country.toUpperCase()))
      .limit(1);
    if (cntry) countryId = cntry.id;
    else return { data: [], meta: { total: 0, page, limit } };
  }

  const conditions: any[] = [eq(checklists.isActive, true)];
  if (categoryId) conditions.push(eq(checklists.visaCategoryId, categoryId));
  if (countryId) conditions.push(eq(checklists.countryId, countryId));
  if (filters.subType) conditions.push(eq(checklists.subType, filters.subType));

  const whereClause = and(...conditions);

  const [{ total }] = await db
    .select({ total: count() })
    .from(checklists)
    .where(whereClause);

  const orderCol =
    filters.sort === "title" ? asc(checklists.title) : asc(checklists.displayOrder);

  const results = await db
    .select()
    .from(checklists)
    .where(whereClause)
    .orderBy(orderCol)
    .limit(limit)
    .offset(offset);

  if (results.length === 0) {
    return { data: [], meta: { total: Number(total), page, limit } };
  }

  const checklistIds = results.map((c) => c.id);

  const sectionCounts = await db
    .select({ checklistId: documentSections.checklistId, total: count() })
    .from(documentSections)
    .where(inArray(documentSections.checklistId, checklistIds))
    .groupBy(documentSections.checklistId);
  const sectionMap = new Map(sectionCounts.map((r) => [r.checklistId, Number(r.total)]));

  const itemCounts = await db
    .select({ checklistId: documentSections.checklistId, total: count() })
    .from(documentItems)
    .innerJoin(documentSections, eq(documentItems.sectionId, documentSections.id))
    .where(inArray(documentSections.checklistId, checklistIds))
    .groupBy(documentSections.checklistId);
  const itemMap = new Map(itemCounts.map((r) => [r.checklistId, Number(r.total)]));

  return {
    data: results.map((c) => ({
      ...c,
      sectionCount: sectionMap.get(c.id) ?? 0,
      itemCount: itemMap.get(c.id) ?? 0,
    })),
    meta: { total: Number(total), page, limit },
  };
};

/* ============================================
   FULL CHECKLIST (nested sections → items)
============================================ */

export const getChecklistBySlug = async (slug: string) => {
  const [checklist] = await db
    .select()
    .from(checklists)
    .where(and(eq(checklists.slug, slug), eq(checklists.isActive, true)))
    .limit(1);

  if (!checklist) return null;

  const sections = await db
    .select()
    .from(documentSections)
    .where(eq(documentSections.checklistId, checklist.id))
    .orderBy(asc(documentSections.displayOrder));

  if (sections.length === 0) {
    return { ...checklist, sections: [] };
  }

  const sectionIds = sections.map((s) => s.id);
  const items = await db
    .select()
    .from(documentItems)
    .where(inArray(documentItems.sectionId, sectionIds))
    .orderBy(asc(documentItems.displayOrder));

  const itemsBySection = items.reduce<Record<string, typeof items>>((acc, item) => {
    if (!acc[item.sectionId]) acc[item.sectionId] = [];
    acc[item.sectionId].push(item);
    return acc;
  }, {});

  return {
    ...checklist,
    sections: sections.map((s) => ({
      ...s,
      items: itemsBySection[s.id] ?? [],
    })),
  };
};

/* ============================================
   SECTIONS ONLY
============================================ */

export const getChecklistSections = async (slug: string) => {
  const [checklist] = await db
    .select({ id: checklists.id, title: checklists.title, slug: checklists.slug })
    .from(checklists)
    .where(and(eq(checklists.slug, slug), eq(checklists.isActive, true)))
    .limit(1);

  if (!checklist) return null;

  const sections = await db
    .select()
    .from(documentSections)
    .where(eq(documentSections.checklistId, checklist.id))
    .orderBy(asc(documentSections.displayOrder));

  return { ...checklist, sections };
};

/* ============================================
   SEARCH
============================================ */

export const searchItems = async (q: string, page = 1, limit = 20) => {
  const pageNum = Math.max(1, page);
  const limitNum = Math.min(100, Math.max(1, limit));
  const offset = (pageNum - 1) * limitNum;
  const pattern = `%${q}%`;

  const [{ total }] = await db
    .select({ total: count() })
    .from(documentItems)
    .innerJoin(documentSections, eq(documentItems.sectionId, documentSections.id))
    .innerJoin(checklists, eq(documentSections.checklistId, checklists.id))
    .where(and(ilike(documentItems.name, pattern), eq(checklists.isActive, true)));

  const results = await db
    .select({
      itemId: documentItems.id,
      itemName: documentItems.name,
      notes: documentItems.notes,
      isMandatory: documentItems.isMandatory,
      quantityNote: documentItems.quantityNote,
      sectionId: documentSections.id,
      sectionTitle: documentSections.title,
      checklistId: checklists.id,
      checklistTitle: checklists.title,
      checklistSlug: checklists.slug,
    })
    .from(documentItems)
    .innerJoin(documentSections, eq(documentItems.sectionId, documentSections.id))
    .innerJoin(checklists, eq(documentSections.checklistId, checklists.id))
    .where(and(ilike(documentItems.name, pattern), eq(checklists.isActive, true)))
    .orderBy(asc(documentItems.name))
    .limit(limitNum)
    .offset(offset);

  return {
    data: results,
    meta: { total: Number(total), page: pageNum, limit: limitNum },
  };
};
