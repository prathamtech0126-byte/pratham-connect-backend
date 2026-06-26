import { Request, Response } from "express";
import axios, { type AxiosResponse } from "axios";
import crypto from "crypto";
import { AuthenticatedRequest } from "../../../types/express-auth";
import { db } from "../../../config/databaseConnection";
import { leads } from "../../schemas/leads.schema";
import { insertLeadRecord } from "../../services/leadInsert.service";
import { mapPlatformToLeadType } from "../../models/leadType.model";
import {
  clearFacebookAuthState,
  getFacebookAccessToken,
  getFacebookAuthState,
  updateFacebookAccountMeta,
  upsertFacebookAuthState,
} from "../facebook_models/facebookAuthState.model"
import {
  clearFacebookPageTokens,
  getFacebookPageAccessToken,
  listFacebookPagesFromDb,
  syncFacebookPages,
  upsertFacebookPageTokens,
} from "../facebook_models/facebookAuthState.model"; 
import {
  applyLeadTypeLabelToFormLeads,
  clearMasterDistributionGroup,
  detachFormFromMasterDistribution,
  distributeLeadsManually,
  distributeLeadsManuallyBulkAcrossForms,
  ensureFacebookLeadsEligibleForInactiveManualBulk,
  getFacebookManualDistributionAssigneeStats,
  getFacebookManualDistributionLeadRowsPaginated,
  getFormLeadsForExport,
  getFormLeadsPaginated,
  getFormStats,
  getFormStatsBulk,
  getFormStrategy,
  getFormStrategiesByPage,
  getFormsWithUnassignedLeads,
  getMasterDistributionGroupsByPage,
  listActiveFormStrategies,
  pickNextAssignee,
  setMasterManaged,
  syncFormsForPage,
  touchLastLeadCreatedTime,
  updateFormActiveStatus,
  upsertFormStrategy,
} from "../facebook_models/facebookFormStrategy.model";
import {
  parseLeadTypeFromBody,
  resolveLeadTypeSelection,
  resolveLeadTypeLabelForStrategy,
  strategyHasLeadType,
  type ResolvedLeadTypeSelection,
} from "../leadTypeSelection.util";

const resolveLeadTypeFromBody = async (
  body: Record<string, unknown>
): Promise<ResolvedLeadTypeSelection | { message: string; status: number }> => {
  try {
    const input = parseLeadTypeFromBody(body);
    return await resolveLeadTypeSelection(input);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "LEAD_TYPE_REQUIRED") {
      return {
        message: "Lead type is required (select a type or enter a custom name up to 50 characters)",
        status: 400,
      };
    }
    return { message: "Invalid lead type", status: 400 };
  }
};
import { eq } from "drizzle-orm";
import {
  FacebookImportInactiveFormError,
  getRecentImportedLeads,
  importLeadsForForm,
  previewNewLeadCountForForm,
} from "../facebook_services/facebookLeadQueue.service";
import {
  refreshFacebookAuthIfExpired,
  runActiveFacebookFormImportsForUser,
  runFacebookFormImportsSequentially,
} from "../facebook_services/facebookAutomationStore.service";

const FB_API_VERSION = "v25.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
const FB_DIALOG_BASE = `https://www.facebook.com/${FB_API_VERSION}`;
const MAX_MASTER_DISTRIBUTION_FORMS = 5;
const FB_SCOPES = [
  "pages_show_list",
  "leads_retrieval",
  "pages_read_engagement",
  "pages_manage_metadata",
  "business_management",
].join(",");

const sseClients = new Map<number, Set<Response>>();

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const appSecretProof = (accessToken: string) => {
  const appSecret = getRequiredEnv("FB_APP_SECRET");
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
};

const fbParams = (accessToken: string, extra: Record<string, unknown> = {}) => ({
  access_token: accessToken,
  appsecret_proof: appSecretProof(accessToken),
  ...extra,
});

const signState = (payload: object) => {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = getRequiredEnv("JWT_SECRET");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
};

const readState = (state: string): null | { uid: number; origin: string; ts: number } => {
  try {
    const [data, sig] = state.split(".");
    if (!data || !sig) return null;
    const secret = getRequiredEnv("JWT_SECRET");
    const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    if (sig !== expected) return null;
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as {
      uid: number;
      origin: string;
      ts: number;
    };
    if (!parsed?.uid || !parsed?.origin || !parsed?.ts) return null;
    const maxAgeMs = 15 * 60 * 1000;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
};

const extractField = (fieldData: any[] | undefined, keys: string[]) => {
  const item = (fieldData || []).find((f) => keys.includes(String(f?.name || "").toLowerCase()));
  const first = item?.values?.[0];
  return typeof first === "string" ? first.trim() : "";
};

const normalizePhone = (raw: string) => raw.replace(/[^\d+]/g, "");

const getPageTokenFast = async (ownerUserId: number, pageId: string): Promise<string | null> => {
  const cached = await getFacebookPageAccessToken(ownerUserId, pageId);
  if (cached) return cached;
  const userToken = await getFacebookAccessToken(ownerUserId);
  if (!userToken) return null;
  const r = await axios.get(`${FB_GRAPH_BASE}/me/accounts`, { params: fbParams(userToken) });
  const page = (r.data?.data || []).find((p: any) => p.id === pageId);
  return page?.access_token || null;
};

const broadcastToUser = (userId: number, payload: unknown) => {
  const clients = sseClients.get(userId);
  if (!clients?.size) return;
  const chunk = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => res.write(chunk));
};

