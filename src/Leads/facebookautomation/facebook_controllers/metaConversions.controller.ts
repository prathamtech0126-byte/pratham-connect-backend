import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../../types/express-auth";
import { getLeadsByIds } from "../../models/lead.model";
import {
  getFacebookAccessToken,
  getFacebookAuthState,
} from "../facebook_models/facebookAuthState.model";
import { markLeadsSentToMeta } from "../facebook_models/facebookLead.model";
import {
  getMetaPixelId,
  resolveMetaConversionsAccessToken,
  sendMetaConversionEvents,
  type MetaConversionsSendMode,
} from "../facebook_services/metaConversions.service";

export const getMetaConversionsStatusController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const authState = await getFacebookAuthState(authReq.user.id);
  const dedicatedToken = Boolean(String(process.env.META_CONVERSIONS_ACCESS_TOKEN || "").trim());

  return res.json({
    success: true,
    data: {
      pixelId: getMetaPixelId(),
      facebookConnected: Boolean(authState),
      facebookExpired: Boolean(authState?.expiresAt && authState.expiresAt < new Date()),
      hasDedicatedAccessToken: dedicatedToken,
      usingFacebookUserTokenFallback: !dedicatedToken,
      account: authState?.account || null,
    },
  });
};

export const sendMetaConversionsEventsController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const leadIds = Array.isArray(req.body?.leadIds)
    ? req.body.leadIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
    : [];
  const sendMode: MetaConversionsSendMode =
    req.body?.sendMode === "quality" ? "quality" : "progress";

  if (!leadIds.length) {
    return res.status(400).json({ success: false, message: "leadIds is required" });
  }

  const dedicatedToken = Boolean(String(process.env.META_CONVERSIONS_ACCESS_TOKEN || "").trim());
  console.log("[MetaConversions] Send request received", {
    userId: authReq.user.id,
    leadIds,
    pixelId: getMetaPixelId(),
    hasDedicatedAccessToken: dedicatedToken,
  });

  const accessToken = await resolveMetaConversionsAccessToken(
    authReq.user.id,
    getFacebookAccessToken
  );
  if (!accessToken) {
    console.warn("[MetaConversions] Missing access token", {
      userId: authReq.user.id,
      hasDedicatedAccessToken: dedicatedToken,
    });
    return res.status(401).json({
      success: false,
      message:
        "Meta access token is not available. Connect Facebook or set META_CONVERSIONS_ACCESS_TOKEN.",
    });
  }

  const leadRows = await getLeadsByIds(leadIds);
  if (!leadRows.length) {
    console.warn("[MetaConversions] No matching leads found", { leadIds });
    return res.status(404).json({ success: false, message: "No matching leads found" });
  }

  const { results, metaResponses } = await sendMetaConversionEvents(accessToken, leadRows, sendMode);
  const sent = results.filter((result) => result.success).length;
  const failed = results.length - sent;

  // Mark successfully sent leads so they won't appear unsent next time.
  const successfulLeadIds = results.filter((r) => r.success).map((r) => r.leadId);
  if (successfulLeadIds.length) {
    await markLeadsSentToMeta(successfulLeadIds).catch((err) =>
      console.error("[MetaConversions] Failed to mark leads as sent", err)
    );
  }

  console.log("[MetaConversions] Send request completed", {
    userId: authReq.user.id,
    requested: leadIds.length,
    matched: leadRows.length,
    sent,
    failed,
    markedSent: successfulLeadIds.length,
    metaResponses,
  });

  return res.json({
    success: failed === 0,
    data: {
      sent,
      failed,
      results,
      metaResponses,
    },
  });
};
