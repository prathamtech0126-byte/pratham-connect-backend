import { Request, Response } from "express";
import { getLeadById } from "../../models/lead.model";
import { upsertInboundLead } from "../models/leadRegistration.model";
import { parseInboundLeadBody } from "../services/leadRegistrationInbound.service";
import { publishLeadChange } from "../../services/leadRealtime.service";

/**
 * Public inbound webhook — authenticated via HMAC (see verifySecondaryServerHmac).
 * Parses the JSON body, upserts into leads + detail tables.
 */
export const receiveLeadRegistrationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  let data: Record<string, unknown>;

  try {
    const raw = req.body;
    if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
      data = raw as Record<string, unknown>;
    } else if (typeof raw === "string") {
      data = JSON.parse(raw) as Record<string, unknown>;
    } else if (Buffer.isBuffer(raw)) {
      data = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    } else {
      res.status(400).json({ success: false, message: "Invalid JSON body" });
      return;
    }
  } catch {
    res.status(400).json({ success: false, message: "Invalid JSON body" });
    return;
  }

  const parsed = parseInboundLeadBody(data);
  if (!parsed.ok) {
    res.status(parsed.status).json({ success: false, message: parsed.message });
    return;
  }

  try {
    const { leadId, isNew } = await upsertInboundLead(parsed.payload);
    const lead = await getLeadById(leadId);
    if (lead) {
      await publishLeadChange(
        isNew ? "lead:created" : "lead:updated",
        lead as Record<string, unknown>
      );
    }

    res.status(200).json({
      success: true,
      received: true,
      leadId,
      leadSource: parsed.payload.lead_source,
      isNew,
    });
  } catch (err) {
    console.error("[leadRegistration] DB error:", err);
    res.status(500).json({ success: false, message: "Failed to save lead" });
  }
};
