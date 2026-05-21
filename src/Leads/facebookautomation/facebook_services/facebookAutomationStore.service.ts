import axios from "axios";
import crypto from "crypto";
import {
  getDefaultFacebookTokenExpiry,
  getFacebookAccessToken,
  getFacebookAuthState,
  listExpiredFacebookUserAuthStates,
  syncFacebookPages,
  upsertFacebookAuthState,
} from "../facebook_models/facebookAuthState.model";
import { listActiveFormStrategies } from "../facebook_models/facebookFormStrategy.model";
import { importLeadsForForm } from "./facebookLeadQueue.service";

const FB_API_VERSION = "v25.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
const ACTIVE_FORM_IMPORT_DELAY_MS = Number(process.env.FB_ACTIVE_FORM_IMPORT_DELAY_MS || 90_000);

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const activeImportUsers = new Set<number>();

export const refreshFacebookAuthIfExpired = async (userId: number): Promise<boolean> => {
  const authState = await getFacebookAuthState(userId);
  if (!authState) return false;

  if (!authState.expiresAt) {
    const currentToken = await getFacebookAccessToken(userId, { allowExpired: true });
    if (currentToken) {
      await upsertFacebookAuthState(userId, currentToken, authState.account ?? null, getDefaultFacebookTokenExpiry());
    }
    return false;
  }

  if (authState.expiresAt > new Date()) return false;

  const currentToken = await getFacebookAccessToken(userId, { allowExpired: true });
  if (!currentToken) return false;

  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) return false;

  const longTokenRes = await axios.get(`${FB_GRAPH_BASE}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentToken,
    },
  });

  const accessToken = String(longTokenRes.data?.access_token || "");
  if (!accessToken) return false;

  const expiresIn = Number(longTokenRes.data?.expires_in || 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : getDefaultFacebookTokenExpiry();

  let account = authState.account ?? null;
  try {
    const meRes = await axios.get(`${FB_GRAPH_BASE}/me`, {
      params: fbParams(accessToken, { fields: "id,name,picture.width(120).height(120)" }),
    });
    account = {
      id: String(meRes.data?.id || authState.fbEntityId || userId),
      name: String(meRes.data?.name || authState.fbEntityName || "Facebook User"),
      pictureUrl: meRes.data?.picture?.data?.url || authState.pictureUrl || null,
    };
  } catch {
    // Keep existing account metadata if Meta profile fetch fails.
  }

  await upsertFacebookAuthState(userId, accessToken, account, expiresAt);

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
    await syncFacebookPages(userId, pages);
  } catch {
    // Page token sync is best-effort; existing page tokens can still be used.
  }

  return true;
};

export const runFacebookFormImportsSequentially = async (formIds: string[]): Promise<number> => {
  const uniqueFormIds = [...new Set(formIds.filter(Boolean))];
  let inserted = 0;
  for (let i = 0; i < uniqueFormIds.length; i += 1) {
    inserted += await importLeadsForForm(uniqueFormIds[i]).catch(() => 0);
    if (i < uniqueFormIds.length - 1 && ACTIVE_FORM_IMPORT_DELAY_MS > 0) {
      await sleep(ACTIVE_FORM_IMPORT_DELAY_MS);
    }
  }
  return inserted;
};

export const runActiveFacebookFormImportsForUser = async (userId: number): Promise<number> => {
  if (activeImportUsers.has(userId)) return 0;
  activeImportUsers.add(userId);
  try {
    const forms = (await listActiveFormStrategies()).filter((f) => f.createdBy === userId);
    return runFacebookFormImportsSequentially(forms.map((f) => f.formId));
  } finally {
    activeImportUsers.delete(userId);
  }
};

export const refreshExpiredFacebookTokensAndImportActiveForms = async (): Promise<void> => {
  const expiredRows = await listExpiredFacebookUserAuthStates();
  for (const row of expiredRows) {
    try {
      const refreshed = await refreshFacebookAuthIfExpired(row.userId);
      if (refreshed) await runActiveFacebookFormImportsForUser(row.userId);
    } catch (error) {
      console.warn("[facebook-automation] token refresh/import failed", {
        userId: row.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

// Thin in-memory cache for transient UI state only.
// All persistent state (tokens, forms, active status) lives in the database.
// This object is kept for backward-compatibility with any remaining SSE or temp usage.
export const facebookStore = {
  clearUser(_userId: number) {},
  setPages(_userId: number, _pages: unknown[]) {},
  getPages(_userId: number): unknown[] { return []; },
  setForms(_userId: number, _pageId: string, _forms: unknown[]) {},
  getForms(_userId: number, _pageId: string): unknown[] { return []; },
  addLead(_userId: number, _lead: Record<string, unknown>): boolean { return false; },
  getLeads(_userId: number, _formId?: string): unknown[] { return []; },
};
