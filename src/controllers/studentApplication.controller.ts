import { Request, Response } from "express";
import { db } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { users } from "../schemas/users.schema";
import { eq, inArray, and } from "drizzle-orm";
import {
  createStudentApplication,
  getStudentApplicationsByClientId,
  getStudentApplicationById,
  updateStudentApplicationStatus,
  updateStudentApplicationNote,
  deleteStudentApplication,
  isValidStudentApplicationStatus,
  upsertTuitionDepositForApplication,
  getTuitionDepositForApplication,
} from "../models/studentApplication.model";
import { redisDel } from "../config/redis";
import { logActivity } from "../services/activityLog.service";

const canUserTouchClient = async (
  clientId: number,
  userId: number,
  role: string,
): Promise<boolean> => {
  if (role === "admin" || role === "developer") return true;

  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return false;

  if (role === "counsellor") {
    return (
      client.counsellorId === userId ||
      (client.transferStatus === true && client.transferedToCounsellorId === userId)
    );
  }

  if (role === "manager") {
    const candidateCounsellorIds = [
      client.counsellorId,
      client.transferStatus ? client.transferedToCounsellorId : null,
    ].filter((id): id is number => Number.isFinite(id));

    if (candidateCounsellorIds.length === 0) return false;

    const counsellors = await db
      .select({ id: users.id, managerId: users.managerId })
      .from(users)
      .where(inArray(users.id, candidateCounsellorIds));

    return counsellors.some((c) => c.managerId === userId);
  }

  return false;
};

const invalidateClientCache = async (clientId: number) => {
  try {
    await redisDel(`clients:complete:${clientId}`);
  } catch {}
};

export const createStudentApplicationController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body ?? {};
    const clientId = Number(body.clientId);
    const saleTypeId = Number(body.saleTypeId);
    const counsellorId = Number(body.counsellorId ?? user.id);
    const universityName = String(body.universityName ?? "").trim();
    const courseName = body.courseName ? String(body.courseName).trim() : null;
    const country = body.country ? String(body.country).trim() : null;
    const applicationDate = body.applicationDate ? String(body.applicationDate).trim() : null;
    const note = body.note ? String(body.note).trim() : null;

    if (!clientId || !saleTypeId || !universityName) {
      return res.status(400).json({
        success: false,
        message: "clientId, saleTypeId, and universityName are required.",
      });
    }

    const allowed = await canUserTouchClient(clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const [saleType] = await db
      .select({
        saleTypeId: saleTypes.saleTypeId,
        categoryName: saleTypeCategories.name,
      })
      .from(saleTypes)
      .leftJoin(saleTypeCategories, eq(saleTypes.categoryId, saleTypeCategories.id))
      .where(eq(saleTypes.saleTypeId, saleTypeId))
      .limit(1);

    if (!saleType) {
      return res.status(400).json({ success: false, message: "Invalid sale type." });
    }

    if (String(saleType.categoryName ?? "").toLowerCase() !== "student") {
      return res.status(400).json({
        success: false,
        message: "Sale type must belong to the student category.",
      });
    }

    const created = await createStudentApplication({
      clientId,
      saleTypeId,
      counsellorId,
      universityName,
      courseName,
      country,
      status: "app_submitted",
      applicationDate,
      note,
    });

    await invalidateClientCache(clientId);

    try {
      await logActivity(req, {
        entityType: "student_application",
        entityId: created.applicationId,
        clientId,
        action: "CREATE",
        newValue: created,
        description: `Student application added: ${universityName}`,
        metadata: {
          universityName,
          courseName,
          country,
          saleTypeId,
        },
        performedBy: user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in createStudentApplicationController:", activityError);
    }

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create student application.",
    });
  }
};

export const getStudentApplicationsByClientController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const clientId = Number(req.params.clientId);

    if (!clientId) {
      return res.status(400).json({ success: false, message: "Invalid client id." });
    }

    const allowed = await canUserTouchClient(clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const applications = await getStudentApplicationsByClientId(clientId);
    return res.status(200).json({ success: true, data: applications, count: applications.length });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch student applications.",
    });
  }
};

