import { Request, Response } from "express";
import type { Role } from "../../../types/role";
import { resolveVisaCaseError } from "../errors/visaCase.errors";
import {
  resolveProcessingSubStatusFilter,
  VISA_CASE_DECISION_ROLES,
  VISA_CASE_LIST_ROLES,
  VISA_CASE_TRAVEL_UPDATE_ROLES,
} from "../constants/visaCase.constants";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import {
  getCachedVisaCaseDashboard,
  getCachedVisaCaseDetail,
  getCachedVisaCaseList,
  getCachedVisaCaseProcessingStages,
} from "../cache/visaCase.cache.service";
import { getVisaCaseById } from "../models/visaCase.model";
import {
  logVisaCaseAssignment,
  logVisaCaseDecisionUpdate,
  logVisaCaseDocumentFulfilled,
  logVisaCaseDocumentRequest,
  logVisaCaseSponsorshipUpdate,
  logVisaCaseStatusUpdate,
  logVisaCaseTravelUpdate,
} from "../services/visaCaseActivityLog.service";
import {
  assignVisaCase,
  bulkAssignVisaCases,
  getAssignableUsers,
  getVisaCaseAssignments,
  listAssignableOpsUsers,
  listGlobalAssignableOpsUsers,
} from "../services/visaCaseAssignment.service";
import {
  fulfillVisaCaseDocument,
  getVisaCaseDocumentRequestHistory,
  getVisaCaseDocumentRequests,
  getVisaCaseDetail,
  requestVisaCaseDocument,
  updateVisaCaseDecision,
  updateVisaCaseSponsorship,
  updateVisaCaseStatus,
  updateVisaCaseTravel,
} from "../services/visaCase.service";
import type { VisaProcessingSubStatus } from "../services/visaCaseStateMachine";
import { VISA_CASE_ASSIGN_ADMIN_ROLES, VISA_CASE_OPS_ROLES } from "../constants/visaCase.constants";
import { pool } from "../../../config/databaseConnection";
import {
  syncEligibleVisaCasesForClient,
} from "../../sync/modulesSync.service";

const viewerFromReq = (req: Request) => {
  if (!req.user?.id || !req.user.role) {
    return null;
  }
  return { userId: req.user.id, role: req.user.role as Role };
};

const hasRole = (role: Role, allowed: readonly Role[]): boolean =>
  role === "developer" || allowed.includes(role);

const canAssignVisaCase = (role: Role): boolean =>
  role === "developer" ||
  (VISA_CASE_ASSIGN_ADMIN_ROLES as readonly string[]).includes(role) ||
  (VISA_CASE_OPS_ROLES as readonly string[]).includes(role);

const sendVisaCaseError = (
  res: Response,
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
  defaultStatus = 400
) => {
  const resolved = resolveVisaCaseError(error, fallbackMessage, { defaultStatus });
  if (resolved.status >= 500) {
    console.error(`${logLabel} error:`, error);
  }

  const body: { success: false; message: string; code?: string } = {
    success: false,
    message: resolved.message,
  };
  if (resolved.code) {
    body.code = resolved.code;
  }

  return res.status(resolved.status).json(body);
};

export const getVisaCaseProcessingStagesController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const result = await getCachedVisaCaseProcessingStages(viewer.role);
    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load processing stages";
    console.error("getVisaCaseProcessingStagesController error:", error);
    return res.status(500).json({ success: false, message });
  }
};

export const listVisaCasesController = async (req: Request, res: Response) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 100);

    const rawSubStatus = req.query.currentSubStatus as string | undefined;
    let currentSubStatus: string | undefined;
    if (rawSubStatus) {
      const resolved = resolveProcessingSubStatusFilter(rawSubStatus);
      if (!resolved) {
        return res.status(400).json({
          success: false,
          message: `Invalid currentSubStatus: ${rawSubStatus}`,
        });
      }
      currentSubStatus = resolved;
    }

    const result = await getCachedVisaCaseList(viewer, {
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
      userId: req.query.userId
        ? Number(req.query.userId)
        : undefined,
      destinationCountryId: req.query.destinationCountryId as string | undefined,
      countryId:
        (req.query.countryId as string | undefined) ||
        (req.query.countriesId as string | undefined),
      currentStage:
        (req.query.stage as string | undefined) ||
        (req.query.currentStage as string | undefined),
      currentSubStatus,
      assignedTeam: req.query.assignedTeam as string | undefined,
      saleTypeId: req.query.saleTypeId as string | undefined,
      legacySaleTypeId: req.query.legacySaleTypeId
        ? Number(req.query.legacySaleTypeId)
        : undefined,
      visaCategory: req.query.visaCategory as string | undefined,
      assignedUserId: req.query.assignedUserId
        ? Number(req.query.assignedUserId)
        : undefined,
      unassigned: req.query.unassigned === "true",
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return res.status(200).json({
      success: true,
      ...result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to list visa cases";
    console.error("listVisaCasesController error:", error);
    return res.status(500).json({ success: false, message });
  }
};

export const getVisaCaseController = async (req: Request, res: Response) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const result = await getCachedVisaCaseDetail(req.params.visaCaseId, viewer);
    if (!result.data) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to fetch visa case",
      "getVisaCaseController",
      500
    );
  }
};

