import { NextFunction, Request, Response } from "express";
import { resolveLeadEditToken, LeadEditTokenRow } from "../models/leadEditToken.model";

export interface LeadEditTokenRequest extends Request {
  leadEditToken?: LeadEditTokenRow;
}

function extractRawToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }

  const headerToken = req.headers["x-lead-edit-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  const queryToken = req.query.token;
  if (typeof queryToken === "string" && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}

/**
 * Validates a front-desk issued edit link token.
 * Accepts Bearer token, X-Lead-Edit-Token header, or ?token= query param.
 */
export async function requireLeadEditToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawToken = extractRawToken(req);
  if (!rawToken) {
    res.status(401).json({ success: false, message: "Invalid or expired edit link" });
    return;
  }

  try {
    const row = await resolveLeadEditToken(rawToken);
    if (!row) {
      res.status(401).json({ success: false, message: "Invalid or expired edit link" });
      return;
    }

    (req as LeadEditTokenRequest).leadEditToken = row;
    next();
  } catch (err) {
    console.error("[leadEditToken] validation error:", err);
    res.status(500).json({ success: false, message: "Failed to validate edit link" });
  }
}
