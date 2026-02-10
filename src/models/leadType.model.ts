import { db } from "../config/databaseConnection";
import { saleTypes } from "../schemas/saleType.schema";
import { eq } from "drizzle-orm";
import { leadTypes } from "../schemas/leadType.schema";

/* ==============================
   TYPES
============================== */

interface CreateLeadTypeInput {
  leadType: string;
}

interface UpdateLeadTypeInput {
  leadType?: string;
}
/* ==============================
   CREATE
============================== */

export const createLeadType = async (data: CreateLeadTypeInput) => {
  if (!data.leadType) throw new Error("Lead type required");

  const existing = await db
    .select()
    .from(leadTypes)
    .where(eq(leadTypes.leadType, data.leadType));

  if (existing.length) throw new Error("Lead type already exists");

  const [created] = await db
    .insert(leadTypes)
    .values({
      leadType: data.leadType,
    })
    .returning();

  return created;
};


/* ==============================
   GET ALL
============================== */

        export const getAllLeadTypes = async () => {
  return db
    .select({
      id: leadTypes.id,
      leadType: leadTypes.leadType,
      createdAt: leadTypes.createdAt,
    })
    .from(leadTypes);
};

/* ==============================
   UPDATE
============================== */
export const updateLeadType = async (
  id: number,
  data: UpdateLeadTypeInput
) => {
  const patch: Partial<typeof leadTypes.$inferInsert> = {};

  if (data.leadType !== undefined) {
    patch.leadType = data.leadType;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }

  const [updated] = await db
    .update(leadTypes)
    .set(patch)
    .where(eq(leadTypes.id, id))
    .returning();

  if (!updated) {
    throw new Error("Lead type not found");
  }

  return updated;
};


/* ==============================
   DELETE
============================== */

export const deleteLeadType = async (id: number) => {
  const deleted = await db
    .delete(leadTypes)
    .where(eq(leadTypes.id, id))
    .returning();

  if (deleted.length === 0) {
    throw new Error("Lead type not found");
  }

  return { message: "Lead type deleted successfully" };
};
