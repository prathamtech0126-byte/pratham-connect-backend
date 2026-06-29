import { db } from "../../../config/databaseConnection";
import { leads } from "../../schemas/leads.schema";
import { leadStudentProfiles } from "../schemas/leadStudentProfiles.schema";
import { leadStudentEducation } from "../schemas/leadStudentEducation.schema";
import { leadLanguageExamScores } from "../schemas/leadLanguageExamScores.schema";
import { leadFamilyMembers } from "../schemas/leadFamilyMembers.schema";
import { eq } from "drizzle-orm";
import { normalizeDateOfBirthForDb } from "../../../utils/date";
import { publishFrontDeskOnWrite } from "../../frontdesk/services/frontdeskOnWrite.service";
import {
  isFrontDeskLeadEditable,
  FRONT_DESK_LEAD_EDIT_BLOCKED_MSG,
} from "../../frontdesk/models/frontdesk.model";
import { createActivityLog } from "../../../services/activityLog.service";
import { createLeadUpdateActivity } from "../../services/leadActivityEvents.service";

function formatName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export interface LeadSelfEditInput {
  fullName?: string;
  phone?: string;
  email?: string;
  city?: string;
  profile?: {
    gender?: string;
    dateOfBirth?: string;
    alternatePhone?: string;
    hasPassport?: boolean;
    passportNumber?: string;
    passportExpiryDate?: string;
    languageExamGiven?: boolean;
    visaRefusalDetails?: string;
    preferredCountry?: string;
    fieldOfInterest?: string;
  };
  education?: Array<{
    educationLevel?: string;
    schoolName?: string;
    specialization?: string;
    yearOfCompletion?: number;
    percentageOrCgpa?: string;
    numberOfBacklogs?: number;
  }>;
  languageScores?: Array<{
    examType?: string;
    listening?: number;
    reading?: number;
    writing?: number;
    speaking?: number;
    overallBand?: number;
  }>;
  familyMembers?: Array<{
    memberName?: string;
    phoneNumber?: string;
  }>;
}

export async function getLeadForSelfEdit(leadId: number) {
  const [leadRow] = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phone,
      email: leads.email,
      city: leads.city,
      leadSource: leads.leadSource,
      leadType: leads.leadType,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!leadRow) return null;

  const [profile, education, scores, family] = await Promise.all([
    db.select().from(leadStudentProfiles).where(eq(leadStudentProfiles.leadId, leadId)).limit(1),
    db.select().from(leadStudentEducation).where(eq(leadStudentEducation.leadId, leadId)),
    db.select().from(leadLanguageExamScores).where(eq(leadLanguageExamScores.leadId, leadId)),
    db.select().from(leadFamilyMembers).where(eq(leadFamilyMembers.leadId, leadId)),
  ]);

  return {
    ...leadRow,
    profile: profile[0] ?? null,
    education,
    languageScores: scores,
    familyMembers: family,
  };
}

