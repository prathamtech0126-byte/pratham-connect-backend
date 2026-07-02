import { Request, Response } from "express";
import { ClientPortalAuthError } from "../services/clientPortalAuth.service";
import { getClientPortalDashboard } from "../services/clientPortalDashboard.service";

export const clientPortalDashboardController = async (req: Request, res: Response) => {
  try {
    const accountId = req.clientPortalUser?.accountId;
    if (!accountId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const dashboard = await getClientPortalDashboard(accountId);
    return res.status(200).json({ success: true, data: dashboard });
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] dashboard error:", err);
    return res.status(500).json({ message: "Failed to load dashboard" });
  }
};
