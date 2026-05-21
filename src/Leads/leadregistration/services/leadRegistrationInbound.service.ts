import type { InboundLeadPayload } from "../models/leadRegistration.model";

/** DB slug for `leads.lead_source` — udaan, walk_in, and web_site are distinct. */
export type InboundLeadSourceSlug = "udaan" | "walk_in" | "web_site";

export function normalizeInboundEventKey(event?: string): string {
  return (event ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Maps secondary-server event names to CRM lead_source slugs.
 * - "udaan 3" / "udaan" → udaan (not walk_in)
 * - "walk in" → walk_in
 * - "web_site" / "website" / contact forms → web_site
 */
export function resolveLeadSourceFromInbound(
  event?: string,
  hints?: { udaanId?: string; registrationId?: string }
): InboundLeadSourceSlug {
  if (hints?.udaanId?.trim()) return "udaan";

  const key = normalizeInboundEventKey(event);

  if (key.includes("udaan") || key.includes("udan")) return "udaan";
  if (key === "walk_in" || key === "walkin" || key === "walk") return "walk_in";
  if (
    key === "web_site" ||
    key === "website" ||
    key === "contact_us" ||
    key === "contactus" ||
    key === "contact"
  ) {
    return "web_site";
  }

  // Registration id without udaan is typically a walk-in desk form
  if (hints?.registrationId?.trim() && !hints.udaanId?.trim()) {
    return "walk_in";
  }

  return "walk_in";
}

function pickString(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickBool(data: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (data[key] === undefined || data[key] === null) continue;
    return Boolean(data[key]);
  }
  return undefined;
}

function buildLatestNote(data: Record<string, unknown>, _source: InboundLeadSourceSlug): string | undefined {
  const message = pickString(data, "message", "note", "latest_note", "latestNote");
  return message || undefined;
}

function resolveExternalId(
  data: Record<string, unknown>,
  source: InboundLeadSourceSlug,
  phone: string,
  email?: string
): string | null {
  const udaanId = pickString(data, "udaan_id", "udaanId");
  if (udaanId) return udaanId.slice(0, 100);

  const registrationId = pickString(data, "registration_id", "registrationId");
  if (registrationId) return registrationId.slice(0, 100);

  if (source === "web_site") {
    const submitted = pickString(data, "submitted_at", "submittedAt");
    const base = [email, phone, submitted].filter(Boolean).join("|");
    if (base) return `WEB-${base}`.slice(0, 100);
  }

  return null;
}

/**
 * Inbound lead_type rules:
 * - udaan → "udaan"
 * - web_site → service_interested from payload (e.g. "Spouse visa"); lead_source stays web_site
 * - walk_in → payload product type or "walk_in"
 */
export function resolveInboundLeadType(
  leadSource: InboundLeadSourceSlug,
  explicitType?: string
): string | null {
  if (leadSource === "udaan") return "udaan";
  if (leadSource === "web_site") {
    const service = (explicitType ?? "").trim();
    return service || null;
  }
  if (leadSource === "walk_in") {
    const fromPayload = (explicitType ?? "").trim();
    if (!fromPayload) return "walk_in";
    const key = normalizeInboundEventKey(fromPayload);
    if (key && key !== "walk_in" && key !== "walkin") return key;
    return "walk_in";
  }
  const t = (explicitType ?? "").trim();
  return t || leadSource;
}

export type ParseInboundResult =
  | { ok: true; payload: InboundLeadPayload }
  | { ok: false; status: number; message: string };

export function parseInboundLeadBody(data: Record<string, unknown>): ParseInboundResult {
  const event = pickString(data, "event") || undefined;
  const udaanId = pickString(data, "udaan_id", "udaanId") || undefined;
  const registrationId = pickString(data, "registration_id", "registrationId") || undefined;

  const leadSource = resolveLeadSourceFromInbound(event, {
    udaanId,
    registrationId,
  });

  const fullName = pickString(data, "full_name", "fullName", "name");
  const phone = pickString(data, "phone_number", "phone", "phoneNumber", "mobile");

  if (!fullName || !phone) {
    return {
      ok: false,
      status: 422,
      message:
        leadSource === "web_site"
          ? "name and phone are required for website leads"
          : "full_name and phone_number are required",
    };
  }

  const email = pickString(data, "email") || undefined;
  const serviceInterested =
    pickString(data, "service_interested", "serviceInterested") || undefined;
  const explicitProductType =
    leadSource === "web_site"
      ? serviceInterested
      : pickString(data, "lead_type", "leadType", "event_id", "eventId") || undefined;

  const leadType = resolveInboundLeadType(leadSource, explicitProductType);

  const payload: InboundLeadPayload = {
    event,
    lead_source: leadSource,
    registration_id: registrationId,
    udaan_id: udaanId,
    event_id: pickString(data, "event_id", "eventId") || undefined,
    lead_type: leadType ?? undefined,
    step: typeof data.step === "number" ? data.step : undefined,
    full_name: fullName,
    phone_number: phone,
    email,
    city: pickString(data, "city") || undefined,
    gender: pickString(data, "gender") || undefined,
    date_of_birth: pickString(data, "date_of_birth", "dateOfBirth") || undefined,
    alternate_phone:
      pickString(data, "alternate_phone", "alt_phone_number", "altPhoneNumber") || undefined,
    has_passport: pickBool(data, "has_passport", "hasPassport"),
    passport_number: pickString(data, "passport_number", "passportNumber") || undefined,
    passport_expiry_date:
      pickString(data, "passport_expiry_date", "passportExpiryDate") || undefined,
    language_exam_given: pickBool(
      data,
      "language_exam_given",
      "languageExamGiven",
      "has_lang_exam",
      "hasLangExam"
    ),
    visa_refusal_details:
      pickString(data, "visa_refusal_details", "visaRefusalDetails") || undefined,
    preferred_country:
      pickString(data, "preferred_country", "preferredCountry") || undefined,
    field_of_interest:
      leadSource === "web_site"
        ? pickString(data, "field_of_interest", "fieldOfInterest") || undefined
        : pickString(data, "field_of_interest", "fieldOfInterest", "service_interested") ||
          undefined,
    latest_note: buildLatestNote(data, leadSource),
    external_lead_id: resolveExternalId(data, leadSource, phone, email) ?? undefined,
    education: (data.education ?? data.educations) as InboundLeadPayload["education"],
    language_scores: (data.language_scores ??
      data.language_exam_scores ??
      data.languageExamScores) as InboundLeadPayload["language_scores"],
    family_members: (data.family_members ??
      data.familyMembers) as InboundLeadPayload["family_members"],
  };

  return { ok: true, payload };
}
