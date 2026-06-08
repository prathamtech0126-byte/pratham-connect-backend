import { db } from "../config/databaseConnection";
import { studentApplications } from "../schemas/studentApplication.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { users } from "../schemas/users.schema";
import { eq, desc, and, inArray } from "drizzle-orm";

export type StudentApplicationStatus =
  | "app_submitted"
  | "offer_received"
  | "cas_received"
  | "visa_submitted"
  | "process_completed";

export interface CreateStudentApplicationInput {
  clientId: number;
  saleTypeId: number;
  counsellorId: number;
  universityName: string;
  courseName?: string | null;
  country?: string | null;
  status?: StudentApplicationStatus;
  applicationDate?: string | null;
  note?: string | null;
}

export interface UpdateStudentApplicationStatusInput {
  applicationId: number;
  status: StudentApplicationStatus;
}

export interface UpdateStudentApplicationNoteInput {
  applicationId: number;
  note: string | null;
}

const VALID_STATUSES: StudentApplicationStatus[] = [
  "app_submitted",
  "offer_received",
  "cas_received",
  "visa_submitted",
  "process_completed",
];

export const isValidStudentApplicationStatus = (
  status: string,
): status is StudentApplicationStatus => VALID_STATUSES.includes(status as StudentApplicationStatus);

const mapStudentApplicationRow = (row: {
  applicationId: number;
  clientId: number;
  saleTypeId: number;
  counsellorId: number;
  universityName: string;
  courseName: string | null;
  country: string | null;
  status: StudentApplicationStatus;
  applicationDate?: string | null;
  note?: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  saleType?: string | null;
  counsellorName?: string | null;
}) => ({
  applicationId: row.applicationId,
  clientId: row.clientId,
  saleTypeId: row.saleTypeId,
  saleType: row.saleType ?? null,
  counsellorId: row.counsellorId,
  counsellorName: row.counsellorName ?? null,
  universityName: row.universityName,
  courseName: row.courseName,
  country: row.country,
  status: row.status,
  applicationDate: row.applicationDate ?? null,
  note: row.note ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createStudentApplication = async (input: CreateStudentApplicationInput) => {
  const [created] = await db
    .insert(studentApplications)
    .values({
      clientId: input.clientId,
      saleTypeId: input.saleTypeId,
      counsellorId: input.counsellorId,
      universityName: input.universityName.trim(),
      courseName: input.courseName?.trim() || null,
      country: input.country?.trim() || null,
      status: input.status ?? "app_submitted",
      applicationDate: input.applicationDate ?? null,
      note: input.note?.trim() || null,
      updatedAt: new Date(),
    })
    .returning();

  const rows = await getStudentApplicationsByClientId(input.clientId);
  return rows.find((row) => row.applicationId === created.applicationId) ?? mapStudentApplicationRow({
    ...created,
    saleType: null,
    counsellorName: null,
  });
};

export const getStudentApplicationsByClientId = async (clientId: number) => {
  const rows = await db
    .select({
      applicationId: studentApplications.applicationId,
      clientId: studentApplications.clientId,
      saleTypeId: studentApplications.saleTypeId,
      counsellorId: studentApplications.counsellorId,
      universityName: studentApplications.universityName,
      courseName: studentApplications.courseName,
      country: studentApplications.country,
      status: studentApplications.status,
      applicationDate: studentApplications.applicationDate,
      note: studentApplications.note,
      createdAt: studentApplications.createdAt,
      updatedAt: studentApplications.updatedAt,
      saleType: saleTypes.saleType,
      counsellorName: users.fullName,
    })
    .from(studentApplications)
    .leftJoin(saleTypes, eq(studentApplications.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(users, eq(studentApplications.counsellorId, users.id))
    .where(eq(studentApplications.clientId, clientId))
    .orderBy(desc(studentApplications.createdAt));

  return rows.map(mapStudentApplicationRow);
};

export const updateStudentApplicationStatus = async (
  input: UpdateStudentApplicationStatusInput,
) => {
  const [updated] = await db
    .update(studentApplications)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(studentApplications.applicationId, input.applicationId))
    .returning();

  if (!updated) return null;

  const [row] = await db
    .select({
      applicationId: studentApplications.applicationId,
      clientId: studentApplications.clientId,
      saleTypeId: studentApplications.saleTypeId,
      counsellorId: studentApplications.counsellorId,
      universityName: studentApplications.universityName,
      courseName: studentApplications.courseName,
      country: studentApplications.country,
      status: studentApplications.status,
      applicationDate: studentApplications.applicationDate,
      note: studentApplications.note,
      createdAt: studentApplications.createdAt,
      updatedAt: studentApplications.updatedAt,
      saleType: saleTypes.saleType,
      counsellorName: users.fullName,
    })
    .from(studentApplications)
    .leftJoin(saleTypes, eq(studentApplications.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(users, eq(studentApplications.counsellorId, users.id))
    .where(eq(studentApplications.applicationId, input.applicationId))
    .limit(1);

  return row ? mapStudentApplicationRow(row) : null;
};

export const updateStudentApplicationNote = async (
  input: UpdateStudentApplicationNoteInput,
) => {
  const [updated] = await db
    .update(studentApplications)
    .set({ note: input.note?.trim() || null, updatedAt: new Date() })
    .where(eq(studentApplications.applicationId, input.applicationId))
    .returning({ applicationId: studentApplications.applicationId });
  return !!updated;
};

export const deleteStudentApplication = async (applicationId: number): Promise<boolean> => {
  const result = await db
    .delete(studentApplications)
    .where(eq(studentApplications.applicationId, applicationId))
    .returning({ applicationId: studentApplications.applicationId });
  return result.length > 0;
};

export const getStudentApplicationById = async (applicationId: number) => {
  const [row] = await db
    .select({
      applicationId: studentApplications.applicationId,
      clientId: studentApplications.clientId,
      saleTypeId: studentApplications.saleTypeId,
      counsellorId: studentApplications.counsellorId,
      universityName: studentApplications.universityName,
      courseName: studentApplications.courseName,
      country: studentApplications.country,
      status: studentApplications.status,
      applicationDate: studentApplications.applicationDate,
      note: studentApplications.note,
      createdAt: studentApplications.createdAt,
      updatedAt: studentApplications.updatedAt,
      saleType: saleTypes.saleType,
      counsellorName: users.fullName,
    })
    .from(studentApplications)
    .leftJoin(saleTypes, eq(studentApplications.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(users, eq(studentApplications.counsellorId, users.id))
    .where(eq(studentApplications.applicationId, applicationId))
    .limit(1);

  return row ? mapStudentApplicationRow(row) : null;
};

/**
 * Batch-fetch the first student application's saleType for a list of clientIds.
 * Returns a Map<clientId, { saleTypeId, saleType }>.
 */
export const batchGetStudentAppSaleTypes = async (
  clientIds: number[],
): Promise<Map<number, { saleTypeId: number; saleType: string | null }>> => {
  const result = new Map<number, { saleTypeId: number; saleType: string | null }>();
  if (clientIds.length === 0) return result;

  const rows = await db
    .select({
      clientId: studentApplications.clientId,
      saleTypeId: studentApplications.saleTypeId,
      saleType: saleTypes.saleType,
    })
    .from(studentApplications)
    .leftJoin(saleTypes, eq(studentApplications.saleTypeId, saleTypes.saleTypeId))
    .where(inArray(studentApplications.clientId, clientIds));

  for (const row of rows) {
    if (!result.has(row.clientId)) {
      result.set(row.clientId, { saleTypeId: row.saleTypeId, saleType: row.saleType ?? null });
    }
  }
  return result;
};
