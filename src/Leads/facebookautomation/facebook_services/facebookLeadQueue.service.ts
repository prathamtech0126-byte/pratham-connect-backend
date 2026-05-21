import axios from "axios";
import crypto from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import {
  getFacebookAccessToken,
  getFacebookPageAccessToken,
} from "../facebook_models/facebookAuthState.model";
import {
  getFormStrategy,
  pickNextAssignee,
  touchLastLeadCreatedTime,
} from "../facebook_models/facebookFormStrategy.model";
import { resolveLeadTypeLabelForStrategy } from "../leadTypeSelection.util";
import { leads } from "../../schemas/leads.schema";
import { facebookLead } from "../facebook_schemas/facebookLead.schema";
import { getIndianNow } from "../../models/lead.model";
import { insertLeadRecord } from "../../services/leadInsert.service";
import { mapPlatformToLeadType } from "../../models/leadType.model";

const FB_API_VERSION = "v25.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

const appSecretProof = (accessToken: string) => {
  const appSecret = process.env.FB_APP_SECRET || "";
  return appSecret
    ? crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex")
    : "";
};

const fbParams = (accessToken: string, extra: Record<string, unknown> = {}) => ({
  access_token: accessToken,
  appsecret_proof: appSecretProof(accessToken),
  ...extra,
});

const getPageTokenFast = async (ownerUserId: number, pageId: string): Promise<string | null> => {
  const cached = await getFacebookPageAccessToken(ownerUserId, pageId);
  if (cached) return cached;
  // Fallback (should be rare if pages are cached on login/refresh)
  const userAccessToken = await getFacebookAccessToken(ownerUserId);
  if (!userAccessToken) return null;
  const r = await axios.get(`${FB_GRAPH_BASE}/me/accounts`, {
    params: fbParams(userAccessToken),
  });
  const page = (r.data?.data || []).find((p: any) => p.id === pageId);
  return page?.access_token || null;
};

const mapFacebookLead = (
  leadData: any,
  meta: { formId: string; formName?: string; pageId: string; pageName?: string }
) => {
  const fieldData = Array.isArray(leadData?.field_data) ? leadData.field_data : [];
  const pickField = (keys: string[]) => {
    const item = fieldData.find((f: any) => keys.includes(String(f?.name || "").toLowerCase()));
    const first = item?.values?.[0];
    return typeof first === "string" ? first.trim() : "";
  };
  const normalizePhone = (raw: string) => raw.replace(/[^\d+]/g, "");

  const fullName = pickField(["full_name", "full name", "name"]) || "Facebook Lead";
  const phone = normalizePhone(pickField(["phone_number", "phone", "mobile", "whatsapp"]));
  const safePhone =
    phone || `unknown_${String(leadData?.id || "").slice(-20)}`.slice(0, 30);

  const customAnswers: Record<string, unknown> = {};
  for (const item of fieldData) {
    const key = String(item?.name || "").trim();
    if (!key) continue;
    customAnswers[key] = item?.values || [];
  }

  // The Meta `platform` value ("fb" / "ig" / full name) is mapped to a slug
  // and stored in `leads.lead_source` (matches the catalog rows seeded into
  // `lead_type`). `leads.lead_type` is reserved for sale-type values and is
  // left untouched by the Meta import.
  const sourceSlug = mapPlatformToLeadType(leadData.platform) ?? "facebook";
  return {
    externalLeadId: String(leadData.id || ""),
    fullName,
    phone: safePhone,
    whatsapp: phone ? phone : null,
    email: pickField(["email", "email_address"]) || null,
    city: pickField(["city", "location"]) || null,
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
    latestNote: `Imported from Facebook page ${meta.pageName || meta.pageId}`,
    leadCreatedAt: leadData.created_time ? new Date(leadData.created_time) : new Date(),
  };
};

const insertMappedLead = async (
  mapped: any,
  strategyRow: NonNullable<Awaited<ReturnType<typeof getFormStrategy>>>,
  leadTypeLabel: string | null
) => {
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.externalLeadId, mapped.externalLeadId))
    .limit(1);
  if (existing.length > 0) return { inserted: false, duplicate: true };

  let currentTelecallerId: number | undefined;
  let currentCounsellorId: number | undefined;
  let assignmentStatus: "not_assigned" | "assigned" = "not_assigned";

  const assignee = await pickNextAssignee(strategyRow);
  if (assignee) {
    if (assignee.role === "telecaller") currentTelecallerId = assignee.userId;
    else currentCounsellorId = assignee.userId;
    assignmentStatus = "assigned";
  }

  const storedAt = getIndianNow();
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

  await touchLastLeadCreatedTime(strategyRow.formId, mapped.leadCreatedAt);
  return { inserted: true, duplicate: false };
};

