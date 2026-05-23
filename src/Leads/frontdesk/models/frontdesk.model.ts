import { db } from "../../../config/databaseConnection";
import { leads } from "../../schemas/leads.schema";
import { leadStudentProfiles } from "../../leadregistration/schemas/leadStudentProfiles.schema";
import { leadStudentEducation } from "../../leadregistration/schemas/leadStudentEducation.schema";
import { leadLanguageExamScores } from "../../leadregistration/schemas/leadLanguageExamScores.schema";
import { leadFamilyMembers } from "../../leadregistration/schemas/leadFamilyMembers.schema";
import { users } from "../../../schemas/users.schema";
import { saleTypes } from "../../../schemas/saleType.schema";
import { activityLog } from "../../../schemas/activityLog.schema";
import { publishLeadChange } from "../../services/leadRealtime.service";
import { createActivityLog } from "../../../services/activityLog.service";
import {
  eq,
  and,
  or,
  ilike,
  gte,
  lte,
  desc,
  count,
  asc,
  sql,
} from "drizzle-orm";
import * as ExcelJS from "exceljs";

function formatName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

// ─── Activity Logging ──────────────────────────────────────────────────────────

export async function logFrontDeskActivity(opts: {
  userId: number;
  leadId?: number | null;
  action: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  await createActivityLog({
    entityType: opts.leadId ? "front_desk_lead" : "front_desk_session",
    entityId: opts.leadId ?? null,
    clientId: null,
    action: opts.action === "login" ? "LOGIN" : opts.action === "logout" ? "LOGOUT" : "UPDATE",
    oldValue: null,
    newValue: null,
    description: opts.description,
    metadata: { ...(opts.metadata ?? {}), frontDeskAction: opts.action },
    performedBy: opts.userId,
  });
}

export async function getFrontDeskActivityLogs(userId: number, page = 1, limit = 30) {
  return getFrontDeskActivityLogsForViewer(userId, "front_desk", page, limit);
}

export async function getFrontDeskActivityLogsForViewer(userId: number, viewerRole: string, page = 1, limit = 30) {
  const offset = (page - 1) * limit;
  const canViewAll = ["admin", "superadmin", "developer"].includes(viewerRole);
  const conditions: any[] = [
    or(eq(activityLog.entityType, "front_desk_lead"), eq(activityLog.entityType, "front_desk_session")),
  ];
  if (!canViewAll) conditions.push(eq(activityLog.performedBy, userId));
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: activityLog.logId,
        userId: activityLog.performedBy,
        userName: users.fullName,
        action: sql<string>`COALESCE(${activityLog.metadata}->>'frontDeskAction', ${activityLog.action}::text)`,
        description: activityLog.description,
        metadata: activityLog.metadata,
        createdAt: activityLog.createdAt,
        leadId: activityLog.entityId,
        leadName: leads.fullName,
        leadPhone: leads.phone,
      })
      .from(activityLog)
      .leftJoin(leads, eq(activityLog.entityId, leads.id))
      .leftJoin(users, eq(activityLog.performedBy, users.id))
      .where(where)
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ total: count() })
      .from(activityLog)
      .where(where),
  ]);

  return { rows, total: Number(total), page, limit };
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────────

export async function getFrontDeskDashboardStats(startDate?: Date, endDate?: Date) {
  const start = startDate ?? new Date(new Date().setHours(0, 0, 0, 0));
  const end = endDate ?? new Date(new Date().setHours(23, 59, 59, 999));

  const base = and(eq(leads.leadSource, "walk_in"), gte(leads.createdAt, start), lte(leads.createdAt, end));

  const [totalRow, verifiedRow, assignedRow, notAssignedRow] = await Promise.all([
    db.select({ c: count() }).from(leads).where(base),
    db.select({ c: count() }).from(leads).where(and(base, eq(leads.isVerified, true))),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          base,
          sql`${leads.assignmentStatus} IN ('assigned', 'converted')`
        )
      ),
    db
      .select({ c: count() })
      .from(leads)
      .where(and(base, eq(leads.assignmentStatus, "not_assigned"))),
  ]);

  return {
    total: Number(totalRow[0].c),
    verified: Number(verifiedRow[0].c),
    assigned: Number(assignedRow[0].c),
    notAssigned: Number(notAssignedRow[0].c),
  };
}

// ─── Sale Types ────────────────────────────────────────────────────────────────

export async function getSaleTypeNamesForFilter(): Promise<string[]> {
  const rows = await db
    .select({ name: saleTypes.saleType })
    .from(saleTypes)
    .orderBy(asc(saleTypes.saleType));
  return rows.map((r) => r.name);
}

// ─── Lead Filters ──────────────────────────────────────────────────────────────

export interface FrontDeskLeadFilters {
  search?: string;
  startDate?: string;
  endDate?: string;
  isVerified?: boolean;
  leadType?: string;
  page?: number;
  limit?: number;
}