type MappedLead = {
  externalLeadId: string;
  /** Facebook Graph `created_time` for this lead (falls back to now if missing). */
  leadCreatedAt: Date;
  fullName: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  /** Derived from the Meta `platform` value: "facebook" | "instagram" (matches `lead_type` catalog rows). */
  leadSource: string;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string;
  formName: string | null;
  pageId: string | null;
  pageName: string | null;
  customAnswers: Record<string, unknown>;
  latestNote: string;
};

const mapFacebookLead = (
  leadData: any,
  meta: { formId: string; formName?: string; pageId: string; pageName?: string }
): MappedLead | null => {
  const fieldData = Array.isArray(leadData?.field_data) ? leadData.field_data : [];
  const fullName = extractField(fieldData, ["full_name", "full name", "name"]) || "Facebook Lead";
  const phone = normalizePhone(
    extractField(fieldData, ["phone_number", "phone", "mobile", "whatsapp"])
  );
  const safePhone = phone || `unknown_${String(leadData?.id || "").slice(-20)}`.slice(0, 30);
  const email = extractField(fieldData, ["email", "email_address"]) || null;
  const city = extractField(fieldData, ["city", "location"]) || null;
  const customAnswers: Record<string, unknown> = {};
  for (const item of fieldData) {
    const key = String(item?.name || "").trim();
    if (!key) continue;
    customAnswers[key] = item?.values || [];
  }
  // The Meta `platform` value ("fb" / "ig" / full name) is mapped to a slug
  // and stored in `leads.lead_source` so it matches the seeded `lead_type`
  // catalog rows and works with the existing source filter on the Leads list.
  const sourceSlug = mapPlatformToLeadType(leadData.platform) ?? "facebook";
  return {
    externalLeadId: String(leadData.id || ""),
    leadCreatedAt: leadData.created_time ? new Date(leadData.created_time) : new Date(),
    fullName,
    phone: safePhone,
    whatsapp: phone || null,
    email,
    city,
    leadSource: sourceSlug,
    campaignId: leadData.campaign_id || null,
    campaignName: leadData.campaign_name || null,
    adsetId: leadData.adset_id || null,
    adsetName: leadData.adset_name || null,
    adId: leadData.ad_id || null,
    adName: leadData.ad_name || null,
    formId: meta.formId,
    formName: meta.formName ?? null,
    pageId: meta.pageId,
    pageName: meta.pageName ?? null,
    customAnswers,
    latestNote: "",
  };
};

const insertLeadToDB = async (
  mapped: MappedLead,
  strategyRow: Awaited<ReturnType<typeof getFormStrategy>>
): Promise<boolean> => {
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.externalLeadId, mapped.externalLeadId));
  if (existing.length > 0) return false;

  let currentTelecallerId: number | undefined;
  let currentCounsellorId: number | undefined;
  let assignmentStatus: "not_assigned" | "assigned" = "not_assigned";

  if (strategyRow) {
    try {
      const assignee = await pickNextAssignee(strategyRow);
      if (assignee) {
        if (assignee.role === "telecaller") currentTelecallerId = assignee.userId;
        else currentCounsellorId = assignee.userId;
        assignmentStatus = "assigned";
      }
    } catch {
      // non-fatal
    }
  }

  const storedAt = new Date();
  const leadTypeLabel = strategyRow
    ? await resolveLeadTypeLabelForStrategy(strategyRow)
    : null;
  await insertLeadRecord(
    {
      externalLeadId: mapped.externalLeadId || undefined,
      createdAt: storedAt,
      updatedAt: storedAt,
      fullName: mapped.fullName,
      phone: mapped.phone,
      whatsapp: mapped.whatsapp ?? undefined,
      email: mapped.email ?? undefined,
      city: mapped.city ?? undefined,
      leadSource: mapped.leadSource,
      latestNote: mapped.latestNote,
      leadType: leadTypeLabel ?? undefined,
      currentTelecallerId,
      currentCounsellorId,
      assignmentStatus,
    },
    {
      campaignId: mapped.campaignId ?? null,
      campaignName: mapped.campaignName ?? null,
      adsetId: mapped.adsetId ?? null,
      adsetName: mapped.adsetName ?? null,
      adId: mapped.adId ?? null,
      adName: mapped.adName ?? null,
      formId: mapped.formId,
      formName: mapped.formName ?? null,
      facebookCreatedAt: mapped.leadCreatedAt,
      customAnswers: mapped.customAnswers,
    }
  );

  return true;
};

// ── Auth controllers ─────────────────────────────────────────────────────────

