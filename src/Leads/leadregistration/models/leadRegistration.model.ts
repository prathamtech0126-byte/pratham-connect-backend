import { db } from "../../../config/databaseConnection";
import { leads } from "../../schemas/leads.schema";
import { leadStudentProfiles } from "../schemas/leadStudentProfiles.schema";
import { leadStudentEducation } from "../schemas/leadStudentEducation.schema";
import { leadLanguageExamScores } from "../schemas/leadLanguageExamScores.schema";
import { leadFamilyMembers } from "../schemas/leadFamilyMembers.schema";
import { eq } from "drizzle-orm";
import { createLeadCreatedActivity } from "../../services/leadActivityEvents.service";
import { parseFrontendDate } from "../../../utils/date";

function formatName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export interface InboundLeadPayload {
  event?: string;
  /** Resolved CRM slug: udaan | walk_in | web_site */
  lead_source?: string;
  registration_id?: string;
  udaan_id?: string;
  external_lead_id?: string;
  event_id?: string;
  lead_type?: string;
  step?: number;

  // Core lead fields
  full_name: string;
  phone_number: string;
  email?: string;
  city?: string;

  // Student profile fields
  gender?: string;
  date_of_birth?: string;
  alternate_phone?: string;
  has_passport?: boolean;
  passport_number?: string;
  passport_expiry_date?: string;
  language_exam_given?: boolean;
  visa_refusal_details?: string;
  preferred_country?: string;
  field_of_interest?: string;
  latest_note?: string;

  // Related records
  education?: Array<{
    education_level?: string;
    school_name?: string;
    specialization?: string;
    year_of_completion?: number;
    percentage_or_cgpa?: string;
    number_of_backlogs?: number;
  }>;

  language_scores?: Array<{
    exam_type?: string;
    listening?: number;
    reading?: number;
    writing?: number;
    speaking?: number;
    overall_band?: number;
  }>;

  family_members?: Array<{
    member_name?: string;
    phone_number?: string;
  }>;
}

export async function upsertInboundLead(
  payload: InboundLeadPayload
): Promise<{ leadId: number; isNew: boolean }> {
  const externalId =
    payload.external_lead_id ??
    payload.udaan_id ??
    payload.registration_id ??
    null;
  const formattedFullName = formatName(payload.full_name);

  const source = payload.lead_source ?? "walk_in";

  // udaan → "udaan"; web_site → service_interested; walk_in → product type or "walk_in"
  const leadTypeName =
    payload.lead_type ??
    (source === "walk_in" ? payload.event_id ?? null : null);

  let leadId: number | null = null;
  let isNew = false;

  if (externalId) {
    const existing = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.externalLeadId, externalId))
      .limit(1);

    if (existing.length > 0) {
      leadId = existing[0].id;

      await db
        .update(leads)
        .set({
          fullName: formattedFullName,
          phone: payload.phone_number,
          email: payload.email ?? null,
          city: payload.city ?? null,
          leadSource: source,
          leadType: leadTypeName,
          latestNote: payload.latest_note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
    }
  }

  if (!leadId) {
    isNew = true;
    const [inserted] = await db
      .insert(leads)
      .values({
        externalLeadId: externalId ?? undefined,
        fullName: formattedFullName,
        phone: payload.phone_number,
        email: payload.email ?? null,
        city: payload.city ?? null,
        leadSource: source,
        leadType: leadTypeName,
        latestNote: payload.latest_note ?? null,
        assignmentStatus: "not_assigned",
        progressStatus: "not_contacted",
        isJunk: false,
        isVerified: false,
      })
      .returning({ id: leads.id });

    leadId = inserted.id;

    await createLeadCreatedActivity({ leadId, userId: null });
  }

  // Upsert student profile
  const existingProfile = await db
    .select({ id: leadStudentProfiles.id })
    .from(leadStudentProfiles)
    .where(eq(leadStudentProfiles.leadId, leadId))
    .limit(1);

  const profileData = {
    gender: payload.gender ?? null,
    dateOfBirth: payload.date_of_birth
      ? parseFrontendDate(payload.date_of_birth) ?? null
      : null,
    alternatePhone: payload.alternate_phone ?? null,
    hasPassport: payload.has_passport ?? false,
    passportNumber: payload.passport_number ?? null,
    passportExpiryDate: payload.passport_expiry_date ?? null,
    languageExamGiven: payload.language_exam_given ?? false,
    visaRefusalDetails: payload.visa_refusal_details ?? null,
    preferredCountry: payload.preferred_country ?? null,
    fieldOfInterest: payload.field_of_interest ?? null,
    sourceReferenceId: externalId ?? null,
    updatedAt: new Date(),
  };

  if (existingProfile.length > 0) {
    await db
      .update(leadStudentProfiles)
      .set(profileData)
      .where(eq(leadStudentProfiles.leadId, leadId));
  } else {
    await db.insert(leadStudentProfiles).values({ leadId, ...profileData });
  }

  // Replace education records
  if (Array.isArray(payload.education) && payload.education.length > 0) {
    await db.delete(leadStudentEducation).where(eq(leadStudentEducation.leadId, leadId));
    await db.insert(leadStudentEducation).values(
      payload.education.map((e) => ({
        leadId,
        educationLevel: e.education_level ?? null,
        schoolName: e.school_name ?? null,
        specialization: e.specialization ?? null,
        yearOfCompletion: e.year_of_completion ?? null,
        percentageOrCgpa: e.percentage_or_cgpa ?? null,
        numberOfBacklogs: e.number_of_backlogs ?? 0,
      }))
    );
  }

  // Replace language exam scores
  if (Array.isArray(payload.language_scores) && payload.language_scores.length > 0) {
    await db.delete(leadLanguageExamScores).where(eq(leadLanguageExamScores.leadId, leadId));
    await db.insert(leadLanguageExamScores).values(
      payload.language_scores.map((s) => ({
        leadId,
        examType: s.exam_type ?? null,
        listening: s.listening?.toString() ?? null,
        reading: s.reading?.toString() ?? null,
        writing: s.writing?.toString() ?? null,
        speaking: s.speaking?.toString() ?? null,
        overallBand: s.overall_band?.toString() ?? null,
      }))
    );
  }

  // Replace family members
  if (Array.isArray(payload.family_members) && payload.family_members.length > 0) {
    await db.delete(leadFamilyMembers).where(eq(leadFamilyMembers.leadId, leadId));
    await db.insert(leadFamilyMembers).values(
      payload.family_members.map((f) => ({
        leadId,
        memberName: f.member_name ? formatName(f.member_name) : null,
        phoneNumber: f.phone_number ?? null,
      }))
    );
  }

  return { leadId, isNew };
}
