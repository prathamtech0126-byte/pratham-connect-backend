import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../../types/express-auth";
import {
  assignChecklistToClient,
  ClientDocumentError,
  getClientStorageUsage,
  listChecklistAssignmentsForClient,
  uploadChecklistItemDocument,
} from "../services/clientDocumentChecklist.service";
import {
  approveChecklistItemDocument,
  listDocumentReviewEventsForClient,
  mapReviewEventToUpdate,
  rejectChecklistItemDocument,
} from "../services/clientDocumentReview.service";

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ClientDocumentError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  return res.status(500).json({ message });
};

export const assignChecklistToClientController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const clientId = Number(req.body?.clientId);
    const checklistId = String(req.body?.checklistId || "").trim();
    const visaType = String(req.body?.visaType || "").trim();
    const country = String(req.body?.country || "").trim();

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }
    if (!checklistId) {
      return res.status(400).json({ message: "checklistId is required" });
    }
    if (!visaType || !country) {
      return res.status(400).json({ message: "visaType and country are required" });
    }

    const assignment = await assignChecklistToClient({
      clientId,
      checklistId,
      visaType,
      country,
      assignedByUserId: authReq.user.id,
    });

    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    return handleError(res, error);
  }
};

export const counsellorClientAssignmentsController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }

    const assignments = await listChecklistAssignmentsForClient(clientId);
    return res.json({ success: true, data: assignments });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDocumentChecklistAssignmentsController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = req.clientPortalUser?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const assignments = await listChecklistAssignmentsForClient(clientId);
    return res.json({ success: true, data: assignments });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDocumentUploadController = async (req: Request, res: Response) => {
  try {
    const clientId = req.clientPortalUser?.clientId;
    const accountId = req.clientPortalUser?.accountId;
    if (!clientId || !accountId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const assignmentId = Number(req.body?.assignmentId);
    const checklistItemId = String(req.body?.checklistItemId || "").trim();
    const file = req.file;

    if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ message: "Valid assignmentId is required" });
    }
    if (!checklistItemId) {
      return res.status(400).json({ message: "checklistItemId is required" });
    }

    const uploaded = await uploadChecklistItemDocument({
      clientId,
      assignmentId,
      checklistItemId,
      file: file as Express.Multer.File,
      uploadedBy: { type: "client", accountId },
    });

    return res.status(201).json({ success: true, data: uploaded });
  } catch (error) {
    return handleError(res, error);
  }
};

export const staffChecklistUploadController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const clientId = Number(req.body?.clientId);
    const assignmentId = Number(req.body?.assignmentId);
    const checklistItemId = String(req.body?.checklistItemId || "").trim();
    const file = req.file;

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }
    if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ message: "Valid assignmentId is required" });
    }
    if (!checklistItemId) {
      return res.status(400).json({ message: "checklistItemId is required" });
    }

    const uploaded = await uploadChecklistItemDocument({
      clientId,
      assignmentId,
      checklistItemId,
      file: file as Express.Multer.File,
      uploadedBy: { type: "staff", userId: authReq.user.id },
    });

    return res.status(201).json({ success: true, data: uploaded });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDocumentStorageUsageController = async (req: Request, res: Response) => {
  try {
    const clientId = req.clientPortalUser?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const usage = await getClientStorageUsage(clientId);
    return res.json({ success: true, data: usage });
  } catch (error) {
    return handleError(res, error);
  }
};

export const approveChecklistItemController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const clientId = Number(req.body?.clientId);
    const assignmentId = Number(req.body?.assignmentId);
    const checklistItemId = String(req.body?.checklistItemId || "").trim();

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }
    if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ message: "Valid assignmentId is required" });
    }
    if (!checklistItemId) {
      return res.status(400).json({ message: "checklistItemId is required" });
    }

    const result = await approveChecklistItemDocument({
      clientId,
      assignmentId,
      checklistItemId,
      reviewedByUserId: authReq.user.id,
      role: authReq.user.role,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

export const rejectChecklistItemController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const clientId = Number(req.body?.clientId);
    const assignmentId = Number(req.body?.assignmentId);
    const checklistItemId = String(req.body?.checklistItemId || "").trim();
    const rejectionReason = String(
      req.body?.rejectionReason ?? req.body?.rejection_reason ?? ""
    ).trim();

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }
    if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ message: "Valid assignmentId is required" });
    }
    if (!checklistItemId) {
      return res.status(400).json({ message: "checklistItemId is required" });
    }

    const result = await rejectChecklistItemDocument({
      clientId,
      assignmentId,
      checklistItemId,
      reviewedByUserId: authReq.user.id,
      role: authReq.user.role,
      rejectionReason,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

export const staffDocumentReviewEventsController = async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.clientId);
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }

    const events = await listDocumentReviewEventsForClient(clientId, 50);
    return res.json({
      success: true,
      data: events.map(mapReviewEventToUpdate),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const clientDocumentReviewEventsController = async (req: Request, res: Response) => {
  try {
    const clientId = req.clientPortalUser?.clientId;
    if (!clientId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const events = await listDocumentReviewEventsForClient(clientId, 20);
    return res.json({
      success: true,
      data: events.map(mapReviewEventToUpdate),
    });
  } catch (error) {
    return handleError(res, error);
  }
};
