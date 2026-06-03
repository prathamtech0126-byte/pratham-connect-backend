import { db } from "../../config/databaseConnection";
import { leads } from "../schemas/leads.schema";
import { serializeLeadTimestampsForApi } from "../../utils/pgTimestamp";
import {
  upsertFacebookLeadMeta,
  type FacebookLeadMetaInput,
} from "../facebookautomation/facebook_models/facebookLead.model";
import { createLeadCreatedActivity } from "./leadActivityEvents.service";

type LeadInsert = typeof leads.$inferInsert;

export async function insertLeadRecord(
  data: LeadInsert,
  facebookMeta?: Omit<FacebookLeadMetaInput, "leadId"> | null,
  activity?: { userId?: number | null; performerName?: string | null }
) {
  const [created] = await db.insert(leads).values(data).returning();
  const serialized = serializeLeadTimestampsForApi(created);

  if (facebookMeta && (facebookMeta.formId || facebookMeta.campaignId || facebookMeta.customAnswers)) {
    await upsertFacebookLeadMeta({ leadId: created.id, ...facebookMeta });
  }

  await createLeadCreatedActivity({
    leadId: created.id,
    userId: activity?.userId,
    performerName: activity?.performerName,
    createdAt: created.createdAt ? new Date(created.createdAt) : undefined,
  });

  return serialized;
}