export const getVisaCaseDashboardController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const result = await getCachedVisaCaseDashboard(viewer, {
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
      userId: req.query.userId
        ? Number(req.query.userId)
        : undefined,
      branchCode: req.query.branchCode as string | undefined,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch visa case dashboard";
    console.error("getVisaCaseDashboardController error:", error);
    return res.status(500).json({ success: false, message });
  }
};

export const updateVisaCaseTravelController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_TRAVEL_UPDATE_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const visaCaseId = req.params.visaCaseId;
    const before = await getVisaCaseById(visaCaseId);
    if (!before) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const data = await updateVisaCaseTravel(visaCaseId, req.body, viewer);
    if (!data) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const after = await getVisaCaseById(visaCaseId);
    if (after) {
      await logVisaCaseTravelUpdate(
        req,
        visaCaseId,
        viewer.userId,
        viewer.role,
        before,
        after
      );
    }

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to update travel details",
      "updateVisaCaseTravelController"
    );
  }
};

export const updateVisaCaseSponsorshipController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_TRAVEL_UPDATE_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const visaCaseId = req.params.visaCaseId;
    const before = await getVisaCaseById(visaCaseId);
    if (!before) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const data = await updateVisaCaseSponsorship(visaCaseId, req.body, viewer);
    if (!data) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const after = await getVisaCaseById(visaCaseId);
    if (after) {
      await logVisaCaseSponsorshipUpdate(
        req,
        visaCaseId,
        viewer.userId,
        viewer.role,
        before,
        after
      );
    }

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to update sponsorship",
      "updateVisaCaseSponsorshipController"
    );
  }
};

export const updateVisaCaseStatusController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const subStatus = req.body.subStatus as VisaProcessingSubStatus;
    if (!subStatus) {
      return res.status(400).json({
        success: false,
        message: "subStatus is required",
      });
    }

    const visaCaseId = req.params.visaCaseId;
    const before = await getVisaCaseById(visaCaseId);
    if (!before) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const data = await updateVisaCaseStatus(visaCaseId, viewer, {
      subStatus,
      notes: req.body.notes,
      submissionDate: req.body.submissionDate,
      decisionDate: req.body.decisionDate,
    });

    const after = await getVisaCaseById(visaCaseId);
    if (after) {
      await logVisaCaseStatusUpdate(
        req,
        visaCaseId,
        viewer.userId,
        viewer.role,
        before,
        after,
        req.body.notes
      );
    }

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to update processing status",
      "updateVisaCaseStatusController"
    );
  }
};

export const updateVisaCaseDecisionController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_DECISION_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const visaCaseId = req.params.visaCaseId;
    const before = await getVisaCaseById(visaCaseId);
    if (!before) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const data = await updateVisaCaseDecision(visaCaseId, req.body, viewer);
    if (!data) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const after = await getVisaCaseById(visaCaseId);
    if (after) {
      await logVisaCaseDecisionUpdate(
        req,
        visaCaseId,
        viewer.userId,
        viewer.role,
        before,
        after
      );
    }

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to update decision",
      "updateVisaCaseDecisionController"
    );
  }
};

export const requestVisaCaseDocumentController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const visaCaseId = req.params.visaCaseId;
    const existing = await getVisaCaseById(visaCaseId);

    const data = await requestVisaCaseDocument(visaCaseId, viewer, {
      clientId: req.body.clientId,
      legacyClientId: req.body.legacyClientId,
      documentType: req.body.documentType,
      notes: req.body.notes,
    });

    await logVisaCaseDocumentRequest(req, visaCaseId, viewer.userId, viewer.role, {
      legacyClientId: existing?.client.legacyClientId ?? null,
      clientName: existing?.person.fullName ?? "Client",
      documentType: String(req.body.documentType ?? "").trim(),
      notes: req.body.notes,
    });

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to request document",
      "requestVisaCaseDocumentController"
    );
  }
};

