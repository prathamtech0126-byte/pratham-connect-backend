import { Request, Response } from "express";
import { AuthenticatedRequest } from "../types/express-auth";
import {
  getMaintenancePublicState,
  setMaintenanceState,
} from "../services/maintenance.service";
import { emitToAll } from "../config/socket";

export const getMaintenanceStatusController = (_req: Request, res: Response) => {
  res.json({ success: true, ...getMaintenancePublicState() });
};

export const setMaintenanceStatusController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.role !== "developer") {
    return res.status(403).json({ success: false, message: "Only developers can toggle maintenance mode" });
  }
  const { isActive, startTime, endTime } = req.body;
  const armed = !!isActive;
  setMaintenanceState({
    isActive: armed,
    startTime: startTime || null,
    endTime: endTime || null,
  });

  const payload = getMaintenancePublicState();
  emitToAll("maintenance:changed", payload);
  res.json({ success: true, ...payload });
};
