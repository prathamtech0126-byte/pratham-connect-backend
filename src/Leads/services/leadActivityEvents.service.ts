import { db } from "../../config/databaseConnection";
import { leadActivities } from "../schemas/leadActivities.schema";
import type { LeadFieldChange } from "./leadActivityChanges";

export async function createLeadCreatedActivity(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  createdAt?: Date;
}) {
  const at = input.createdAt ?? new Date();
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
    createdAt: at,
    updatedAt: at,
  });
}

export async function createLeadUpdateActivity(input: {
  leadId: number;
  userId?: number | null;
  performerName?: string | null;
  changes: LeadFieldChange[];
  /** Eligibility/quality reason — stored on lead_update so timeline and notes share one row. */
  reasonMessage?: string;
  reasonType?: "eligibility" | "quality";
}) {
  const performer = input.performerName?.trim();
  const now = new Date();
  const reasonMessage = input.reasonMessage?.trim();
  const defaultMessage = performer ? `${performer} updated the lead` : "Lead updated";
  await db.insert(leadActivities).values({
    leadId: input.leadId,
    userId: input.userId ?? null,
    activityType: "lead_update",
    message: reasonMessage || defaultMessage,
    status: "completed",
    meta: {
      eventType: "lead_updated",
      changes: input.changes,
      performedByName: performer ?? null,
      ...(reasonMessage
        ? {
            reasonNote: reasonMessage,
            reasonType: input.reasonType ?? null,
            showInNotes: true,
          }
        : {}),
    },
    createdAt: now,
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
  const now = new Date();
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
    createdAt: now,
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

  const at = input.createdAt ?? new Date();
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
    createdAt: at,
    updatedAt: at,
  });
}