export const fulfillVisaCaseDocumentController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const data = await fulfillVisaCaseDocument(
      req.params.requestId,
      viewer,
      req.body.notes
    );

    const visaCaseId = data.request.visaCaseId;
    const existing = await getVisaCaseById(visaCaseId);
    await logVisaCaseDocumentFulfilled(req, visaCaseId, viewer.userId, viewer.role, {
      legacyClientId: existing?.client.legacyClientId ?? null,
      clientName: existing?.person.fullName ?? "Client",
      documentType: data.request.documentType,
      notes: req.body.notes,
    });

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to fulfill document request",
      "fulfillVisaCaseDocumentController"
    );
  }
};

export const listVisaCaseDocumentRequestsController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const data = await getVisaCaseDocumentRequests(req.params.visaCaseId, viewer);
    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to list document requests",
      "listVisaCaseDocumentRequestsController",
      500
    );
  }
};

export const listVisaCaseDocumentRequestHistoryController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 100);

    const statusRaw =
      typeof req.query.status === "string"
        ? req.query.status.trim().toUpperCase()
        : undefined;
    const allowedStatuses = new Set(["OPEN", "FULFILLED", "CANCELLED"]);
    if (statusRaw && !allowedStatuses.has(statusRaw)) {
      return res.status(400).json({
        success: false,
        message: "status must be OPEN, FULFILLED, or CANCELLED",
      });
    }

    const data = await getVisaCaseDocumentRequestHistory(viewer, {
      status: statusRaw as "OPEN" | "FULFILLED" | "CANCELLED" | undefined,
      sourceTeam: req.query.sourceTeam as string | undefined,
      targetTeam: req.query.targetTeam as string | undefined,
      raisedByRole: req.query.raisedByRole as string | undefined,
      raisedBy: req.query.raisedBy ? Number(req.query.raisedBy) : undefined,
      visaCaseId: req.query.visaCaseId as string | undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return res.status(200).json({
      success: true,
      data: data.items,
      pagination: {
        page,
        pageSize,
        total: data.total,
        totalPages: Math.ceil(data.total / pageSize) || 0,
      },
    });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to list document request history",
      "listVisaCaseDocumentRequestHistoryController",
      500
    );
  }
};

export const assignVisaCaseController = async (req: Request, res: Response) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !canAssignVisaCase(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const assignedUserIdRaw = req.body.assignedUserId;
    const assignedUserId =
      assignedUserIdRaw != null && assignedUserIdRaw !== ""
        ? Number(assignedUserIdRaw)
        : undefined;
    const empId =
      typeof req.body.empId === "string" ? req.body.empId.trim() : undefined;

    if (
      (assignedUserId == null || !Number.isFinite(assignedUserId) || assignedUserId <= 0) &&
      !empId
    ) {
      return res.status(400).json({
        success: false,
        message: "assignedUserId or empId is required",
      });
    }

    const result = await assignVisaCase(viewer, req.params.visaCaseId, {
      assignedUserId:
        assignedUserId != null && Number.isFinite(assignedUserId) && assignedUserId > 0
          ? assignedUserId
          : undefined,
      empId,
      notes: req.body.notes,
    });

    const detail = await getVisaCaseDetail(req.params.visaCaseId, viewer);

    await logVisaCaseAssignment(req, {
      visaCaseId: req.params.visaCaseId,
      legacyClientId: detail?.client?.legacyClientId ?? null,
      performedBy: viewer.userId,
      performerRole: viewer.role,
      assigneeName: result.targetUser.fullName,
      assignedTeam: result.visaCase.assignedTeam,
      assignmentType: result.assignment.assignmentType,
      assignedUserId: result.targetUser.id,
    });

    return res.status(200).json({
      success: true,
      data: {
        visaCase: detail,
        assignment: {
          id: result.assignment.id,
          assignmentType: result.assignment.assignmentType,
          assignedTeam: result.assignment.assignedTeam,
          assignedUser: {
            id: result.targetUser.id,
            fullName: result.targetUser.fullName,
            role: result.targetUser.role,
            empId: result.targetUser.empId,
          },
          assignedBy: viewer.userId,
          createdAt: result.assignment.createdAt,
        },
      },
    });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to assign visa case",
      "assignVisaCaseController"
    );
  }
};