export async function getFrontDeskLeads(filters: FrontDeskLeadFilters) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(leads.leadSource, "walk_in")];

  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(leads.fullName, term), ilike(leads.phone, term)));
  }

  if (filters.startDate) {
    conditions.push(gte(leads.createdAt, new Date(filters.startDate)));
  }

  if (filters.endDate) {
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(leads.createdAt, end));
  }

  if (filters.isVerified !== undefined) {
    conditions.push(eq(leads.isVerified, filters.isVerified));
  }

  if (filters.leadType?.trim()) {
    conditions.push(eq(leads.leadType, filters.leadType.trim()));
  }

  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: leads.id,
        fullName: leads.fullName,
        phone: leads.phone,
        email: leads.email,
        city: leads.city,
        leadSource: leads.leadSource,
        leadType: leads.leadType,
        externalLeadId: leads.externalLeadId,
        assignmentStatus: leads.assignmentStatus,
        progressStatus: leads.progressStatus,
        isVerified: leads.isVerified,
        verifiedAt: leads.verifiedAt,
        createdAt: leads.createdAt,
        currentCounsellorId: leads.currentCounsellorId,
        counsellorName: users.fullName,
      })
      .from(leads)
      .leftJoin(users, eq(leads.currentCounsellorId, users.id))
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(limit)
      .offset(offset),

    db.select({ total: count() }).from(leads).where(where),
  ]);

  return { rows, total: Number(total), page, limit };
}

// ─── Lead Detail ───────────────────────────────────────────────────────────────

export async function getFrontDeskLeadDetail(leadId: number) {
  const [leadRow] = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phone,
      email: leads.email,
      city: leads.city,
      leadSource: leads.leadSource,
      leadType: leads.leadType,
      externalLeadId: leads.externalLeadId,
      assignmentStatus: leads.assignmentStatus,
      progressStatus: leads.progressStatus,
      isVerified: leads.isVerified,
      verifiedAt: leads.verifiedAt,
      verifiedByFrontDeskId: leads.verifiedByFrontDeskId,
      createdAt: leads.createdAt,
      currentCounsellorId: leads.currentCounsellorId,
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

  return { ...leadRow, profile: profile[0] ?? null, education, languageScores: scores, familyMembers: family };
}

// ─── Verify ────────────────────────────────────────────────────────────────────

export async function verifyFrontDeskLead(
  leadId: number,
  frontDeskUserId: number,
  saleType: string,
  source: string,
  counsellorId?: number,
) {
  const [row] = await db
    .select({ id: leads.id, fullName: leads.fullName })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) throw new Error("Lead not found");

  const updatePayload: Record<string, unknown> = {
    isVerified: true,
    verifiedAt: new Date(),
    verifiedByFrontDeskId: frontDeskUserId,
    leadType: saleType,
    leadSource: source,
    updatedAt: new Date(),
  };

  if (counsellorId) {
    updatePayload.currentCounsellorId = counsellorId;
    updatePayload.assignedBy = frontDeskUserId;
    updatePayload.assignmentStatus = "assigned";
  }

  const [updatedLead] = await db.update(leads).set(updatePayload as any).where(eq(leads.id, leadId)).returning();

  if (updatedLead) {
    await publishLeadChange(counsellorId ? "lead:assigned" : "lead:updated", updatedLead as Record<string, unknown>, {
      notifyCounsellorId: counsellorId ?? null,
    });
  }

  await logFrontDeskActivity({
    userId: frontDeskUserId,
    leadId,
    action: counsellorId ? "verify_transfer" : "verify",
    description: counsellorId
      ? `Verified and transferred lead: ${row.fullName}`
      : `Verified lead: ${row.fullName}`,
    metadata: { saleType, source, counsellorId: counsellorId ?? null },
  });
}

// ─── Assign ────────────────────────────────────────────────────────────────────

export async function assignLeadToCounsellor(leadId: number, counsellorId: number, assignedByUserId: number, leadType?: string) {
  const [row] = await db
    .select({ id: leads.id, fullName: leads.fullName, isVerified: leads.isVerified, assignmentStatus: leads.assignmentStatus, currentCounsellorId: leads.currentCounsellorId, leadType: leads.leadType })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) throw new Error("Lead not found");
  if (!row.isVerified) throw new Error("Lead must be verified before assigning to a counsellor");
  if (row.assignmentStatus === "converted" || row.assignmentStatus === "dropped") {
    throw new Error("Cannot reassign a lead that has been converted or dropped");
  }

  const effectiveLeadType = leadType?.trim() || row.leadType;
  if (!effectiveLeadType) {
    throw new Error("Please select a sale type before assigning the lead to a counsellor");
  }

  const updatePayload: Record<string, unknown> = {
    currentCounsellorId: counsellorId,
    assignedBy: assignedByUserId,
    assignmentStatus: "assigned",
    progressStatus: "contacted",
    eligibilityStatus: "eligible",
    leadQuality: "excellent",
    updatedAt: new Date(),
  };
  if (leadType?.trim()) updatePayload.leadType = leadType.trim();

  const [updatedLead] = await db.update(leads).set(updatePayload as any).where(eq(leads.id, leadId)).returning();

  if (updatedLead) {
    await publishLeadChange("lead:assigned", updatedLead as Record<string, unknown>, {
      notifyCounsellorId: counsellorId,
    });
  }

  await logFrontDeskActivity({
    userId: assignedByUserId,
    leadId,
    action: row.currentCounsellorId ? "reassign" : "assign",
    description: `${row.currentCounsellorId ? "Reassigned" : "Assigned"} lead: ${row.fullName}`,
    metadata: { counsellorId, leadType: effectiveLeadType },
  });
}