/** Insert without auto-assign (inactive forms / import-only sync). Updates form watermark like normal import. */
const insertMappedLeadNoAssign = async (
  mapped: any,
  formIdForWatermark: string,
  leadTypeLabel: string | null
) => {
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.externalLeadId, mapped.externalLeadId))
    .limit(1);
  if (existing.length > 0) return { inserted: false, duplicate: true };

  const storedAt = getIndianNow();
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
      assignmentStatus: "not_assigned",
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

  await touchLastLeadCreatedTime(formIdForWatermark, mapped.leadCreatedAt);
  return { inserted: true, duplicate: false };
};

export class FacebookImportInactiveFormError extends Error {
  readonly code = "IMPORT_ONLY_REQUIRES_INACTIVE_FORM";
  constructor() {
    super("Import without distribution requires the form to be inactive.");
  }
}

export const fetchMetaLeadsForForm = async (
  ownerUserId: number,
  pageId: string,
  formId: string
): Promise<any[]> => {
  const pageToken = await getPageTokenFast(ownerUserId, pageId);
  if (!pageToken) return [];

  const results: any[] = [];
  const first = await axios.get(`${FB_GRAPH_BASE}/${formId}/leads`, {
    params: fbParams(pageToken, {
      fields: "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform",
    }),
  });
  let payload = first.data;
  while (payload) {
    for (const lead of payload?.data || []) results.push(lead);
    const nextUrl = payload?.paging?.next ? String(payload.paging.next) : "";
    if (!nextUrl) break;
    const nextRes = await axios.get(nextUrl);
    payload = nextRes.data;
  }
  return results;
};

export const previewNewLeadCountForForm = async (formId: string): Promise<number> => {
  const strategy = await getFormStrategy(formId);
  if (!strategy?.createdBy || !strategy.pageId) return 0;
  const leadsData = await fetchMetaLeadsForForm(strategy.createdBy, strategy.pageId, formId);
  if (!strategy.lastLeadCreatedTime) return leadsData.length;

  const watermark = new Date(strategy.lastLeadCreatedTime).getTime() - 2 * 60 * 1000;
  return leadsData.filter((l) => {
    const ts = l?.created_time ? new Date(l.created_time).getTime() : 0;
    return ts > watermark;
  }).length;
};

export const importLeadsForForm = async (
  formId: string,
  options?: { skipDistribution?: boolean }
): Promise<number> => {
  const strategy = await getFormStrategy(formId);
  if (!strategy?.createdBy || !strategy.pageId) return 0;

  const skipDistribution = Boolean(options?.skipDistribution);

  if (skipDistribution) {
    if (strategy.isActive) {
      throw new FacebookImportInactiveFormError();
    }
  } else if (!strategy.isActive) {
    return 0;
  }

  const leadsData = await fetchMetaLeadsForForm(strategy.createdBy, strategy.pageId, formId);
  const hadNoWatermark = strategy.lastLeadCreatedTime == null;
  const watermark = strategy.lastLeadCreatedTime
    ? new Date(strategy.lastLeadCreatedTime).getTime() - 2 * 60 * 1000
    : null;

  const leadTypeLabel = await resolveLeadTypeLabelForStrategy(strategy);

  let inserted = 0;
  for (const leadData of leadsData) {
    const leadTs = leadData?.created_time ? new Date(leadData.created_time).getTime() : 0;
    if (watermark && leadTs <= watermark) continue;
    const mapped = mapFacebookLead(leadData, {
      formId: strategy.formId,
      formName: strategy.formName || undefined,
      pageId: strategy.pageId,
      pageName: strategy.pageName || undefined,
    });
    if (!mapped) continue;
    const result = skipDistribution
      ? await insertMappedLeadNoAssign(mapped, strategy.formId, leadTypeLabel)
      : await insertMappedLead(mapped, strategy, leadTypeLabel);
    if (result.inserted) inserted += 1;
  }

  if (hadNoWatermark && leadsData.length > 0) {
    let maxDate: Date | null = null;
    for (const leadData of leadsData) {
      if (!leadData?.created_time) continue;
      const d = new Date(leadData.created_time);
      if (!maxDate || d.getTime() > maxDate.getTime()) maxDate = d;
    }
    if (maxDate) await touchLastLeadCreatedTime(strategy.formId, maxDate);
  }

  return inserted;
};

export const getRecentImportedLeads = async (formId: string, limit = 50) => {
  if (formId) {
    return db
      .select()
      .from(leads)
      .innerJoin(facebookLead, eq(facebookLead.leadId, leads.id))
      .where(eq(facebookLead.formId, formId))
      .orderBy(desc(leads.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(leads)
    .where(eq(leads.leadSource, "facebook_lead_ads"))
    .orderBy(desc(leads.createdAt))
    .limit(limit);
};
