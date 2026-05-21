import { db } from "../../config/databaseConnection";
import { eq, inArray, sql } from "drizzle-orm";
import { leadTypes } from "../schemas/leadType.schema";
import { leads } from "../schemas/leads.schema";

/**
 * Status filter accepted by {@link getAllLeadTypes}.
 *  - "active"   → only rows with `is_archived = false` (default; what dropdowns use)
 *  - "archived" → only rows with `is_archived = true`  (for the archived list view)
 *  - "all"      → both, e.g. for admin debugging
 */
export type LeadTypeStatusFilter = "active" | "archived" | "all";

/**
 * Canonical slug for `lead_type.lead_type` and `leads.lead_type`:
 * trim → lowercase → spaces/hyphens → underscores → strip non [a-z0-9_].
 * Examples: "Facebook" → "facebook", "Walk In" → "walk_in".
 */
export const normalizeLeadTypeSlug = (raw: string | null | undefined): string => {
  if (raw == null) return "";
  let s = String(raw).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/[\s\-]+/g, "_");
  s = s.replace(/[^a-z0-9_]/g, "");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return s;
};

/* ==============================
   TYPES
============================== */

interface CreateLeadTypeInput {
  leadType: string;
  displayAlias?: string | null;
}

interface UpdateLeadTypeInput {
  leadType?: string;
  displayAlias?: string | null;
}

/* ==============================
   RESERVED SYSTEM TYPES
   These rows are seeded automatically on server boot and cannot be deleted.
   Used by the Meta (Facebook/Instagram) automation to tag imported leads
   so they can be filtered by lead source/type from the UI.
============================== */

const RESERVED_SYSTEM_TYPES = [
  "facebook",
  "instagram",
  "udaan",
  "walk_in",
  "web_site",
] as const;

const RESERVED_DISPLAY_ALIASES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  udaan: "Udaan",
  walk_in: "Walk In",
  web_site: "Website",
};
export type SystemLeadType = (typeof RESERVED_SYSTEM_TYPES)[number];

/**
 * Idempotently ensure the system lead-type rows ("facebook", "instagram")
 * exist in the `lead_type` table. Safe to call on every server boot.
 */
export const ensureSystemLeadTypes = async (): Promise<void> => {
  try {
    const existing = await db
      .select({ leadType: leadTypes.leadType })
      .from(leadTypes)
      .where(inArray(leadTypes.leadType, RESERVED_SYSTEM_TYPES as unknown as string[]));

    const have = new Set(existing.map((r) => r.leadType));
    const missing = RESERVED_SYSTEM_TYPES.filter((t) => !have.has(t));
    if (missing.length === 0) return;

    await db
      .insert(leadTypes)
      .values(
        missing.map((leadType) => ({
          leadType,
          displayAlias: RESERVED_DISPLAY_ALIASES[leadType] ?? leadType,
        }))
      )
      .onConflictDoNothing();
  } catch (err) {
    // Non-fatal: don't crash the server if seeding fails (e.g. on first boot
    // before migrations run). Subsequent boots will retry.
    console.warn("⚠️ ensureSystemLeadTypes failed:", (err as Error)?.message);
  }
};

/**
 * Resolve a Meta `platform` value (commonly "fb" / "ig", but the API can also
 * return the full names "facebook" / "instagram") into the canonical lead-type
 * label stored on the lead row.
 * Returns `null` when the platform is unknown — caller should leave leadType unset.
 */
export const mapPlatformToLeadType = (
  platform: string | null | undefined
): SystemLeadType | null => {
  const p = (platform ?? "").trim().toLowerCase();
  if (p === "fb" || p === "facebook") return "facebook";
  if (p === "ig" || p === "instagram") return "instagram";
  return null;
};

/* ==============================
   CREATE
============================== */

export const createLeadType = async (data: CreateLeadTypeInput) => {
  const leadType = normalizeLeadTypeSlug(data.leadType);

  if (!leadType) {
    throw new Error("Lead type required");
  }

  const existing = await db
    .select()
    .from(leadTypes)
    .where(eq(leadTypes.leadType, leadType));

  if (existing.length > 0) {
    throw new Error("Lead type already exists");
  }

  const displayAlias =
    data.displayAlias?.trim() ||
    data.leadType.trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const [created] = await db
    .insert(leadTypes)
    .values({
      leadType,
      displayAlias,
    })
    .returning();

  return created;
};

/* ==============================
   GET ALL
============================== */

/**
 * List lead-type catalog rows.
 * Defaults to `status="active"` so the lead-source dropdown never shows archived rows.
 */
export const getAllLeadTypes = async (
  status: LeadTypeStatusFilter = "active"
) => {
  const base = db
    .select({
      id: leadTypes.id,
      leadType: leadTypes.leadType,
      displayAlias: leadTypes.displayAlias,
      isArchived: leadTypes.isArchived,
      createdAt: leadTypes.createdAt,
    })
    .from(leadTypes);

  if (status === "active") return base.where(eq(leadTypes.isArchived, false));
  if (status === "archived") return base.where(eq(leadTypes.isArchived, true));
  return base; // "all"
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
    const newType = normalizeLeadTypeSlug(data.leadType);

    if (!newType) {
      throw new Error("Lead type required");
    }

    patch.leadType = newType;
  }

  if (data.displayAlias !== undefined) {
    patch.displayAlias = data.displayAlias?.trim() || null;
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
   ARCHIVE  (soft-delete)
============================== */

/**
 * Soft-delete a lead type. We never physically remove the row because
 * historical leads keep their stored slug in `leads.lead_source` and we want
 * the catalog row around for traceability.
 *
 * Refuses to archive if:
 *  - the row doesn't exist
 *  - the row is one of the reserved system types ("facebook" / "instagram")
 *  - the row is already archived
 *  - the slug is currently referenced by any `leads.lead_source`
 */
export const archiveLeadType = async (id: number) => {
  const existing = await db
    .select()
    .from(leadTypes)
    .where(eq(leadTypes.id, id));

  if (!existing.length) {
    throw new Error("Lead type not found");
  }

  const row = existing[0];
  const currentType = row.leadType;

  if (row.isArchived) {
    throw new Error("Lead type is already archived");
  }

  if ((RESERVED_SYSTEM_TYPES as readonly string[]).includes(currentType)) {
    throw new Error("facebook / instagram cannot be archived");
  }

  const [{ usageCount }] = await db
    .select({ usageCount: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.leadSource, currentType));

  if (usageCount > 0) {
    throw new Error(
      `Lead type "${currentType}" can't be archived — it's used by ${usageCount} existing lead${
        usageCount === 1 ? "" : "s"
      }.`
    );
  }

  const [updated] = await db
    .update(leadTypes)
    .set({ isArchived: true })
    .where(eq(leadTypes.id, id))
    .returning();

  return {
    message: "Lead type archived successfully",
    data: updated,
  };
};

/* ==============================
   UNARCHIVE
============================== */

export const unarchiveLeadType = async (id: number) => {
  const existing = await db
    .select()
    .from(leadTypes)
    .where(eq(leadTypes.id, id));

  if (!existing.length) {
    throw new Error("Lead type not found");
  }

  if (!existing[0].isArchived) {
    throw new Error("Lead type is not archived");
  }

  const [updated] = await db
    .update(leadTypes)
    .set({ isArchived: false })
    .where(eq(leadTypes.id, id))
    .returning();

  return {
    message: "Lead type unarchived successfully",
    data: updated,
  };
};