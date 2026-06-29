import crypto from "crypto";
import { db } from "../../../config/databaseConnection";
import { leadEditTokens } from "../schemas/leadEditTokens.schema";
import { leads } from "../../schemas/leads.schema";
import { hashToken } from "../../../utils/token";
import { and, eq, gt, desc } from "drizzle-orm";
import { isLeadLocked } from "../../models/lead.model";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function getEditLinkTtlMs(): number {
  const raw = parseInt(process.env.LEAD_EDIT_LINK_TTL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

/**
 * Public client edit page base URL (no query string).
 * Priority: LEAD_SELF_EDIT_BASE_URL → REGISTRATION_SITE_URL + LEAD_SELF_EDIT_PATH
 */
export function getLeadSelfEditBaseUrl(): string {
  const explicit = (process.env.LEAD_SELF_EDIT_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const site = (process.env.REGISTRATION_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (!site) return "";

  const pathRaw = (process.env.LEAD_SELF_EDIT_PATH ?? "/edit").trim();
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  return `${site}${path}`;
}

export function buildLeadEditUrl(rawToken: string): string | null {
  const baseUrl = getLeadSelfEditBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}?token=${encodeURIComponent(rawToken)}`;
}

export interface LeadEditTokenRow {
  id: number;
  leadId: number;
  createdByUserId: number | null;
  expiresAt: Date;
  revoked: boolean;
}

export interface CreateLeadEditLinkResult {
  tokenId: number;
  rawToken: string;
  editUrl: string | null;
  expiresAt: Date;
  leadId: number;
}

export async function assertLeadEligibleForEditLink(leadId: number): Promise<void> {
  const [lead] = await db
    .select({
      id: leads.id,
      isJunk: leads.isJunk,
      progressStatus: leads.progressStatus,
      assignmentStatus: leads.assignmentStatus,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!lead) throw new Error("Lead not found");
  if (isLeadLocked(lead, null)) {
    throw new Error("Cannot create edit link for a converted, dropped, or junk lead");
  }
}

export async function revokeActiveEditTokensForLead(leadId: number): Promise<void> {
  await db
    .update(leadEditTokens)
    .set({ revoked: true })
    .where(and(eq(leadEditTokens.leadId, leadId), eq(leadEditTokens.revoked, false)));
}

export async function createLeadEditLinkForLead(
  leadId: number,
  createdByUserId: number | null
): Promise<CreateLeadEditLinkResult> {
  await assertLeadEligibleForEditLink(leadId);
  await revokeActiveEditTokensForLead(leadId);

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + getEditLinkTtlMs());

  const [inserted] = await db
    .insert(leadEditTokens)
    .values({
      leadId,
      tokenHash,
      createdByUserId,
      expiresAt,
      revoked: false,
    })
    .returning({
      id: leadEditTokens.id,
      expiresAt: leadEditTokens.expiresAt,
    });

  return {
    tokenId: inserted.id,
    rawToken,
    editUrl: buildLeadEditUrl(rawToken),
    expiresAt: inserted.expiresAt,
    leadId,
  };
}

/** Front desk — link issued by staff (audited with user id). */
export async function createLeadEditLink(
  leadId: number,
  createdByUserId: number
): Promise<CreateLeadEditLinkResult> {
  return createLeadEditLinkForLead(leadId, createdByUserId);
}

/** Inbound registration — link for prathaminternational.in (no staff user). */
export async function createInboundLeadEditLink(
  leadId: number
): Promise<CreateLeadEditLinkResult | null> {
  try {
    return await createLeadEditLinkForLead(leadId, null);
  } catch (err) {
    console.warn("[leadEditToken] inbound edit link skipped:", err);
    return null;
  }
}

export async function revokeLeadEditLink(
  leadId: number,
  tokenId: number
): Promise<boolean> {
  const [row] = await db
    .update(leadEditTokens)
    .set({ revoked: true })
    .where(and(eq(leadEditTokens.id, tokenId), eq(leadEditTokens.leadId, leadId)))
    .returning({ id: leadEditTokens.id });

  return Boolean(row);
}

export async function resolveLeadEditToken(rawToken: string): Promise<LeadEditTokenRow | null> {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  const tokenHash = hashToken(trimmed);
  const now = new Date();

  const [row] = await db
    .select({
      id: leadEditTokens.id,
      leadId: leadEditTokens.leadId,
      createdByUserId: leadEditTokens.createdByUserId,
      expiresAt: leadEditTokens.expiresAt,
      revoked: leadEditTokens.revoked,
    })
    .from(leadEditTokens)
    .where(eq(leadEditTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.revoked || row.expiresAt <= now) return null;

  const [lead] = await db
    .select({
      isJunk: leads.isJunk,
      progressStatus: leads.progressStatus,
      assignmentStatus: leads.assignmentStatus,
    })
    .from(leads)
    .where(eq(leads.id, row.leadId))
    .limit(1);

  if (!lead || isLeadLocked(lead, null)) return null;

  return row;
}

export async function listActiveEditLinksForLead(leadId: number) {
  const now = new Date();
  return db
    .select({
      id: leadEditTokens.id,
      expiresAt: leadEditTokens.expiresAt,
      revoked: leadEditTokens.revoked,
      createdAt: leadEditTokens.createdAt,
      createdByUserId: leadEditTokens.createdByUserId,
    })
    .from(leadEditTokens)
    .where(
      and(
        eq(leadEditTokens.leadId, leadId),
        eq(leadEditTokens.revoked, false),
        gt(leadEditTokens.expiresAt, now)
      )
    )
    .orderBy(desc(leadEditTokens.createdAt));
}
