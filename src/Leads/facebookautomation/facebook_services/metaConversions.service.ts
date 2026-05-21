import axios from "axios";
import crypto from "crypto";
import { leads } from "../../schemas/leads.schema";

const FB_API_VERSION = "v25.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
const DEFAULT_PIXEL_ID = "1469986234152292";
const MAX_EVENTS_PER_REQUEST = 1000;
const LOG_PREFIX = "[MetaConversions]";

type LeadRow = typeof leads.$inferSelect;

export type MetaConversionSendResult = {
  leadId: number;
  externalLeadId: string;
  success: boolean;
  eventName: string;
  eventId: string;
  error?: string;
};

export type MetaGraphBatchResponse = {
  batchIndex: number;
  httpStatus: number;
  success: boolean;
  body: unknown;
  payload: { data: unknown[] };
  errorMessage?: string;
};

export type SendMetaConversionEventsOutput = {
  results: MetaConversionSendResult[];
  metaResponses: MetaGraphBatchResponse[];
};

const shouldLogVerbose = () =>
  process.env.NODE_ENV !== "production" ||
  String(process.env.META_CONVERSIONS_DEBUG || "").trim() === "1";

const logInfo = (message: string, payload?: Record<string, unknown>) => {
  if (!shouldLogVerbose()) return;
  if (payload) console.log(LOG_PREFIX, message, payload);
  else console.log(LOG_PREFIX, message);
};

const logWarn = (message: string, payload?: Record<string, unknown>) => {
  if (payload) console.warn(LOG_PREFIX, message, payload);
  else console.warn(LOG_PREFIX, message);
};

const logError = (message: string, payload?: Record<string, unknown>) => {
  if (payload) console.error(LOG_PREFIX, message, payload);
  else console.error(LOG_PREFIX, message);
};

const normalizeAccessToken = (value: string) =>
  String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, "");

const resolveTestEventCode = () => {
  const code = String(process.env.META_CAPI_TEST_EVENT_CODE || "").trim();
  if (!code || code.toLowerCase() === "test_event") return "";
  return code;
};
const summarizeAccessToken = (accessToken: string) => ({
  source: String(process.env.META_CONVERSIONS_ACCESS_TOKEN || "").trim()
    ? "dedicated_env"
    : "facebook_user_fallback",
  length: accessToken.length,
  suffix: accessToken.slice(-4),
});

const getAppSecretProof = (accessToken: string) => {
  const appSecret = String(process.env.FB_APP_SECRET || "").trim();
  if (!appSecret) return undefined;
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
};

const formatMetaApiError = (error: any) => {
  const graphError = error?.response?.data?.error;
  if (!graphError) return error?.message || "Failed to send events to Meta";

  const parts = [
    graphError.message,
    graphError.error_user_msg,
    graphError.error_user_title,
    graphError.error_subcode != null ? `subcode ${graphError.error_subcode}` : null,
    graphError.code != null ? `code ${graphError.code}` : null,
    graphError.fbtrace_id ? `fbtrace_id ${graphError.fbtrace_id}` : null,
  ].filter(Boolean);

  if (graphError.code === 190) {
    parts.push(
      "Regenerate META_CONVERSIONS_ACCESS_TOKEN from Events Manager for this pixel and restart the backend."
    );
  }

  if (graphError.code === 100 && String(graphError.message || "").includes("appsecret_proof")) {
    parts.push(
      "Dedicated Events Manager tokens should not send appsecret_proof unless META_CAPI_SEND_APP_SECRET_PROOF=1 and FB_APP_SECRET matches the token app."
    );
  }

  return parts.join(" | ") || "Failed to send events to Meta";
};

const hashSha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const resolveExternalLeadIdForMeta = (lead: LeadRow) => {
  const externalLeadId = String(lead.externalLeadId || "").trim();
  return externalLeadId || null;
};

const resolveEventName = (lead: LeadRow) => String(lead.progressStatus || "not_contacted");

const resolveEventTime = () => Math.floor(Date.now() / 1000);

const buildCustomData = () => ({
  lead_event_source: String(process.env.META_LEAD_EVENT_SOURCE || "pratham crm").trim(),
  event_source: "crm",
});