export const getFacebookAuthUrlController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const origin =
      typeof req.query.origin === "string" && /^https?:\/\//.test(req.query.origin)
        ? req.query.origin
        : process.env.FRONTEND_URL || "";
    const state = signState({ uid: authReq.user.id, origin, ts: Date.now() });
    const redirectUri = getRequiredEnv("FB_REDIRECT_URI");
    const appId = getRequiredEnv("FB_APP_ID");
    const url =
      `${FB_DIALOG_BASE}/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(FB_SCOPES)}` +
      `&state=${encodeURIComponent(state)}`;
    return res.json({ success: true, url });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const facebookCallbackController = async (req: Request, res: Response) => {
  const code = String(req.query.code || "");
  const stateRaw = String(req.query.state || "");
  const state = readState(stateRaw);
  if (!code || !state) return res.status(400).send("Invalid Facebook callback");

  try {
    const appId = getRequiredEnv("FB_APP_ID");
    const appSecret = getRequiredEnv("FB_APP_SECRET");
    const redirectUri = getRequiredEnv("FB_REDIRECT_URI");

    const shortTokenRes = await axios.get(`${FB_GRAPH_BASE}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    });
    const shortAccessToken = String(shortTokenRes.data?.access_token || "");
    if (!shortAccessToken) return res.status(400).send("Missing access token");

    let accessToken = shortAccessToken;
    let expiresAt: Date | null = null;
    try {
      const longTokenRes = await axios.get(`${FB_GRAPH_BASE}/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortAccessToken,
        },
      });
      const longToken = String(longTokenRes.data?.access_token || "");
      const expiresIn = Number(longTokenRes.data?.expires_in || 0);
      if (longToken) {
        accessToken = longToken;
        expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
      }
    } catch { /* non-fatal */ }

    let accountMeta: { id: string; name: string; pictureUrl?: string | null } | null = null;
    try {
      const meRes = await axios.get(`${FB_GRAPH_BASE}/me`, {
        params: fbParams(accessToken, { fields: "id,name,picture.width(120).height(120)" }),
      });
      accountMeta = {
        id: String(meRes.data?.id || ""),
        name: String(meRes.data?.name || "Facebook User"),
        pictureUrl: meRes.data?.picture?.data?.url || null,
      };
    } catch { /* non-fatal */ }

    await upsertFacebookAuthState(state.uid, accessToken, accountMeta, expiresAt);

    try {
      const accountsRes = await axios.get(`${FB_GRAPH_BASE}/me/accounts`, {
        params: fbParams(accessToken, { fields: "id,name,access_token,picture.width(120).height(120)" }),
      });
      const pages = (accountsRes.data?.data || [])
        .map((p: any) => ({
          id: String(p.id || ""),
          name: String(p.name || p.id || ""),
          pictureUrl: p?.picture?.data?.url || null,
          accessToken: String(p.access_token || ""),
        }))
        .filter((p: any) => p.id && p.accessToken);
      await syncFacebookPages(state.uid, pages);
    } catch { /* non-fatal */ }

    return res.redirect(`${state.origin}/leads/automation/facebook?connected=1`);
  } catch {
    return res.status(500).send("Facebook authentication failed");
  }
};

export const getFacebookStatusController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user.id;
  let refreshedExpiredToken = false;
  try {
    refreshedExpiredToken = await refreshFacebookAuthIfExpired(userId);
    if (refreshedExpiredToken) {
      void runActiveFacebookFormImportsForUser(userId);
    }
  } catch {
    refreshedExpiredToken = false;
  }

  const token = await getFacebookAccessToken(userId);
  const authState = await getFacebookAuthState(userId);
  const activeStrategies = await listActiveFormStrategies();
  const pages = await listFacebookPagesFromDb(userId);

  if (token && !authState?.account) {
    try {
      const meRes = await axios.get(`${FB_GRAPH_BASE}/me`, {
        params: fbParams(token, { fields: "id,name,picture.width(200).height(200)" }),
      });
      await updateFacebookAccountMeta(userId, {
        id: String(meRes.data?.id || ""),
        name: String(meRes.data?.name || "Facebook User"),
        pictureUrl: meRes.data?.picture?.data?.url || null,
      });
    } catch { /* non-fatal */ }
  }

  const latestAuthState = await getFacebookAuthState(userId);
  const isExpired = latestAuthState?.expiresAt ? latestAuthState.expiresAt < new Date() : false;
  return res.json({
    success: true,
    data: {
      connected: Boolean(token),
      isExpired,
      expiresAt: latestAuthState?.expiresAt ?? null,
      account: latestAuthState?.account ?? null,
      connectedAt: latestAuthState?.connectedAt ?? null,
      activeFormsCount: activeStrategies.length,
      pagesCount: pages.length,
      refreshedExpiredToken,
    },
  });
};

export const disconnectFacebookController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  await clearFacebookAuthState(authReq.user.id);
  await clearFacebookPageTokens(authReq.user.id);
  return res.json({ success: true });
};

// ── Pages controller ─────────────────────────────────────────────────────────

export const getFacebookPagesController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const refresh = String((req.query as any)?.refresh || "") === "1";
  const token = await getFacebookAccessToken(authReq.user.id);
  if (!token) return res.status(401).json({ success: false, message: "Not connected" });

  try {
    if (!refresh) {
      const cached = await listFacebookPagesFromDb(authReq.user.id);
      if (cached.length > 0) return res.json({ success: true, data: cached });
    }

    const r = await axios.get(`${FB_GRAPH_BASE}/me/accounts`, {
      params: fbParams(token, { fields: "id,name,access_token,picture.width(120).height(120)" }),
    });
    const pages = (r.data?.data || []).map((p: any) => ({
      id: String(p.id || ""),
      name: String(p.name || p.id || ""),
      pictureUrl: p?.picture?.data?.url || null,
    }));
    const tokenRows = (r.data?.data || [])
      .map((p: any) => ({
        id: String(p.id || ""),
        name: String(p.name || p.id || ""),
        pictureUrl: p?.picture?.data?.url || null,
        accessToken: String(p.access_token || ""),
      }))
      .filter((p: any) => p.id && p.accessToken);

    if (refresh) {
      await syncFacebookPages(authReq.user.id, tokenRows);
    } else {
      await upsertFacebookPageTokens(authReq.user.id, tokenRows);
    }
    return res.json({ success: true, data: pages });
  } catch (error: any) {
    const fbCode = error?.response?.data?.error?.code;
    if (fbCode === 190) {
      await clearFacebookAuthState(authReq.user.id);
      await clearFacebookPageTokens(authReq.user.id);
      return res.status(401).json({ success: false, message: "Facebook session expired" });
    }
    return res.status(500).json({ success: false, message: "Failed to fetch pages" });
  }
};

