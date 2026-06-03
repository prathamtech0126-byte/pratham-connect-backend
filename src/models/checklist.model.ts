// src/models/checklist.model.ts
import { db } from "../config/databaseConnection";
import {
  visaCategories,
  countries,
  checklists,
  documentSections,
  documentItems,
} from "../schemas/checklist.schema";
import { eq, ilike, and, or, isNull, inArray, count, asc, SQL, sql } from "drizzle-orm";

/* ============================================
   SLUG UTILITY
============================================ */

const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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

export const insertCountry = async (input: { name: string; code: string }) => {
  const [row] = await db
    .insert(countries)
    .values({ name: input.name.trim(), code: input.code.trim().toUpperCase() })
    .returning();
  return row;
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

  // Resolve category slug → id and country code → id concurrently
  const [catResult, cntryResult] = await Promise.all([
    filters.category
      ? db.select({ id: visaCategories.id }).from(visaCategories)
          .where(eq(visaCategories.slug, filters.category)).limit(1)
      : Promise.resolve([] as { id: string }[]),
    filters.country
      ? db.select({ id: countries.id }).from(countries)
          .where(eq(countries.code, filters.country.toUpperCase())).limit(1)
      : Promise.resolve([] as { id: string }[]),
  ]);

  if (filters.category && catResult.length === 0) {
    return { data: [], meta: { total: 0, page, limit } };
  }
  if (filters.country && cntryResult.length === 0) {
    return { data: [], meta: { total: 0, page, limit } };
  }

  const categoryId = catResult[0]?.id;
  const countryId = cntryResult[0]?.id;

  const conditions: SQL[] = [eq(checklists.isActive, true)];
  if (categoryId) conditions.push(eq(checklists.visaCategoryId, categoryId));
  if (countryId) conditions.push(
    or(eq(checklists.countryId, countryId), isNull(checklists.countryId))!
  );
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
  const trimmed = q.trim();
  if (!trimmed) {
    return { data: [], meta: { total: 0, page: pageNum, limit: limitNum } };
  }
  const pattern = `%${trimmed}%`;
  const offset = (pageNum - 1) * limitNum;

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

/* ============================================
   ADMIN — CREATE
============================================ */

export interface CreateChecklistInput {
  visaCategoryId: string;
  countryId?: string;
  title: string;
  slug?: string;
  subType?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

const uniqueSlug = async (base: string): Promise<string> => {
  // Check if base slug is free; if not, try base-2, base-3, …
  const [existing] = await db
    .select({ slug: checklists.slug })
    .from(checklists)
    .where(eq(checklists.slug, base))
    .limit(1);

  if (!existing) return base;

  // Find all slugs that start with "base-" followed by a number
  const rows = await db
    .select({ slug: checklists.slug })
    .from(checklists)
    .where(ilike(checklists.slug, `${base}-%`));

  const taken = new Set(rows.map((r) => r.slug));
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
};

export const insertChecklist = async (input: CreateChecklistInput) => {
  const baseSlug = input.slug?.trim() || slugify(input.title);
  const slug = await uniqueSlug(baseSlug);

  const [row] = await db
    .insert(checklists)
    .values({
      visaCategoryId: input.visaCategoryId,
      countryId: input.countryId ?? null,
      title: input.title.trim(),
      slug,
      subType: input.subType ?? null,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      isActive: input.isActive ?? true,
    })
    .returning();

  return row;
};

export const getChecklistById = async (id: string) => {
  const [row] = await db
    .select()
    .from(checklists)
    .where(eq(checklists.id, id))
    .limit(1);
  return row ?? null;
};

export interface CreateSectionInput {
  checklistId: string;
  title: string;
  description?: string;
  displayOrder?: number;
  isConditional?: boolean;
  conditionText?: string;
}

export const insertSection = async (input: CreateSectionInput) => {
  const [row] = await db
    .insert(documentSections)
    .values({
      checklistId: input.checklistId,
      title: input.title.trim(),
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      isConditional: input.isConditional ?? false,
      conditionText: input.conditionText ?? null,
    })
    .returning();

  return row;
};

export const getSectionById = async (id: string) => {
  const [row] = await db
    .select()
    .from(documentSections)
    .where(eq(documentSections.id, id))
    .limit(1);
  return row ?? null;
};

export interface CreateItemInput {
  sectionId: string;
  name: string;
  notes?: string;
  isMandatory?: boolean;
  isConditional?: boolean;
  conditionText?: string;
  quantityNote?: string;
  displayOrder?: number;
}

export const insertItem = async (input: CreateItemInput) => {
  const [row] = await db
    .insert(documentItems)
    .values({
      sectionId: input.sectionId,
      name: input.name.trim(),
      notes: input.notes ?? null,
      isMandatory: input.isMandatory ?? true,
      isConditional: input.isConditional ?? false,
      conditionText: input.conditionText ?? null,
      quantityNote: input.quantityNote ?? null,
      displayOrder: input.displayOrder ?? 0,
    })
    .returning();

  return row;
};

/* ============================================
   ADMIN — UPDATE
============================================ */

export const updateChecklistById = async (
  id: string,
  input: {
    title?: string;
    subType?: string | null;
    countryId?: string | null;
    visaCategoryId?: string;
    displayOrder?: number;
    isActive?: boolean;
  }
) => {
  const [row] = await db
    .update(checklists)
    .set({ ...input, updatedAt: sql`NOW()` })
    .where(eq(checklists.id, id))
    .returning();
  return row ?? null;
};

export const updateSectionById = async (
  id: string,
  input: {
    title?: string;
    description?: string | null;
    displayOrder?: number;
    isConditional?: boolean;
    conditionText?: string | null;
  }
) => {
  const [row] = await db
    .update(documentSections)
    .set(input)
    .where(eq(documentSections.id, id))
    .returning();
  return row ?? null;
};

export const updateItemById = async (
  id: string,
  input: {
    name?: string;
    notes?: string | null;
    isMandatory?: boolean;
    isConditional?: boolean;
    conditionText?: string | null;
    quantityNote?: string | null;
    displayOrder?: number;
  }
) => {
  const [row] = await db
    .update(documentItems)
    .set(input)
    .where(eq(documentItems.id, id))
    .returning();
  return row ?? null;
};

/* ============================================
   ADMIN — DELETE
============================================ */

export const deleteChecklistById = async (id: string) => {
  await db.delete(checklists).where(eq(checklists.id, id));
};

export const deleteSectionById = async (id: string) => {
  await db.delete(documentSections).where(eq(documentSections.id, id));
};

export const deleteItemById = async (id: string) => {
  await db.delete(documentItems).where(eq(documentItems.id, id));
};
