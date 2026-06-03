import { db } from "../../config/databaseConnection";
import { leadActivities } from "../schemas/leadActivities.schema";
import { getIndianNow } from "../models/lead.model";
import type { LeadFieldChange } from "./leadActivityChanges";

export async function createLeadCreatedActivity(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  createdAt?: Date;
}) {
  const at = input.createdAt ?? getIndianNow();
  const performer = input.performerName?.trim();
  await db.insert(leadActivities).values({
    leadId: input.leadId,
    userId: input.userId ?? null,
    activityType: "lead_created",
    message: performer ? `${performer} created the lead` : "Lead created",
    status: "completed",
    meta: {
      eventType: "lead_created",
      performedByName: performer ?? null,
      createdAt: at.toISOString(),
    },
    updatedAt: at,
  });
}

export async function createLeadUpdateActivity(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  changes: LeadFieldChange[];
}) {
  const performer = input.performerName?.trim();
  const now = getIndianNow();
  await db.insert(leadActivities).values({
    leadId: input.leadId,
    userId: input.userId ?? null,
    activityType: "lead_update",
    message: performer ? `${performer} updated the lead` : "Lead updated",
    status: "completed",
    meta: {
      eventType: "lead_updated",
      changes: input.changes,
      performedByName: performer ?? null,
    },
    updatedAt: now,
  });
}

export async function createLeadReasonNote(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const now = getIndianNow();
  await db.insert(leadActivities).values({
    leadId: input.leadId,
    userId: input.userId ?? null,
    activityType: "note",
    message: input.message.trim(),
    status: "completed",
    meta: {
      ...(input.meta ?? {}),
      performedByName: input.performerName ?? null,
      isReasonNote: true,
    },
    updatedAt: now,
  });
}

/** Initial note from manual create / import — appears in the Notes timeline. */
export async function createLeadInitialNote(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  message: string;
  createdAt?: Date;
}) {
  const trimmed = input.message.trim();
  if (!trimmed) return;

  const at = input.createdAt ?? getIndianNow();
  await db.insert(leadActivities).values({
    leadId: input.leadId,
    userId: input.userId ?? null,
    activityType: "note",
    message: trimmed,
    status: "completed",
    meta: {
      performedByName: input.performerName?.trim() ?? null,
      source: "lead_create",
    },
    updatedAt: at,
  });
}
