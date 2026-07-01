import { Request, Response } from "express";
import { getLeadById } from "../../models/lead.model";
import { upsertInboundLead } from "../models/leadRegistration.model";
import { createInboundLeadEditLink } from "../models/leadEditToken.model";
import { parseInboundLeadBody } from "../services/leadRegistrationInbound.service";
import { publishFrontDeskOnWrite } from "../../frontdesk/services/frontdeskOnWrite.service";

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
      await publishFrontDeskOnWrite({
        reason: isNew ? "frontdesk:registered" : "frontdesk:inbound_updated",
        leadId,
        leadName: (lead as { fullName?: string | null }).fullName,
        snapshot: lead as Record<string, unknown>,
        notificationKind: isNew ? "lead_inbound_registered" : "lead_frontdesk_updated",
        skipNotification: false,
        leadChangeEvent: isNew ? "lead:created" : "lead:updated",
        leadChangePayload: lead as Record<string, unknown>,
        notificationDedupeKey: isNew
          ? `lead_inbound_registered:${leadId}`
          : `lead_inbound_updated:${leadId}:${Date.now()}`,
      });

      console.log(
        `[leadRegistration] inbound saved leadId=${leadId} isNew=${isNew} source=${parsed.payload.lead_source} → frontdesk realtime`
      );
    }

    const editLink = await createInboundLeadEditLink(leadId);

    res.status(200).json({
      success: true,
      received: true,
      leadId,
      leadSource: parsed.payload.lead_source,
      isNew,
      ...(editLink
        ? {
            editUrl: editLink.editUrl,
            editToken: editLink.rawToken,
            editExpiresAt: editLink.expiresAt.toISOString(),
            editTokenId: editLink.tokenId,
          }
        : {}),
    });
  } catch (err) {
    console.error("[leadRegistration] DB error:", err);
    res.status(500).json({ success: false, message: "Failed to save lead" });
  }
};
