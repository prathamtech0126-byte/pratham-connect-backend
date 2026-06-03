import { eq, inArray } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { facebookLead } from "../facebook_schemas/facebookLead.schema";

export type FacebookLeadMetaInput = {
  leadId: number;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  adId?: string | null;
  adName?: string | null;
  formId?: string | null;
  formName?: string | null;
  facebookCreatedAt?: Date | null;
  customAnswers?: Record<string, unknown>;
};

export async function upsertFacebookLeadMeta(input: FacebookLeadMetaInput) {
  const [existing] = await db
    .select({ id: facebookLead.id })
    .from(facebookLead)
    .where(eq(facebookLead.leadId, input.leadId))
    .limit(1);

  const payload = {
    campaignId: input.campaignId ?? null,
    campaignName: input.campaignName ?? null,
    adsetId: input.adsetId ?? null,
    adsetName: input.adsetName ?? null,
    adId: input.adId ?? null,
    adName: input.adName ?? null,
    formId: input.formId ?? null,
    formName: input.formName ?? null,
    facebookCreatedAt: input.facebookCreatedAt ?? null,
    customAnswers: input.customAnswers ?? {},
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(facebookLead).set(payload).where(eq(facebookLead.leadId, input.leadId));
    return;
  }

  await db.insert(facebookLead).values({
    leadId: input.leadId,
    ...payload,
  });
}

export async function getFacebookLeadMetaByLeadId(leadId: number) {
  const [row] = await db
    .select()
    .from(facebookLead)
    .where(eq(facebookLead.leadId, leadId))
    .limit(1);
  return row ?? null;
}

export async function markLeadsSentToMeta(leadIds: number[]) {
  if (!leadIds.length) return;
  const unique = [...new Set(leadIds.filter((id) => id > 0))];
  await db
    .update(facebookLead)
    .set({ sentToMeta: true, updatedAt: new Date() })
    .where(inArray(facebookLead.leadId, unique));
}

export async function getFacebookLeadSentStatus(leadIds: number[]): Promise<Map<number, boolean>> {
  if (!leadIds.length) return new Map();
  const rows = await db
    .select({ leadId: facebookLead.leadId, sentToMeta: facebookLead.sentToMeta })
    .from(facebookLead)
    .where(inArray(facebookLead.leadId, leadIds));
  return new Map(rows.map((r) => [r.leadId, r.sentToMeta]));
}

export function isMetaLeadSource(leadSource?: string | null) {
  const s = (leadSource ?? "").toLowerCase();
  return s === "facebook" || s === "instagram";
}
