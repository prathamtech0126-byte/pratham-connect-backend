import { Request, Response } from "express";
import { ClientPortalAuthError } from "../services/clientPortalAuth.service";
import { getClientPortalTimeline } from "../services/clientPortalTimeline.service";

export const clientPortalTimelineController = async (req: Request, res: Response) => {
  try {
    const accountId = req.clientPortalUser?.accountId;
    if (!accountId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const timeline = await getClientPortalTimeline(accountId);
    return res.status(200).json({ success: true, data: timeline });
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] timeline error:", err);
    return res.status(500).json({ message: "Failed to load timeline" });
  }
};
