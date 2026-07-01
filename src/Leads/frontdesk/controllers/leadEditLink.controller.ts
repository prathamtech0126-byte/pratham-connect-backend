import { Request, Response } from "express";
import {
  createLeadEditLink,
  revokeLeadEditLink,
  listActiveEditLinksForLead,
} from "../../leadregistration/models/leadEditToken.model";
import { logFrontDeskActivity } from "../models/frontdesk.model";

const userId = (req: Request): number => (req as any).user?.id;

export const createLeadEditLinkController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const leadId = Number(req.params.id);
  if (!leadId) {
    res.status(400).json({ success: false, message: "Invalid lead ID" });
    return;
  }

  try {
    const result = await createLeadEditLink(leadId, userId(req));

    await logFrontDeskActivity({
      userId: userId(req),
      leadId,
      action: "create_edit_link",
      description: `Created client edit link (expires ${result.expiresAt.toISOString()})`,
      metadata: { tokenId: result.tokenId, expiresAt: result.expiresAt.toISOString() },
    });

    res.status(201).json({
      success: true,
      tokenId: result.tokenId,
      token: result.rawToken,
      editUrl: result.editUrl,
      expiresAt: result.expiresAt.toISOString(),
      leadId: result.leadId,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Failed to create edit link";
    const status =
      msg === "Lead not found"
        ? 404
        : msg.includes("Cannot create edit link")
          ? 422
          : 500;
    res.status(status).json({ success: false, message: msg });
  }
};

export const revokeLeadEditLinkController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const leadId = Number(req.params.id);
  const tokenId = Number(req.params.tokenId);
  if (!leadId || !tokenId) {
    res.status(400).json({ success: false, message: "Invalid lead or token ID" });
    return;
  }

  try {
    const revoked = await revokeLeadEditLink(leadId, tokenId);
    if (!revoked) {
      res.status(404).json({ success: false, message: "Edit link not found" });
      return;
    }

    await logFrontDeskActivity({
      userId: userId(req),
      leadId,
      action: "revoke_edit_link",
      description: "Revoked client edit link",
      metadata: { tokenId },
    });

    res.json({ success: true, message: "Edit link revoked" });
  } catch (err) {
    console.error("[frontdesk] revokeEditLink error:", err);
    res.status(500).json({ success: false, message: "Failed to revoke edit link" });
  }
};

export const listLeadEditLinksController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const leadId = Number(req.params.id);
  if (!leadId) {
    res.status(400).json({ success: false, message: "Invalid lead ID" });
    return;
  }

  try {
    const links = await listActiveEditLinksForLead(leadId);
    res.json({ success: true, data: links });
  } catch (err) {
    console.error("[frontdesk] listEditLinks error:", err);
    res.status(500).json({ success: false, message: "Failed to list edit links" });
  }
};