export const deleteStudentApplicationController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const applicationId = Number(req.params.applicationId);

    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Valid applicationId is required." });
    }

    const existing = await getStudentApplicationById(applicationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const allowed = await canUserTouchClient(existing.clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await deleteStudentApplication(applicationId);
    await invalidateClientCache(existing.clientId);

    return res.status(200).json({ success: true, message: "Application deleted successfully." });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete student application.",
    });
  }
};

export const updateStudentApplicationNoteController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const applicationId = Number(req.params.applicationId);
    const note = req.body?.note != null ? String(req.body.note).trim() || null : null;

    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Valid applicationId is required." });
    }

    const existing = await getStudentApplicationById(applicationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const allowed = await canUserTouchClient(existing.clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await updateStudentApplicationNote({ applicationId, note });
    await invalidateClientCache(existing.clientId);

    return res.status(200).json({ success: true, message: "Note updated." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || "Failed to update note." });
  }
};

export const upsertTuitionDepositController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const applicationId = Number(req.params.applicationId);
    const body = req.body ?? {};
    const statusRaw = String(body.status ?? body.tutionFeesStatus ?? "").toLowerCase();

    if (!applicationId || !["paid", "pending"].includes(statusRaw)) {
      return res.status(400).json({
        success: false,
        message: "Valid applicationId and status (paid or pending) are required.",
      });
    }

    const existing = await getStudentApplicationById(applicationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const allowed = await canUserTouchClient(existing.clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const priorDeposit = await getTuitionDepositForApplication(applicationId);

    const tuitionDeposit = await upsertTuitionDepositForApplication({
      applicationId,
      clientId: existing.clientId,
      handledBy: user.id,
      tutionFeesStatus: statusRaw as "paid" | "pending",
      feeDate: body.date ?? body.feeDate ?? null,
      remarks: body.remarks ?? null,
    });

    await invalidateClientCache(existing.clientId);

    try {
      const isUpdate = !!priorDeposit?.tuitionDepositProductPaymentId;
      await logActivity(req, {
        entityType: "student_application_tuition_deposit",
        entityId: applicationId,
        clientId: existing.clientId,
        action: isUpdate ? "PRODUCT_UPDATED" : "PRODUCT_ADDED",
        oldValue: priorDeposit,
        newValue: tuitionDeposit,
        description: `${isUpdate ? "Tuition deposit updated" : "Tuition deposit added"} for ${existing.universityName} (${statusRaw})`,
        metadata: {
          applicationId,
          universityName: existing.universityName,
          productName: "TUTION_FEES",
        },
        performedBy: user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in upsertTuitionDepositController:", activityError);
    }

    return res.status(200).json({ success: true, data: tuitionDeposit });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to save tuition deposit.",
    });
  }
};

export const updateStudentApplicationStatusController = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const applicationId = Number(req.params.applicationId);
    const status = String(req.body?.status ?? "");

    if (!applicationId || !isValidStudentApplicationStatus(status)) {
      return res.status(400).json({
        success: false,
        message: "Valid applicationId and status are required.",
      });
    }

    const existing = await getStudentApplicationById(applicationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const allowed = await canUserTouchClient(existing.clientId, user.id, user.role);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const updated = await updateStudentApplicationStatus({ applicationId, status });
    await invalidateClientCache(existing.clientId);

    try {
      await logActivity(req, {
        entityType: "student_application",
        entityId: applicationId,
        clientId: existing.clientId,
        action: "STATUS_CHANGE",
        oldValue: { status: existing.status },
        newValue: { status: updated?.status ?? status },
        description: `Student application status updated: ${existing.universityName}`,
        metadata: {
          universityName: existing.universityName,
          previousStatus: existing.status,
          newStatus: updated?.status ?? status,
        },
        performedBy: user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in updateStudentApplicationStatusController:", activityError);
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update application status.",
    });
  }
};
