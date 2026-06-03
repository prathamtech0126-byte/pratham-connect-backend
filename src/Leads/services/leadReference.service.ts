import { eq, inArray } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { leadReferences } from "../schemas/leadReferences.schema";
import {
  isClientReferenceSource,
  isInternalReferenceSource,
  requiresReferenceSelection,
  LeadFieldValidationError,
} from "./leadValidation.service";

export type LeadReferenceKind = "client" | "internal" | "self";

export type LeadReferenceInput = {
  kind: LeadReferenceKind;
  name: string;
  id?: number;
  memberRole?: string | null;
  isManual?: boolean;
  counsellorId?: number | null;
  counsellorName?: string | null;
};

export type LeadReferenceApiShape = {
  kind: LeadReferenceKind;
  id: number | null;
  name: string;
  memberRole?: string | null;
  isManual?: boolean;
  counsellorId?: number | null;
  counsellorName?: string | null;
};

function humanizeRole(role: string | null | undefined): string | null {
  if (!role) return null;
  const r = role.trim().toLowerCase();
  if (r === "telecaller") return "Telecaller";
  if (r === "counsellor" || r === "counselor") return "Counsellor";
  if (r === "self") return "Self";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parse API body `referenceMeta` / `reference` payload. */
export function parseReferenceInput(raw: unknown): LeadReferenceInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== "client" && kind !== "internal" && kind !== "self") return null;

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;

  if (kind === "client") {
    if (o.isManual === true || o.isManual === "true") {
      const counsellorId =
        o.counsellorId != null && o.counsellorId !== ""
          ? Number(o.counsellorId)
          : null;
      return {
        kind: "client",
        name,
        isManual: true,
        id: 0,
        counsellorId: Number.isFinite(counsellorId) ? counsellorId : null,
        counsellorName:
          typeof o.counsellorName === "string" ? o.counsellorName.trim() : null,
      };
    }
    const id = Number(o.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { kind: "client", id, name };
  }

  if (kind === "self") {
    const id = Number(o.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return {
      kind: "self",
      id,
      name,
      memberRole: "self",
    };
  }

  const id = Number(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const memberRole =
    typeof o.memberRole === "string" && o.memberRole.trim()
      ? o.memberRole.trim().toLowerCase()
      : null;
  return { kind: "internal", id, name, memberRole };
}

export function assertReferenceInputForSource(
  leadSource: string | null | undefined,
  raw: unknown
): LeadReferenceInput | null {
  if (!requiresReferenceSelection(leadSource)) return null;

  const parsed = parseReferenceInput(raw);
  if (!parsed) {
    throw new LeadFieldValidationError(
      isClientReferenceSource(leadSource)
        ? "Select a client from the list, or enter the client name manually."
        : "Select a team member from the list, use Self reference, or search and choose one."
    );
  }

  if (isClientReferenceSource(leadSource)) {
    if (parsed.kind !== "client") {
      throw new LeadFieldValidationError(
        "Reference selection does not match the selected lead source."
      );
    }
    return parsed;
  }

  if (isInternalReferenceSource(leadSource)) {
    if (parsed.kind !== "internal" && parsed.kind !== "self") {
      throw new LeadFieldValidationError(
        "Reference selection does not match the selected lead source."
      );
    }
    return parsed;
  }

  return parsed;
}

export async function insertLeadReferenceRow(
  input: LeadReferenceInput
): Promise<number> {
  const entityId =
    input.kind === "client" && input.isManual
      ? null
      : input.id != null && input.id > 0
        ? input.id
        : null;

  const [row] = await db
    .insert(leadReferences)
    .values({
      referenceKind: input.kind,
      entityId,
      displayName: input.name,
      memberRole: input.memberRole ?? (input.kind === "self" ? "self" : null),
      isManual: Boolean(input.isManual),
      manualCounsellorId: input.counsellorId ?? null,
      manualCounsellorName: input.counsellorName ?? null,
    })
    .returning({ id: leadReferences.id });

  return row.id;
}

export async function getLeadReferenceById(id: number) {
  const [row] = await db
    .select()
    .from(leadReferences)
    .where(eq(leadReferences.id, id))
    .limit(1);
  return row ?? null;
}

export function formatReferenceForApi(
  row: typeof leadReferences.$inferSelect
): LeadReferenceApiShape {
  return {
    kind: row.referenceKind as LeadReferenceKind,
    id: row.entityId ?? null,
    name: row.displayName,
    memberRole: humanizeRole(row.memberRole),
    isManual: row.isManual,
    counsellorId: row.manualCounsellorId ?? null,
    counsellorName: row.manualCounsellorName ?? null,
  };
}

/** Legacy `referenceMeta` field for API consumers. */
export function referenceMetaFromRow(
  row: typeof leadReferences.$inferSelect
): LeadReferenceApiShape & { referenceId: number } {
  const base = formatReferenceForApi(row);
  return { ...base, referenceId: row.id };
}

/** Batch-load references for lead list rows. */
export async function attachReferencesToLeadRows<
  T extends { referenceId?: number | null },
>(
  rows: T[]
): Promise<
  (T & {
    reference: LeadReferenceApiShape | null;
    referenceMeta: LeadReferenceApiShape | null;
    referenceDisplayName: string | null;
  })[]
> {
  const refIds = [
    ...new Set(
      rows
        .map((r) => r.referenceId)
        .filter((id): id is number => id != null && Number.isFinite(id))
    ),
  ];
  if (!refIds.length) {
    return rows.map((r) => ({
      ...r,
      reference: null,
      referenceMeta: null,
      referenceDisplayName: null,
    }));
  }
  const refRows = await db
    .select()
    .from(leadReferences)
    .where(inArray(leadReferences.id, refIds));
  const map = new Map(refRows.map((row) => [row.id, formatReferenceForApi(row)]));
  return rows.map((r) => {
    if (!r.referenceId) {
      return {
        ...r,
        reference: null,
        referenceMeta: null,
        referenceDisplayName: null,
      };
    }
    const ref = map.get(r.referenceId) ?? null;
    return {
      ...r,
      reference: ref,
      referenceMeta: ref,
      referenceDisplayName: ref?.name ?? null,
    };
  });
}

export async function enrichLeadWithReference<T extends { referenceId?: number | null }>(
  lead: T
): Promise<T & { reference: LeadReferenceApiShape | null; referenceMeta: LeadReferenceApiShape | null }> {
  if (!lead.referenceId) {
    return { ...lead, reference: null, referenceMeta: null };
  }
  const row = await getLeadReferenceById(lead.referenceId);
  if (!row) {
    return { ...lead, reference: null, referenceMeta: null };
  }
  const ref = formatReferenceForApi(row);
  return { ...lead, reference: ref, referenceMeta: ref };
}
