import { Request, Response } from "express";
import { checkDbConnection } from "../config/databaseConnection";

export const healthController = async (_req: Request, res: Response) => {
  try {
    // verify DB connectivity with a lightweight check
    await checkDbConnection();

    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ status: "error", db: "disconnected", message: err?.message ?? String(err) });
  }
};
