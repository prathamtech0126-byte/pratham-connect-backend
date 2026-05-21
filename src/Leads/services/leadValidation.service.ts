import { eq } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { saleTypes } from "../../schemas/saleType.schema";
import { normalizeLeadTypeSlug } from "../models/leadType.model";
import {
  LeadFieldValidationError,
  normalizeLeadTextPayload,
  type NormalizedLeadTextFields,
} from "../../utils/leadTextNormalization";

const REASON_REQUIRED_ROLES = new Set(["telecaller", "counsellor"]);

export function requiresReasonForEligibility(
  role: string | undefined | null,
  value: string | null | undefined
) {
  if (!role || !REASON_REQUIRED_ROLES.has(role)) return false;
  return value === "future_prospect" || value === "not_eligible";
}

export function requiresReasonForQuality(
  role: string | undefined | null,
  value: string | null | undefined
) {
  if (!role || !REASON_REQUIRED_ROLES.has(role)) return false;
  return value === "bad";
}

export function humanizeLeadEnumValue(value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  if (!v || v === "undefined") return "Not set";
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildReasonNoteMessage(
  field: "eligibility" | "quality",
  value: string,
  reason: string
) {
  const display = humanizeLeadEnumValue(value);
  const label =
    field === "eligibility"
      ? `Eligibility marked as ${display}`
      : `Lead quality marked as ${display}`;
  return `${label} — ${reason.trim()}`;
}

export function formatFollowUpCompletedMessage(note: string): string {
  return `Follow up completed — ${note.trim()}`;
}

export function isClientReferenceSource(slug: string | null | undefined): boolean {
  const n = normalizeLeadTypeSlug(slug);
  return (
    n === "client_reference" ||
    n === "clientreference" ||
    n === "referral" ||
    n === "reference"
  );
}

export function isInternalReferenceSource(slug: string | null | undefined): boolean {
  const n = normalizeLeadTypeSlug(slug);
  return (
    n === "internal_reference" ||
    n === "internalreference" ||
    n === "internal_referral" ||
    n === "internal_reffal"
  );
}

export function requiresReferenceSelection(slug: string | null | undefined): boolean {
  return isClientReferenceSource(slug) || isInternalReferenceSource(slug);
}

export async function assertValidSaleTypeLabel(
  leadType: string | null | undefined
): Promise<string | null> {
  const label = String(leadType ?? "").trim();
  if (!label) return null;
  const [row] = await db
    .select({ saleType: saleTypes.saleType })
    .from(saleTypes)
    .where(eq(saleTypes.saleType, label))
    .limit(1);
  if (!row) {
    throw new LeadFieldValidationError(
      "Lead type (sale type) is invalid. Choose a configured type from the list."
    );
  }
  return row.saleType;
}

export function normalizeAndValidateLeadPayload(
  payload: Record<string, unknown>,
  opts?: { requireEmail?: boolean; requireCity?: boolean }
): NormalizedLeadTextFields {
  try {
    return normalizeLeadTextPayload(payload, opts);
  } catch (e) {
    if (e instanceof LeadFieldValidationError) throw e;
    throw e;
  }
}

export { LeadFieldValidationError };