// ── Forms controllers ────────────────────────────────────────────────────────

/**
 * Default: read forms from DB (no Facebook API call).
 * With ?refresh=1: fetch live forms from Facebook, sync DB (insert new, archive missing).
 */
export const getFacebookFormsController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { pageId } = req.params;
  const refresh = String((req.query as any)?.refresh || "") === "1";
  const token = await getFacebookAccessToken(authReq.user.id);
  if (!token) return res.status(401).json({ success: false, message: "Not connected" });

  try {
    if (!refresh) {
      const dbForms = await getFormStrategiesByPage(pageId);
      return res.json({
        success: true,
        data: dbForms
          .filter((f) => !f.isArchived)
          .map((f) => ({ id: f.formId, name: f.formName || f.formId, isArchived: false })),
        archived: dbForms
          .filter((f) => f.isArchived)
          .map((f) => ({ id: f.formId, name: f.formName || f.formId, isArchived: true })),
      });
    }

    const pageToken = await getPageTokenFast(authReq.user.id, pageId);
    if (!pageToken) return res.status(403).json({ success: false, message: "Page token missing" });

    /** Always include `status` so archived forms sync correctly (never fall back to a request without it). */
    const fieldSets = [
      "id,name,status,locale,leads_count,page,tracking_parameters,questions{id,key,label,type,options},context_card,legal_content",
      "id,name,status,locale,leads_count,page",
      "id,name,status",
    ] as const;

    let r: AxiosResponse<unknown> | undefined;
    for (const fs of fieldSets) {
      try {
        r = await axios.get(`${FB_GRAPH_BASE}/${pageId}/leadgen_forms`, {
          params: fbParams(pageToken, { fields: fs }),
        });
        break;
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (fs === fieldSets[fieldSets.length - 1] || status !== 400) throw e;
      }
    }
    if (r === undefined) throw new Error("leadgen_forms request failed");

    const graphPayload = r.data as { data?: unknown[] };
    const liveForms = (graphPayload?.data || []).map((f: any) => ({
      id: String(f.id || ""),
      name: String(f.name || f.id || ""),
      archivedFromFb: String(f.status || "").toUpperCase() === "ARCHIVED",
    }));

    const { live, archived } = await syncFormsForPage(pageId, liveForms, authReq.user.id);

    return res.json({
      success: true,
      data: live.map((f) => ({ id: f.formId, name: f.formName || f.formId, isArchived: false })),
      archived: archived.map((f) => ({
        id: f.formId,
        name: f.formName || f.formId,
        isArchived: true,
      })),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch forms" });
  }
};

export const toggleFacebookFormController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { pageId, formId } = req.params;
  const { formName, pageName, distributionStrategy } = req.body || {};
  const token = await getFacebookAccessToken(authReq.user.id);
  if (!token) return res.status(401).json({ success: false, message: "Not connected" });

  const strategyRow = await getFormStrategy(formId).catch(() => null);
  const currentlyActive = Boolean(strategyRow?.isActive);
  const isActivating = !currentlyActive;

  if (isActivating && strategyRow?.isArchived) {
    return res.status(400).json({
      success: false,
      message: "This form is archived in Facebook Ads and cannot be activated.",
    });
  }

  if (isActivating) {
    if (!strategyRow) {
      return res.status(400).json({
        success: false,
        message: "Please configure this form's distribution strategy before activating.",
      });
    }
    const memberCount =
      (strategyRow.assignedTelecallers?.length ?? 0) +
      (strategyRow.assignedCounsellors?.length ?? 0);
    if (memberCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Please assign at least one team member in the strategy configuration before activating.",
      });
    }
    if (!strategyHasLeadType(strategyRow)) {
      return res.status(400).json({
        success: false,
        message: "Please select a lead type in the form configuration before activating.",
      });
    }
  }

  const active = !currentlyActive;
  await updateFormActiveStatus(formId, active);

  if (active) {
    let imported = 0;
    try {
      const pageToken = await getPageTokenFast(authReq.user.id, pageId);
      if (pageToken) {
        await axios.post(`${FB_GRAPH_BASE}/${pageId}/subscribed_apps`, null, {
          params: fbParams(pageToken, { subscribed_fields: "leadgen" }),
        });
        imported = await importLeadsForForm(formId);
      }
    } catch { /* non-fatal */ }

    if (strategyRow && strategyHasLeadType(strategyRow)) {
      const label = await resolveLeadTypeLabelForStrategy(strategyRow);
      if (label) await applyLeadTypeLabelToFormLeads(formId, label).catch(() => null);
    }

    const strategy = strategyRow?.strategy || String(distributionStrategy || "round_robin");
    return res.json({ success: true, data: { active, imported, distributionStrategy: strategy } });
  }

  return res.json({
    success: true,
    data: { active, imported: 0, distributionStrategy: String(distributionStrategy || "round_robin") },
  });
};

export const getFormStrategyController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  try {
    const row = await getFormStrategy(formId);
    return res.json({ success: true, data: row ?? null });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch strategy" });
  }
};

