import { db } from "../config/databaseConnection";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { eq, asc, sql } from "drizzle-orm";

export interface CreateSaleTypeCategoryInput {
  name: string;
  description?: string | null;
}

export interface UpdateSaleTypeCategoryInput {
  name?: string;
  description?: string | null;
}

export const createSaleTypeCategory = async (
  data: CreateSaleTypeCategoryInput
) => {
  if (!data.name?.trim()) throw new Error("Category name required");

  const nameTrimmed = data.name.trim();
  const nameNormalized = nameTrimmed.toLowerCase();
  const existing = await db
    .select()
    .from(saleTypeCategories)
    .where(sql`LOWER(${saleTypeCategories.name}) = LOWER(${nameTrimmed})`);

  if (existing.length)
    throw new Error(
      "Category name already exists (names are unique regardless of uppercase/lowercase)"
    );

  const [created] = await db
    .insert(saleTypeCategories)
    .values({
      name: nameNormalized,
      description: data.description?.trim() ?? null,
    })
    .returning();

  return created;
};

export const getAllSaleTypeCategories = async () => {
  return db
    .select()
    .from(saleTypeCategories)
    .orderBy(asc(saleTypeCategories.name));
};

export const getSaleTypeCategoryById = async (id: number) => {
  const [row] = await db
    .select()
    .from(saleTypeCategories)
    .where(eq(saleTypeCategories.id, id));
  return row ?? null;
};

export const updateSaleTypeCategory = async (
  id: number,
  data: UpdateSaleTypeCategoryInput
) => {
  const patch: Partial<typeof saleTypeCategories.$inferInsert> = {};
  if (data.name !== undefined) {
    patch.name = data.name.trim().toLowerCase();
  }
  if (data.description !== undefined)
    patch.description = data.description?.trim() ?? null;

  if (Object.keys(patch).length === 0) throw new Error("No fields to update");

  if (patch.name !== undefined) {
    const existing = await db
      .select()
      .from(saleTypeCategories)
      .where(sql`LOWER(${saleTypeCategories.name}) = LOWER(${patch.name})`);
    if (existing.length && existing[0].id !== id)
      throw new Error(
        "Category name already exists (names are unique regardless of uppercase/lowercase)"
      );
  }

  const [updated] = await db
    .update(saleTypeCategories)
    .set(patch)
    .where(eq(saleTypeCategories.id, id))
    .returning();

  if (!updated) throw new Error("Category not found");
  return updated;
};

export const deleteSaleTypeCategory = async (id: number) => {
  const deleted = await db
    .delete(saleTypeCategories)
    .where(eq(saleTypeCategories.id, id))
    .returning();
  if (deleted.length === 0) throw new Error("Category not found");
  return { message: "Category deleted successfully" };
};
