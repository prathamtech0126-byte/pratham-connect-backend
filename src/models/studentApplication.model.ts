import { db } from "../config/databaseConnection";
import { studentApplications } from "../schemas/studentApplication.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { users } from "../schemas/users.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  assertCanAddClientTuitionDeposit,
  saveClientProductPayment,
} from "./clientProductPayments.model";

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

export interface UpsertTuitionDepositInput {
  applicationId: number;
  clientId: number;
  handledBy: number;
  tutionFeesStatus: "paid" | "pending";
  feeDate?: string | null;
  remarks?: string | null;
}

export interface TuitionDepositInfo {
  tuitionDepositTaken: boolean;
  tuitionDepositStatus: "paid" | "pending" | null;
  tuitionDepositDate: string | null;
  tuitionDepositRemarks: string | null;
  tuitionDepositProductPaymentId: number | null;
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
  tuitionDeposit?: TuitionDepositInfo;
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
  tuitionDepositTaken: row.tuitionDeposit?.tuitionDepositTaken ?? false,
  tuitionDepositStatus: row.tuitionDeposit?.tuitionDepositStatus ?? null,
  tuitionDepositDate: row.tuitionDeposit?.tuitionDepositDate ?? null,
  tuitionDepositRemarks: row.tuitionDeposit?.tuitionDepositRemarks ?? null,
  tuitionDepositProductPaymentId: row.tuitionDeposit?.tuitionDepositProductPaymentId ?? null,
});

const getTuitionDepositsByApplicationIds = async (
  applicationIds: number[],
): Promise<Map<number, TuitionDepositInfo>> => {
  const result = new Map<number, TuitionDepositInfo>();
  if (applicationIds.length === 0) return result;

  const rows = await db
    .select({
      studentApplicationId: tutionFees.studentApplicationId,
      tutionFeesStatus: tutionFees.tutionFeesStatus,
      feeDate: tutionFees.feeDate,
      remarks: tutionFees.remarks,
      productPaymentId: clientProductPayments.productPaymentId,
    })
    .from(tutionFees)
    .innerJoin(
      clientProductPayments,
      and(
        eq(clientProductPayments.entityId, tutionFees.id),
        eq(clientProductPayments.entityType, "tutionFees_id"),
      ),
    )
    .where(inArray(tutionFees.studentApplicationId, applicationIds));

  for (const row of rows) {
    if (row.studentApplicationId == null) continue;
    result.set(row.studentApplicationId, {
      tuitionDepositTaken: row.tutionFeesStatus === "paid",
      tuitionDepositStatus: row.tutionFeesStatus,
      tuitionDepositDate: row.feeDate ?? null,
      tuitionDepositRemarks: row.remarks ?? null,
      tuitionDepositProductPaymentId: row.productPaymentId ?? null,
    });
  }

  return result;
};

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

  const tuitionDeposits = await getTuitionDepositsByApplicationIds(
    rows.map((row) => row.applicationId),
  );

  return rows.map((row) =>
    mapStudentApplicationRow({
      ...row,
      tuitionDeposit: tuitionDeposits.get(row.applicationId),
    }),
  );
};

export const getTuitionDepositForApplication = async (applicationId: number) => {
  const deposits = await getTuitionDepositsByApplicationIds([applicationId]);
  return deposits.get(applicationId) ?? null;
};

export const upsertTuitionDepositForApplication = async (input: UpsertTuitionDepositInput) => {
  const existing = await getTuitionDepositForApplication(input.applicationId);

  if (existing?.tuitionDepositProductPaymentId) {
    await saveClientProductPayment(
      {
        productPaymentId: existing.tuitionDepositProductPaymentId,
        clientId: input.clientId,
        productName: "TUTION_FEES",
        amount: 0,
        entityData: {
          tutionFeesStatus: input.tutionFeesStatus,
          feeDate: input.feeDate ?? undefined,
          remarks: input.remarks ?? undefined,
          studentApplicationId: input.applicationId,
        },
      },
      input.handledBy,
    );
    return getTuitionDepositForApplication(input.applicationId);
  }

  await assertCanAddClientTuitionDeposit(input.clientId);

  await saveClientProductPayment(
    {
      clientId: input.clientId,
      productName: "TUTION_FEES",
      amount: 0,
      entityData: {
        tutionFeesStatus: input.tutionFeesStatus,
        feeDate: input.feeDate ?? undefined,
        remarks: input.remarks ?? undefined,
        studentApplicationId: input.applicationId,
      },
    },
    input.handledBy,
  );

  return getTuitionDepositForApplication(input.applicationId);
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

/** Batch-fetch application_date values per client (for dashboard student list filter). */
export const batchGetStudentApplicationDates = async (
  clientIds: number[],
): Promise<Map<number, string[]>> => {
  const result = new Map<number, string[]>();
  if (clientIds.length === 0) return result;

  const rows = await db
    .select({
      clientId: studentApplications.clientId,
      applicationDate: studentApplications.applicationDate,
    })
    .from(studentApplications)
    .where(inArray(studentApplications.clientId, clientIds));

  for (const row of rows) {
    if (!row.applicationDate) continue;
    const dates = result.get(row.clientId) ?? [];
    dates.push(row.applicationDate);
    result.set(row.clientId, dates);
  }
  return result;
};