export const setFacebookFormStrategyController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { formId } = req.params;
  const {
    distributionStrategy,
    assignedTelecallers,
    assignedCounsellors,
    priorityWeights,
    formName,
    pageId,
    pageName,
    leadTypeId,
    customLeadTypeName,
  } = req.body || {};

  const strategy = String(distributionStrategy || "").trim();
  if (!strategy) {
    return res.status(400).json({ success: false, message: "distributionStrategy is required" });
  }
  const resolved = await resolveLeadTypeFromBody({
    leadTypeId,
    customLeadTypeName,
  });
  if ("message" in resolved) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }

  try {
    const row = await upsertFormStrategy({
      formId,
      formName: formName ? String(formName) : undefined,
      pageId: pageId ? String(pageId) : undefined,
      pageName: pageName ? String(pageName) : undefined,
      strategy,
      assignedTelecallers: Array.isArray(assignedTelecallers) ? assignedTelecallers.map(Number) : [],
      assignedCounsellors: Array.isArray(assignedCounsellors) ? assignedCounsellors.map(Number) : [],
      priorityWeights: priorityWeights && typeof priorityWeights === "object" ? priorityWeights : {},
      leadTypeId: resolved.leadTypeId,
      masterDistributionGroup: resolved.masterDistributionGroup,
      createdBy: authReq.user.id,
    });
    await applyLeadTypeLabelToFormLeads(formId, resolved.label).catch(() => null);
    return res.json({ success: true, data: row });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save strategy" });
  }
};

export const getFacebookActiveFormsController = async (req: Request, res: Response) => {
  const activeRows = await listActiveFormStrategies();
  const data = activeRows.reduce<Record<string, any>>((acc, row) => {
    acc[row.formId] = {
      formId: row.formId,
      formName: row.formName || row.formId,
      pageId: row.pageId || "",
      pageName: row.pageName || row.pageId || "",
      distributionStrategy: row.strategy,
      active: row.isActive,
      activatedAt: row.updatedAt,
      deactivatedAt: null,
    };
    return acc;
  }, {});
  return res.json({ success: true, data });
};

// ── Lead controllers ─────────────────────────────────────────────────────────

export const getFacebookImportedLeadsController = async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const formId = typeof req.query.formId === "string" ? req.query.formId : "";
  const rows = await getRecentImportedLeads(formId, limit);
  return res.json({ success: true, data: rows });
};

export const getFormStatsController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  try {
    const [stats, strategy] = await Promise.all([getFormStats(formId), getFormStrategy(formId)]);
    return res.json({
      success: true,
      data: {
        ...stats,
        formName: strategy?.formName ?? formId,
        isActive: strategy?.isActive ?? false,
        strategy: strategy?.strategy ?? "round_robin",
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

export const getFormLeadsPaginatedController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const filter = (req.query.filter as string) === "unassigned" ? "unassigned" : "all";
  try {
    const result = await getFormLeadsPaginated(formId, page, limit, filter);
    return res.json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leads" });
  }
};

export const exportFormLeadsCsvController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  try {
    const rows = await getFormLeadsForExport(formId);
    if (rows.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="leads-${formId}.csv"`);
      return res.send("Name,Phone,Email,City,Status,Assigned To,Campaign,Ad,Form,Created At\n");
    }

    // Collect all custom answer keys
    const customKeys = new Set<string>();
    for (const r of rows) {
      const ca = r.custom_answers as Record<string, unknown> || {};
      Object.keys(ca).forEach((k) => customKeys.add(k));
    }
    const customKeysArr = Array.from(customKeys);

    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const headers = [
      "Name", "Phone", "Email", "City", "Assignment Status", "Progress Status",
      "Assigned To", "Campaign", "Ad", "Form", "Lead ID", "Note", "Created At",
      ...customKeysArr,
    ];

    const csvLines: string[] = [headers.map(escape).join(",")];
    for (const r of rows) {
      const assignedTo = r.telecaller_name || r.counsellor_name || "";
      const ca = r.custom_answers as Record<string, unknown> || {};
      const customVals = customKeysArr.map((k) => {
        const v = ca[k];
        return Array.isArray(v) ? v.join("; ") : (v ?? "");
      });
      csvLines.push([
        escape(r.full_name),
        escape(r.phone),
        escape(r.email),
        escape(r.city),
        escape(r.assignment_status),
        escape(r.progress_status),
        escape(assignedTo),
        escape(r.campaign_name),
        escape(r.ad_name),
        escape(r.form_name),
        escape(r.external_lead_id),
        escape(r.latest_note),
        escape(r.created_at ? new Date(r.created_at).toLocaleString() : ""),
        ...customVals.map(escape),
      ].join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${formId}.csv"`);
    return res.send(csvLines.join("\n"));
  } catch {
    return res.status(500).json({ success: false, message: "Failed to export leads" });
  }
};

export const distributeLeadsManuallyController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  const { leadIds, strategy, assignedTelecallers, assignedCounsellors, priorityWeights, leadTypeId, customLeadTypeName } =
    req.body || {};

  const strategyRow = await getFormStrategy(formId).catch(() => null);
  if (strategyRow?.isActive) {
    return res.status(409).json({
      success: false,
      message: "Manual distribution is disabled while form is active. Deactivate the form first.",
    });
  }

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: "leadIds array is required" });
  }
  const resolved = await resolveLeadTypeFromBody({ leadTypeId, customLeadTypeName });
  if ("message" in resolved) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }
  const tcs = Array.isArray(assignedTelecallers) ? assignedTelecallers.map(Number) : [];
  const cos = Array.isArray(assignedCounsellors) ? assignedCounsellors.map(Number) : [];
  if (tcs.length + cos.length === 0) {
    return res.status(400).json({ success: false, message: "Select at least one team member" });
  }

  try {
    const result = await distributeLeadsManually(
      formId,
      leadIds.map(Number),
      String(strategy || "round_robin"),
      tcs,
      cos,
      priorityWeights && typeof priorityWeights === "object" ? priorityWeights : {},
      resolved
    );
    return res.json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to distribute leads" });
  }
};