export const listVisaCaseAssignmentsController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !hasRole(viewer.role, VISA_CASE_LIST_ROLES)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const detail = await getVisaCaseDetail(req.params.visaCaseId, viewer);
    if (!detail) {
      return res.status(404).json({ success: false, message: "Visa case not found" });
    }

    const data = await getVisaCaseAssignments(req.params.visaCaseId);
    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to list assignments",
      "listVisaCaseAssignmentsController",
      500
    );
  }
};

export const listAssignableUsersController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !canAssignVisaCase(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const data = await getAssignableUsers(
      viewer,
      req.params.visaCaseId,
      req.query.targetRole as string | undefined
    );

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to list assignable users",
      "listAssignableUsersController"
    );
  }
};

/** List cx | binding | application users for assign / bulk-assign pickers. */
export const listGlobalAssignableUsersController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !canAssignVisaCase(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const data = await listGlobalAssignableOpsUsers(
      viewer,
      req.query.targetRole as string | undefined
    );
    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to list assignable users",
      "listGlobalAssignableUsersController"
    );
  }
};

export const bulkAssignVisaCasesController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (!viewer || !canAssignVisaCase(viewer.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const visaCaseIds = Array.isArray(req.body.visaCaseIds)
      ? (req.body.visaCaseIds as string[])
      : [];

    const assignedUserIdRaw = req.body.assignedUserId;
    const assignedUserId =
      assignedUserIdRaw != null && assignedUserIdRaw !== ""
        ? Number(assignedUserIdRaw)
        : undefined;
    const empId =
      typeof req.body.empId === "string" ? req.body.empId.trim() : undefined;

    if (
      (assignedUserId == null ||
        !Number.isFinite(assignedUserId) ||
        assignedUserId <= 0) &&
      !empId
    ) {
      return res.status(400).json({
        success: false,
        message: "assignedUserId or empId is required",
      });
    }

    const data = await bulkAssignVisaCases(viewer, {
      visaCaseIds,
      assignedUserId:
        assignedUserId != null &&
        Number.isFinite(assignedUserId) &&
        assignedUserId > 0
          ? assignedUserId
          : undefined,
      empId,
      notes: req.body.notes,
    });

    for (const item of data.results) {
      if (!item.success) continue;
      const row = await getVisaCaseById(item.visaCaseId);
      await logVisaCaseAssignment(req, {
        visaCaseId: item.visaCaseId,
        legacyClientId: row?.client.legacyClientId ?? null,
        performedBy: viewer.userId,
        performerRole: viewer.role,
        assigneeName: data.assignee.fullName,
        assignedTeam: row?.visaCase.assignedTeam ?? data.assignee.role,
        assignmentType: item.assignmentType ?? "bulk_assign",
        assignedUserId: data.assignee.id,
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    return sendVisaCaseError(
      res,
      error,
      "Failed to bulk assign visa cases",
      "bulkAssignVisaCasesController"
    );
  }
};

/** Ensure visa_cases rows exist for an eligible enrolled client (admin/manager). */
export const syncVisaCasesForClientController = async (
  req: Request,
  res: Response
) => {
  try {
    const viewer = viewerFromReq(req);
    if (
      !viewer ||
      !(
        viewer.role === "developer" ||
        (VISA_CASE_ASSIGN_ADMIN_ROLES as readonly string[]).includes(viewer.role)
      )
    ) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const legacyClientId = Number(req.body.legacyClientId ?? req.params.legacyClientId);
    if (!Number.isFinite(legacyClientId) || legacyClientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid legacyClientId is required",
      });
    }

    const counsellorIdRaw = req.body.counsellorId;
    let counsellorId =
      counsellorIdRaw != null && counsellorIdRaw !== ""
        ? Number(counsellorIdRaw)
        : undefined;

    if (counsellorId == null || !Number.isFinite(counsellorId) || counsellorId <= 0) {
      const { rows } = await pool.query<{ counsellor_id: number }>(
        `SELECT counsellor_id FROM client_information WHERE id = $1 LIMIT 1`,
        [legacyClientId]
      );
      counsellorId = rows[0]?.counsellor_id;
    }

    if (counsellorId == null || !Number.isFinite(counsellorId) || counsellorId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Could not resolve counsellorId for this client",
      });
    }

    const result = await syncEligibleVisaCasesForClient({
      legacyClientId,
      counsellorId,
    });

    return res.status(200).json({
      success: true,
      data: {
        legacyClientId,
        ...result,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to sync visa cases for client";
    console.error("syncVisaCasesForClientController error:", error);
    return res.status(500).json({ success: false, message });
  }
};