const buildMetaLeadId = (externalLeadId: string) => {
  if (!/^\d+$/.test(externalLeadId)) return externalLeadId;
  const asNumber = Number(externalLeadId);
  return Number.isSafeInteger(asNumber) ? asNumber : externalLeadId;
};

const buildUserData = (lead: LeadRow, externalLeadId: string) => {
  const userData: Record<string, string | string[] | number> = {
    lead_id: buildMetaLeadId(externalLeadId),
  };

  const email = String(lead.email || "").trim().toLowerCase();
  if (email) {
    userData.em = [hashSha256(email)];
  }

  const phone = String(lead.phone || "").replace(/\D/g, "");
  if (phone) {
    userData.ph = [hashSha256(phone)];
  }

  return userData;
};

const buildEventPayload = (lead: LeadRow) => {
  const externalLeadId = resolveExternalLeadIdForMeta(lead);
  if (!externalLeadId) {
    throw new Error(`Lead ${lead.id} is missing external_lead_id`);
  }

  return {
    event_name: resolveEventName(lead),
    event_time: resolveEventTime(),
    action_source: "system_generated",
    user_data: buildUserData(lead, externalLeadId),
    custom_data: buildCustomData(),
  };
};

const summarizeLeadForLog = (lead: LeadRow) => ({
  crmLeadId: lead.id,
  externalLeadId: resolveExternalLeadIdForMeta(lead),
  metaLeadIdSent: resolveExternalLeadIdForMeta(lead),
  progressStatus: lead.progressStatus,
  eventName: resolveEventName(lead),
  eventTime: resolveEventTime(),
});

const buildResult = (
  lead: LeadRow,
  success: boolean,
  error?: string,
  eventsReceived = 0,
  fbTraceId = ""
) => {
  const externalLeadId = resolveExternalLeadIdForMeta(lead) || "";
  const eventName = resolveEventName(lead);
  const eventTime = resolveEventTime();

  return {
    leadId: lead.id,
    externalLeadId,
    success,
    eventName,
    eventId: `meta-${externalLeadId}-${eventTime}`,
    error:
      error ||
      (success ? undefined : fbTraceId || "Meta did not accept the event batch"),
  };
};

export const getMetaPixelId = () =>
  String(process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID).trim();

export const resolveMetaConversionsAccessToken = async (
  userId: number,
  getUserToken: (uid: number) => Promise<string | null>
) => {
  const dedicated = normalizeAccessToken(String(process.env.META_CONVERSIONS_ACCESS_TOKEN || ""));
  if (dedicated) return dedicated;
  const userToken = await getUserToken(userId);
  return userToken ? normalizeAccessToken(userToken) : null;
};

const usesDedicatedAccessToken = () =>
  Boolean(normalizeAccessToken(String(process.env.META_CONVERSIONS_ACCESS_TOKEN || "")));

const shouldAttachAppSecretProof = () => {
  const explicit = String(process.env.META_CAPI_SEND_APP_SECRET_PROOF || "").trim().toLowerCase();
  if (explicit === "1" || explicit === "true" || explicit === "yes") return true;
  if (explicit === "0" || explicit === "false" || explicit === "no") return false;
  return !usesDedicatedAccessToken();
};

