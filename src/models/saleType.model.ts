import { db } from "../config/databaseConnection";
import { saleTypes } from "../schemas/saleType.schema";
import { eq } from "drizzle-orm";

/* ==============================
   TYPES
============================== */

interface CreateSaleTypeInput {
  saleType: string;
  amount?: string | null;
  isCoreProduct?: boolean;
}

interface UpdateSaleTypeInput {
  saleType?: string;
  amount?: string | null;
  isCoreProduct?: boolean;
}

/* ==============================
   CREATE
============================== */

export const createSaleType = async (data: CreateSaleTypeInput) => {
  if (!data.saleType) throw new Error("Sale type required");

  if (data.amount != null && Number(data.amount) <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const existing = await db
    .select()
    .from(saleTypes)
    .where(eq(saleTypes.saleType, data.saleType));

  if (existing.length) throw new Error("Sale type already exists");

  const [created] = await db
    .insert(saleTypes)
    .values({
      saleType: data.saleType,
      amount: data.amount ?? null,
      isCoreProduct: data.isCoreProduct ?? false,
    })
    .returning();

  return created;
};


/* ==============================
   GET ALL
============================== */

export const getAllSaleTypes = async () => {
  return db
    .select({
      id: saleTypes.saleTypeId,
      saleType: saleTypes.saleType,
      amount: saleTypes.amount,
      isCoreProduct: saleTypes.isCoreProduct,
      createdAt: saleTypes.createdAt,
    })
    .from(saleTypes);
};

/* ==============================
   UPDATE
============================== */
export const updateSaleType = async (
  id: number,
  data: UpdateSaleTypeInput
) => {
  const patch: Partial<typeof saleTypes.$inferInsert> = {};

  if (data.saleType !== undefined) {
    patch.saleType = data.saleType;
  }

  if (data.amount !== undefined) {
    patch.amount = data.amount; // string | null
  }

  if (data.isCoreProduct !== undefined) {
    patch.isCoreProduct = data.isCoreProduct;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }

  const [updated] = await db
    .update(saleTypes)
    .set(patch)
    .where(eq(saleTypes.saleTypeId, id))
    .returning();

  if (!updated) {
    throw new Error("Sale type not found");
  }

  return updated;
};


/* ==============================
   DELETE
============================== */

export const deleteSaleType = async (id: number) => {
  const deleted = await db
    .delete(saleTypes)
    .where(eq(saleTypes.saleTypeId, id))
    .returning();

  if (deleted.length === 0) {
    throw new Error("Sale type not found");
  }

  return { message: "Sale type deleted successfully" };
};