// ─── Edit Lead Details ─────────────────────────────────────────────────────────

export interface UpdateLeadDetailsInput {
  // Core lead fields
  fullName?: string;
  phone?: string;
  email?: string;
  city?: string;
  leadType?: string;
  // Profile fields
  profile?: {
    gender?: string;
    dateOfBirth?: string;
    alternatePhone?: string;
    hasPassport?: boolean;
    languageExamGiven?: boolean;
    visaRefusalDetails?: string;
    preferredCountry?: string;
    fieldOfInterest?: string;
  };
  // Replace arrays if provided
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

export async function updateLeadDetails(leadId: number, input: UpdateLeadDetailsInput, updatedByUserId: number) {
  const [existing] = await db
    .select({ id: leads.id, fullName: leads.fullName })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!existing) throw new Error("Lead not found");

  // Update core lead fields
  const leadUpdate: Record<string, unknown> = { updatedAt: new Date() };
  if (input.fullName !== undefined) leadUpdate.fullName = formatName(input.fullName);
  if (input.phone !== undefined) leadUpdate.phone = input.phone;
  if (input.email !== undefined) leadUpdate.email = input.email;
  if (input.city !== undefined) leadUpdate.city = input.city;
  if (input.leadType !== undefined) leadUpdate.leadType = input.leadType;

  if (Object.keys(leadUpdate).length > 1) {
    await db.update(leads).set(leadUpdate as any).where(eq(leads.id, leadId));
  }

  // Update profile
  if (input.profile) {
    const profileData: Record<string, unknown> = { updatedAt: new Date() };
    const p = input.profile;
    if (p.gender !== undefined) profileData.gender = p.gender;
    if (p.dateOfBirth !== undefined) profileData.dateOfBirth = p.dateOfBirth;
    if (p.alternatePhone !== undefined) profileData.alternatePhone = p.alternatePhone;
    if (p.hasPassport !== undefined) profileData.hasPassport = p.hasPassport;
    if (p.languageExamGiven !== undefined) profileData.languageExamGiven = p.languageExamGiven;
    if (p.visaRefusalDetails !== undefined) profileData.visaRefusalDetails = p.visaRefusalDetails;
    if (p.preferredCountry !== undefined) profileData.preferredCountry = p.preferredCountry;
    if (p.fieldOfInterest !== undefined) profileData.fieldOfInterest = p.fieldOfInterest;

    const existing = await db.select({ id: leadStudentProfiles.id }).from(leadStudentProfiles).where(eq(leadStudentProfiles.leadId, leadId)).limit(1);
    if (existing.length > 0) {
      await db.update(leadStudentProfiles).set(profileData as any).where(eq(leadStudentProfiles.leadId, leadId));
    } else {
      await db.insert(leadStudentProfiles).values({ leadId, ...(profileData as any) });
    }
  }

  // Replace education records
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

  // Replace language scores
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

  // Replace family members
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

  await logFrontDeskActivity({
    userId: updatedByUserId,
    leadId,
    action: "update_details",
    description: `Edited lead details: ${existing.fullName}`,
    metadata: { updatedFields: Object.keys(input) },
  });

  const updatedLead = await getFrontDeskLeadDetail(leadId);
  if (updatedLead) {
    await publishLeadChange("lead:updated", updatedLead as unknown as Record<string, unknown>);
  }
}

// ─── Export ────────────────────────────────────────────────────────────────────

export async function exportFrontDeskLeadsToExcel(filters: Omit<FrontDeskLeadFilters, "page" | "limit">): Promise<Buffer> {
  const { rows } = await getFrontDeskLeads({ ...filters, limit: 10000, page: 1 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Front Desk Leads");

  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Name", key: "fullName", width: 25 },
    { header: "Phone", key: "phone", width: 15 },
    { header: "Email", key: "email", width: 30 },
    { header: "City", key: "city", width: 15 },
    { header: "Lead Type", key: "leadType", width: 20 },
    { header: "External ID", key: "externalLeadId", width: 20 },
    { header: "Verified", key: "isVerified", width: 10 },
    { header: "Assignment Status", key: "assignmentStatus", width: 20 },
    { header: "Counsellor", key: "counsellorName", width: 25 },
    { header: "Created At", key: "createdAt", width: 22 },
  ];

  for (const row of rows) {
    sheet.addRow({
      ...row,
      isVerified: row.isVerified ? "Yes" : "No",
      createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString("en-IN") : "",
    });
  }

  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