export async function updateLeadForSelfEdit(
  leadId: number,
  input: LeadSelfEditInput,
  opts: { tokenId: number; createdByUserId: number | null }
) {
  const [existing] = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      currentCounsellorId: leads.currentCounsellorId,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!existing) throw new Error("Lead not found");
  if (!isFrontDeskLeadEditable(existing)) {
    throw new Error(FRONT_DESK_LEAD_EDIT_BLOCKED_MSG);
  }

  const leadUpdate: Record<string, unknown> = { updatedAt: new Date() };
  if (input.fullName !== undefined) leadUpdate.fullName = formatName(input.fullName);
  if (input.phone !== undefined) leadUpdate.phone = input.phone.trim();
  if (input.email !== undefined) leadUpdate.email = input.email?.trim() || null;
  if (input.city !== undefined) leadUpdate.city = input.city?.trim() || null;

  if (Object.keys(leadUpdate).length > 1) {
    await db.update(leads).set(leadUpdate as any).where(eq(leads.id, leadId));
  }

  if (input.profile) {
    const profileData: Record<string, unknown> = { updatedAt: new Date() };
    const p = input.profile;
    if (p.gender !== undefined) profileData.gender = p.gender;
    if (p.dateOfBirth !== undefined) {
      profileData.dateOfBirth = normalizeDateOfBirthForDb(p.dateOfBirth);
    }
    if (p.alternatePhone !== undefined) profileData.alternatePhone = p.alternatePhone;
    if (p.hasPassport !== undefined) profileData.hasPassport = p.hasPassport;
    if (p.passportNumber !== undefined) profileData.passportNumber = p.passportNumber;
    if (p.passportExpiryDate !== undefined) profileData.passportExpiryDate = p.passportExpiryDate;
    if (p.languageExamGiven !== undefined) profileData.languageExamGiven = p.languageExamGiven;
    if (p.visaRefusalDetails !== undefined) profileData.visaRefusalDetails = p.visaRefusalDetails;
    if (p.preferredCountry !== undefined) profileData.preferredCountry = p.preferredCountry;
    if (p.fieldOfInterest !== undefined) profileData.fieldOfInterest = p.fieldOfInterest;

    const existingProfile = await db
      .select({ id: leadStudentProfiles.id })
      .from(leadStudentProfiles)
      .where(eq(leadStudentProfiles.leadId, leadId))
      .limit(1);

    if (existingProfile.length > 0) {
      await db
        .update(leadStudentProfiles)
        .set(profileData as any)
        .where(eq(leadStudentProfiles.leadId, leadId));
    } else {
      await db.insert(leadStudentProfiles).values({ leadId, ...(profileData as any) });
    }
  }

  if (input.education !== undefined) {
    await db.delete(leadStudentEducation).where(eq(leadStudentEducation.leadId, leadId));
    if (input.education.length > 0) {
      await db.insert(leadStudentEducation).values(
        input.education.map((e) => ({
          leadId,
          educationLevel: e.educationLevel ?? null,
          schoolName: e.schoolName ?? null,
          specialization: e.specialization ?? null,
          yearOfCompletion: e.yearOfCompletion ?? null,
          percentageOrCgpa: e.percentageOrCgpa ?? null,
          numberOfBacklogs: e.numberOfBacklogs ?? 0,
        }))
      );
    }
  }

  if (input.languageScores !== undefined) {
    await db.delete(leadLanguageExamScores).where(eq(leadLanguageExamScores.leadId, leadId));
    if (input.languageScores.length > 0) {
      await db.insert(leadLanguageExamScores).values(
        input.languageScores.map((s) => ({
          leadId,
          examType: s.examType ?? null,
          listening: s.listening?.toString() ?? null,
          reading: s.reading?.toString() ?? null,
          writing: s.writing?.toString() ?? null,
          speaking: s.speaking?.toString() ?? null,
          overallBand: s.overallBand?.toString() ?? null,
        }))
      );
    }
  }

  if (input.familyMembers !== undefined) {
    await db.delete(leadFamilyMembers).where(eq(leadFamilyMembers.leadId, leadId));
    if (input.familyMembers.length > 0) {
      await db.insert(leadFamilyMembers).values(
        input.familyMembers.map((f) => ({
          leadId,
          memberName: f.memberName ? formatName(f.memberName) : null,
          phoneNumber: f.phoneNumber ?? null,
        }))
      );
    }
  }

  if (opts.createdByUserId) {
    await createActivityLog({
      entityType: "front_desk_lead",
      entityId: leadId,
      clientId: null,
      action: "UPDATE",
      oldValue: null,
      newValue: null,
      description: `Client updated registration via edit link: ${existing.fullName}`,
      metadata: {
        frontDeskAction: "client_self_edit",
        editTokenId: opts.tokenId,
        updatedFields: Object.keys(input),
      },
      performedBy: opts.createdByUserId,
    });
  }

  await createLeadUpdateActivity({
    leadId,
    userId: opts.createdByUserId,
    performerName: "Client (edit link)",
    changes: [],
    reasonMessage: "Client updated registration details via edit link",
  });

  const updatedLead = await getLeadForSelfEdit(leadId);
  if (updatedLead) {
    await publishFrontDeskOnWrite({
      reason: "frontdesk:client_self_edit",
      leadId,
      leadName: updatedLead.fullName,
      actorUserId: opts.createdByUserId,
      snapshot: updatedLead as unknown as Record<string, unknown>,
      notificationKind: "lead_client_self_edited",
      leadChangeEvent: "lead:updated",
      leadChangePayload: updatedLead as unknown as Record<string, unknown>,
    });
  }

  return updatedLead;
}