export const sendMetaConversionEvents = async (
  accessToken: string,
  leadRows: LeadRow[]
): Promise<SendMetaConversionEventsOutput> => {
  const pixelId = getMetaPixelId();
  const results: MetaConversionSendResult[] = [];
  const metaResponses: MetaGraphBatchResponse[] = [];
  const sendable: LeadRow[] = [];
  const requestParams: Record<string, string> = { access_token: accessToken };
  const appsecretProof = shouldAttachAppSecretProof() ? getAppSecretProof(accessToken) : undefined;
  if (appsecretProof) requestParams.appsecret_proof = appsecretProof;

  const testEventCode = resolveTestEventCode();
  if (testEventCode) requestParams.test_event_code = testEventCode;

  logInfo("Preparing Meta send", {
    pixelId,
    requestedLeadCount: leadRows.length,
    token: summarizeAccessToken(accessToken),
    hasAppSecretProof: Boolean(appsecretProof),
    hasTestEventCode: Boolean(testEventCode),
    leadEventSource: buildCustomData().lead_event_source,
  });

  for (const lead of leadRows) {
    const externalLeadId = resolveExternalLeadIdForMeta(lead);
    if (!externalLeadId) {
      logWarn("Skipping lead without external_lead_id", summarizeLeadForLog(lead));
      results.push({
        leadId: lead.id,
        externalLeadId: "",
        success: false,
        eventName: resolveEventName(lead),
        eventId: `missing-external-id-${resolveEventTime()}`,
        error: "external_lead_id is required to send this lead to Meta",
      });
      continue;
    }

    if (externalLeadId === String(lead.id)) {
      logWarn("Skipping lead because external_lead_id matches CRM row id", summarizeLeadForLog(lead));
      results.push({
        leadId: lead.id,
        externalLeadId,
        success: false,
        eventName: resolveEventName(lead),
        eventId: `invalid-external-id-${resolveEventTime()}`,
        error: "external_lead_id must be the Facebook leadgen id, not the CRM row id",
      });
      continue;
    }

    sendable.push(lead);
  }

  if (!sendable.length) {
    logWarn("No sendable leads after validation", { requestedLeadCount: leadRows.length });
    return { results, metaResponses };
  }

  for (let i = 0; i < sendable.length; i += MAX_EVENTS_PER_REQUEST) {
    const batch = sendable.slice(i, i + MAX_EVENTS_PER_REQUEST);
    const data = batch.map((lead) => buildEventPayload(lead));
    const batchIndex = Math.floor(i / MAX_EVENTS_PER_REQUEST) + 1;

    logInfo("Sending batch to Meta", {
      batchIndex,
      batchSize: batch.length,
      endpoint: `${FB_GRAPH_BASE}/${pixelId}/events`,
      leads: batch.map((lead) => summarizeLeadForLog(lead)),
      payload: { data },
    });

    try {
      const response = await axios.post(
        `${FB_GRAPH_BASE}/${pixelId}/events`,
        { data },
        { params: requestParams }
      );

      const eventsReceived = Number(response.data?.events_received || 0);
      const fbTraceId = String(response.data?.fbtrace_id || "");
      const batchResponse: MetaGraphBatchResponse = {
        batchIndex,
        httpStatus: response.status,
        success: true,
        body: response.data,
        payload: { data },
      };

      metaResponses.push(batchResponse);
      console.log(`${LOG_PREFIX} Meta response.data`);
      console.log(JSON.stringify(response.data, null, 2));
      console.log(LOG_PREFIX, "Meta Graph API response", batchResponse);

      logInfo("Meta accepted batch", {
        batchIndex,
        eventsReceived,
        fbtrace_id: fbTraceId,
        response: response.data,
      });

      for (const lead of batch) {
        results.push(buildResult(lead, eventsReceived > 0, undefined, eventsReceived, fbTraceId));
      }
    } catch (error: any) {
      const message = formatMetaApiError(error);
      const batchResponse: MetaGraphBatchResponse = {
        batchIndex,
        httpStatus: Number(error?.response?.status || 500),
        success: false,
        body: error?.response?.data ?? null,
        payload: { data },
        errorMessage: message,
      };

      metaResponses.push(batchResponse);
      console.error(`${LOG_PREFIX} Meta response.data`);
      console.error(JSON.stringify(error?.response?.data ?? null, null, 2));
      console.error(LOG_PREFIX, "Meta Graph API response", batchResponse);

      logError("Meta rejected batch", {
        batchIndex,
        status: error?.response?.status,
        message,
        graphError: error?.response?.data?.error || null,
        responseBody: error?.response?.data || null,
        payload: { data },
      });

      for (const lead of batch) {
        results.push(buildResult(lead, false, message));
      }
    }
  }

  logInfo("Meta send finished", {
    requestedLeadCount: leadRows.length,
    sent: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    metaResponses,
  });

  return { results, metaResponses };
};