export const getFacebookLeadPreviewController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  try {
    const newLeads = await previewNewLeadCountForForm(formId);
    return res.json({ success: true, data: { formId, newLeads } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to preview leads" });
  }
};

export const importFacebookFormLeadsController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  const importOnly =
    req.query.importOnly === "1" ||
    req.query.importOnly === "true" ||
    String(req.query.importOnly || "").toLowerCase() === "yes";
  try {
    const imported = await importLeadsForForm(formId, {
      ...(importOnly ? { skipDistribution: true } : {}),
    });
    return res.json({
      success: true,
      data: { formId, imported, importOnly: importOnly || undefined },
    });
  } catch (e) {
    if (e instanceof FacebookImportInactiveFormError) {
      return res.status(400).json({
        success: false,
        message: e.message,
        code: e.code,
      });
    }
    return res.status(500).json({ success: false, message: "Failed to import leads" });
  }
};

export const getFormStatsBulkController = async (req: Request, res: Response) => {
  const { formIds } = req.body || {};
  const ids = Array.isArray(formIds) ? formIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) {
    return res.json({ success: true, data: {} });
  }
  try {
    const bulk = await getFormStatsBulk(ids);
    const entries = await Promise.all(
      ids.map(async (fid) => {
        const strategy = await getFormStrategy(fid).catch(() => null);
        const s = bulk[fid] ?? {
          totalLeads: 0,
          distributedLeads: 0,
          unassignedLeads: 0,
        };
        return [
          fid,
          {
            ...s,
            formName: strategy?.formName ?? fid,
            isActive: strategy?.isActive ?? false,
            strategy: strategy?.strategy ?? "round_robin",
          },
        ] as const;
      })
    );
    const data = Object.fromEntries(entries);
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch bulk stats" });
  }
};

export const getFacebookManualDistributionLeadsController = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 20)));
  const rawAssignment = String(req.query.assignment || "unassigned");
  const assignment =
    rawAssignment === "assigned" || rawAssignment === "unassigned" ? rawAssignment : "all";
  const formId = typeof req.query.formId === "string" && req.query.formId ? req.query.formId : undefined;
  let createdFrom: Date | undefined;
  let createdTo: Date | undefined;
  if (typeof req.query.createdFrom === "string" && req.query.createdFrom) {
    createdFrom = new Date(req.query.createdFrom);
  }
  if (typeof req.query.createdTo === "string" && req.query.createdTo) {
    createdTo = new Date(req.query.createdTo);
  }

  try {
    const result = await getFacebookManualDistributionLeadRowsPaginated({
      page,
      limit,
      assignment,
      formId,
      createdFrom: Number.isFinite(createdFrom?.getTime()) ? createdFrom : undefined,
      createdTo: Number.isFinite(createdTo?.getTime()) ? createdTo : undefined,
    });
    return res.json({
      success: true,
      data: {
        ...result,
        data: result.data.map((row) => ({
          ...row,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
          facebookCreatedAt:
            row.facebookCreatedAt instanceof Date
              ? row.facebookCreatedAt.toISOString()
              : String(row.facebookCreatedAt),
        })),
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch leads" });
  }
};

//  export const getFacebookManualDistributionAssigneeStatsController = async (req: Request, res: Response) => {
//   const formId = typeof req.query.formId === "string" && req.query.formId ? req.query.formId : undefined;
//   const fromRaw = typeof req.query.createdFrom === "string" ? req.query.createdFrom : "";
//   const toRaw = typeof req.query.createdTo === "string" ? req.query.createdTo : "";
//   const createdFrom = fromRaw ? new Date(fromRaw) : undefined;
//   const createdTo = toRaw ? new Date(toRaw) : undefined;
//   if (!createdFrom || !createdTo || !Number.isFinite(createdFrom.getTime()) || !Number.isFinite(createdTo.getTime())) {
//     return res.json({ success: true, data: [] });
//   }

//   try {
//     const rows = await getFacebookManualDistributionAssigneeStats({
//       formId,
//       createdFrom,
//       createdTo,
//     });
//     return res.json({ success: true, data: rows });
//   } catch {
//     return res.status(500).json({ success: false, message: "Failed to fetch assignee stats" });
//   }
// };

export const getFacebookManualDistributionAssigneeStatsController = async (req: Request, res: Response) => {
  const formId = typeof req.query.formId === "string" && req.query.formId ? req.query.formId : undefined;
  const fromRaw = typeof req.query.createdFrom === "string" ? req.query.createdFrom : "";
  const toRaw = typeof req.query.createdTo === "string" ? req.query.createdTo : "";
  const createdFrom = fromRaw ? new Date(fromRaw) : undefined;
  const createdTo = toRaw ? new Date(toRaw) : undefined;
  const datePairValid =
    createdFrom &&
    createdTo &&
    Number.isFinite(createdFrom.getTime()) &&
    Number.isFinite(createdTo.getTime());

  try {
    const rows = await getFacebookManualDistributionAssigneeStats({
      formId,
      createdFrom: datePairValid ? createdFrom : undefined,
      createdTo: datePairValid ? createdTo : undefined,
    });
    return res.json({ success: true, data: rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch assignee stats" });
  }
};

export const distributeFacebookManualBulkController = async (req: Request, res: Response) => {
  const { leadIds, strategy, assignedTelecallers, assignedCounsellors, priorityWeights, leadTypeId, customLeadTypeName } = req.body || {};
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: "leadIds array is required" });
  }
  const ids = leadIds.map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: "leadIds array is required" });
  }
  const tcs = Array.isArray(assignedTelecallers) ? assignedTelecallers.map(Number) : [];
  const cos = Array.isArray(assignedCounsellors) ? assignedCounsellors.map(Number) : [];
  if (tcs.length + cos.length === 0) {
    return res.status(400).json({ success: false, message: "Select at least one team member" });
  }

  const resolved = await resolveLeadTypeFromBody({ leadTypeId, customLeadTypeName });
  if ("message" in resolved) {
    return res.status(resolved.status).json({ success: false, message: resolved.message });
  }

  try {
    await ensureFacebookLeadsEligibleForInactiveManualBulk(ids);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code.startsWith("FACEBOOK_MANUAL_DIST_FORM_ACTIVE")) {
      return res.status(409).json({
        success: false,
        message: "Manual distribution is disabled while a selected form is active. Deactivate the form first.",
      });
    }
    if (code === "FACEBOOK_MANUAL_DIST_NON_FB_LEADS") {
      return res.status(400).json({ success: false, message: "Only Facebook lead ads leads can be distributed here." });
    }
    return res.status(400).json({ success: false, message: "Leads are not eligible for manual distribution." });
  }

  try {
    const result = await distributeLeadsManuallyBulkAcrossForms(
      ids,
      String(strategy || "round_robin"),
      tcs,
      cos,
      priorityWeights && typeof priorityWeights === "object" ? priorityWeights : {},
      resolved
    );
    return res.json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to distribute leads" });
  }
};

