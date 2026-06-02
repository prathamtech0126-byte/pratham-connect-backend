import { db } from "../../config/databaseConnection";
import { leads } from "../schemas/leads.schema";
import { serializeLeadTimestampsForApi } from "../../utils/pgTimestamp";
import {
  upsertFacebookLeadMeta,
  type FacebookLeadMetaInput,
} from "../facebookautomation/facebook_models/facebookLead.model";
import {
  createLeadCreatedActivity,
  createLeadInitialNote,
} from "./leadActivityEvents.service";

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

  const createdAt = created.createdAt ? new Date(created.createdAt) : undefined;

  await createLeadCreatedActivity({
    leadId: created.id,
    userId: activity?.userId,
    performerName: activity?.performerName,
    createdAt,
  });

  const initialNote = typeof data.latestNote === "string" ? data.latestNote.trim() : "";
  if (initialNote) {
    await createLeadInitialNote({
      leadId: created.id,
      userId: activity?.userId,
      performerName: activity?.performerName,
      message: initialNote,
      createdAt,
    });
  }

  return serialized;
}
