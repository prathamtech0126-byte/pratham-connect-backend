import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../../types/express-auth";
import { canUserViewClient } from "../../clients/services/clientAccess.service";
import {
  ClientPortalError,
  getClientPortalStatus,
  resetClientPortalPassword,
  sendClientPortalInvitation,
} from "../services/clientPortalInvitation.service";

function parseClientId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const sendPortalInvitationController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return res.status(400).json({ message: "Invalid clientId" });
    }

    const deliveryEmail =
      typeof req.body?.deliveryEmail === "string"
        ? req.body.deliveryEmail
        : typeof req.body?.delivery_email === "string"
          ? req.body.delivery_email
          : undefined;

    const result = await sendClientPortalInvitation(
      clientId,
      authReq.user.id,
      authReq.user.role,
      { deliveryEmail }
    );

    return res.status(result.resent ? 200 : 201).json({
      message: result.emailDelivered
        ? result.resent
          ? "Portal invitation resent"
          : "Portal invitation sent"
        : "Portal account created but email was not delivered",
      ...result,
    });
  } catch (err) {
    if (err instanceof ClientPortalError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] invitation error:", err);
    return res.status(500).json({ message: "Failed to send portal invitation" });
  }
};

export const getPortalStatusController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return res.status(400).json({ message: "Invalid clientId" });
    }

    const canView = await canUserViewClient(clientId, authReq.user.id, authReq.user.role);
    if (!canView) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const status = await getClientPortalStatus(clientId);
    return res.status(200).json(status);
  } catch (err) {
    console.error("[clientPortal] status error:", err);
    return res.status(500).json({ message: "Failed to load portal status" });
  }
};

export const resetPortalPasswordController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return res.status(400).json({ message: "Invalid clientId" });
    }

    const result = await resetClientPortalPassword(clientId, authReq.user.id, authReq.user.role);

    return res.status(200).json({
      message: result.emailDelivered
        ? "New portal password sent"
        : "Password reset but email was not delivered",
      ...result,
    });
  } catch (err) {
    if (err instanceof ClientPortalError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] reset password error:", err);
    return res.status(500).json({ message: "Failed to reset portal password" });
  }
};