export const getFormsWithUnassignedLeadsController = async (_req: Request, res: Response) => {
  try {
    const rows = await getFormsWithUnassignedLeads();
    return res.json({ success: true, data: rows });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to list forms" });
  }
};

export const getMasterDistributionController = async (req: Request, res: Response) => {
  const pageId = typeof req.query.pageId === "string" ? req.query.pageId.trim() : "";
  if (!pageId) {
    return res.status(400).json({ success: false, message: "pageId is required" });
  }
  try {
    const rows = await getFormStrategiesByPage(pageId);
    const groups = await getMasterDistributionGroupsByPage(pageId);
    const strategies = rows.map((r) => ({
      id: r.id,
      formId: r.formId,
      formName: r.formName,
      pageId: r.pageId,
      pageName: r.pageName,
      strategy: r.strategy,
      assignedTelecallers: r.assignedTelecallers ?? [],
      assignedCounsellors: r.assignedCounsellors ?? [],
      priorityWeights: r.priorityWeights ?? {},
      isActive: r.isActive,
      isArchived: r.isArchived,
      isMasterManaged: r.isMasterManaged,
      leadTypeId: r.leadTypeId ?? null,
      masterDistributionGroup: r.masterDistributionGroup ?? null,
      roundRobinIndex: r.roundRobinIndex,
      createdBy: r.createdBy,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    }));
    return res.json({ success: true, data: { strategies, groups } });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to load master distribution" });
  }
};

export const saveMasterDistributionController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const {
    pageId,
    pageName,
    formIds,
    deactivatedFormIds,
    strategy,
    assignedTelecallers,
    assignedCounsellors,
    priorityWeights,
    leadTypeId,
    customLeadTypeName,
    masterDistributionGroup,
  } = req.body || {};

  const pid = typeof pageId === "string" ? pageId.trim() : "";
  const ids = Array.isArray(formIds) ? formIds.map(String).filter(Boolean) : [];
  if (!pid) {
    return res.status(400).json({ success: false, message: "pageId is required" });
  }
  if (ids.length > MAX_MASTER_DISTRIBUTION_FORMS) {
    return res.status(400).json({
      success: false,
      message: `Select up to ${MAX_MASTER_DISTRIBUTION_FORMS} active forms at a time.`,
    });
  }

  const strat = String(strategy || "").trim() || "round_robin";
  const tcs = Array.isArray(assignedTelecallers) ? assignedTelecallers.map(Number) : [];
  const cos = Array.isArray(assignedCounsellors) ? assignedCounsellors.map(Number) : [];
  if (ids.length > 0 && tcs.length + cos.length === 0) {
    return res.status(400).json({ success: false, message: "Select at least one team member" });
  }

  let resolved: ResolvedLeadTypeSelection | null = null;
  if (ids.length > 0) {
    const leadTypeResolved = await resolveLeadTypeFromBody({ leadTypeId, customLeadTypeName });
    if ("message" in leadTypeResolved) {
      return res.status(leadTypeResolved.status).json({ success: false, message: leadTypeResolved.message });
    }
    resolved = leadTypeResolved;
  }

  const groupKey =
    typeof masterDistributionGroup === "string" && masterDistributionGroup.trim()
      ? masterDistributionGroup.trim()
      : ids.length > 0 && resolved
        ? resolved.masterDistributionGroup ?? ""
        : "";

  const deactivated = Array.isArray(deactivatedFormIds)
    ? deactivatedFormIds.map(String).filter(Boolean)
    : [];
  const pname = typeof pageName === "string" ? pageName : undefined;
  const weights = priorityWeights && typeof priorityWeights === "object" ? priorityWeights : {};

  try {
    if (ids.length === 0 && groupKey) {
      const cleared = await clearMasterDistributionGroup(pid, groupKey);
      return res.json({
        success: true,
        data: { activated: [], deactivated: cleared, groupRemoved: groupKey },
      });
    }

    for (const formId of deactivated) {
      await detachFormFromMasterDistribution(formId);
    }

    const newlyActivatedFormIds: string[] = [];
    for (const formId of ids) {
      const existing = await getFormStrategy(formId).catch(() => null);
      if (existing?.isActive && !existing.isMasterManaged) {
        return res.status(409).json({
          success: false,
          message: `Form ${formId} is already active outside master distribution.`,
        });
      }
      if (
        existing?.isMasterManaged &&
        existing.masterDistributionGroup &&
        groupKey &&
        existing.masterDistributionGroup !== groupKey
      ) {
        return res.status(409).json({
          success: false,
          message: `Form ${formId} belongs to another master distribution group.`,
        });
      }
      await upsertFormStrategy({
        formId,
        formName: existing?.formName ?? formId,
        pageId: pid,
        pageName: pname ?? existing?.pageName ?? undefined,
        strategy: strat,
        assignedTelecallers: tcs,
        assignedCounsellors: cos,
        priorityWeights: weights,
        leadTypeId: resolved?.leadTypeId ?? null,
        masterDistributionGroup: groupKey,
        createdBy: authReq.user.id,
      });
      if (resolved?.label) {
        await applyLeadTypeLabelToFormLeads(formId, resolved.label).catch(() => null);
      }
      await setMasterManaged(formId, true, groupKey);
      await updateFormActiveStatus(formId, true);
      if (!existing?.isActive) newlyActivatedFormIds.push(formId);
    }

    if (ids.length > 0) {
      try {
        const pageToken = await getPageTokenFast(authReq.user.id, pid);
        if (pageToken) {
          await axios.post(`${FB_GRAPH_BASE}/${pid}/subscribed_apps`, null, {
            params: fbParams(pageToken, { subscribed_fields: "leadgen" }),
          });
        }
      } catch {
        /* optional: webhook subscription failure */
      }
    }

    if (newlyActivatedFormIds.length > 0) {
      void runFacebookFormImportsSequentially(newlyActivatedFormIds);
    }

    return res.json({
      success: true,
      data: {
        activated: ids,
        deactivated,
        masterDistributionGroup: groupKey,
        leadTypeId: resolved?.leadTypeId ?? null,
        customLeadTypeName: resolved?.leadTypeId == null ? resolved?.label : undefined,
      },
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to save master distribution" });
  }
};

export const deactivateMasterFormController = async (req: Request, res: Response) => {
  const { formId } = req.params;
  if (!formId) {
    return res.status(400).json({ success: false, message: "formId is required" });
  }
  try {
    await detachFormFromMasterDistribution(formId);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to deactivate form" });
  }
};

// ── SSE / Webhook controllers ────────────────────────────────────────────────

export const facebookEventsController = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const uid = authReq.user.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (!sseClients.has(uid)) sseClients.set(uid, new Set());
  sseClients.get(uid)!.add(res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  req.on("close", () => {
    const set = sseClients.get(uid);
    if (!set) return;
    set.delete(res);
    if (!set.size) sseClients.delete(uid);
  });
};

export const verifyFacebookWebhookController = async (req: Request, res: Response) => {
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (token === process.env.WEBHOOK_VERIFY_TOKEN) return res.send(challenge);
  return res.sendStatus(403);
};

export const facebookWebhookController = async (req: Request, res: Response) => {
  const sig = req.headers["x-hub-signature-256"];
  const rawBody =
    (req.rawBody as Buffer | undefined) ||
    (Buffer.isBuffer(req.body) ? (req.body as Buffer) : undefined);

  if (!sig || !rawBody) return res.sendStatus(403);

  const appSecret = getRequiredEnv("FB_APP_SECRET");
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  if (sig !== expected) return res.sendStatus(403);

  res.sendStatus(200);

  let body: any = req.body;
  if (Buffer.isBuffer(body)) body = null;
  if (!body) {
    try { body = JSON.parse(rawBody.toString("utf8")); } catch { body = null; }
  }
  if (body?.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== "leadgen") continue;
      const leadgenId = String(change?.value?.leadgen_id || "");
      const formId = String(change?.value?.form_id || "");
      const pageId = String(change?.value?.page_id || "");
      if (!leadgenId || !formId || !pageId) continue;

      const strategyRow = await getFormStrategy(formId).catch(() => null);
      if (!strategyRow?.isActive) continue;

      setImmediate(async () => {
        try {
          const ownerUserId = strategyRow.createdBy;
          if (!ownerUserId) return;

          const pageToken = await getPageTokenFast(ownerUserId, pageId);
          if (!pageToken) return;

          const leadRes = await axios.get(`${FB_GRAPH_BASE}/${leadgenId}`, {
            params: fbParams(pageToken, {
              fields:
                "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform",
            }),
          });

          const mapped = mapFacebookLead(leadRes.data, {
            formId,
            formName: strategyRow.formName || undefined,
            pageId,
            pageName: strategyRow.pageName || undefined,
          });
          if (!mapped) return;

          const inserted = await insertLeadToDB(mapped, strategyRow).catch(() => false);
          if (!inserted) return;

          if (leadRes.data?.created_time) {
            touchLastLeadCreatedTime(formId, new Date(leadRes.data.created_time)).catch(() => null);
          }

          broadcastToUser(ownerUserId, {
            type: "new_lead",
            lead: { ...mapped, createdAt: leadRes.data.created_time || new Date().toISOString() },
          });
        } catch { /* ignore per-lead errors */ }
      });
    }
  }
};
