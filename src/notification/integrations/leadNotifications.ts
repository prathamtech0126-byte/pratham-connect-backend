import {
  activeLeadAssignmentBatchDedupeKey,
  cancelPendingLeadFollowupNotifications,
  findMissedFollowUpLeads,
  followupReminderDedupeKey,
  getFollowupMissedEarlyCutoff,
  getUnreadLeadAssignmentBatch,
  transferLeadFollowupNotifications,
} from "../models/notification.model";
import {
  deliverNotificationRow,
  emitNotificationToUser,
  formatFollowupTime,
  getFollowupDueDeliverAt,
  getFollowupReminderDeliverAt,
  getFollowupReminderMinutesBefore,
  notifyUsers,
} from "../services/notification.service";
import { backfillFollowupChainForLead } from "./followupNotificationChain.service";
import { db } from "../../config/databaseConnection";
import { notifications } from "../schemas/notifications.schema";
import { eq } from "drizzle-orm";
import type { NotificationRow } from "../types/notification.types";

type LeadLike = {
  id: number;
  fullName?: string | null;
  currentTelecallerId?: number | null;
  currentCounsellorId?: number | null;
  assignmentStatus?: string | null;
  nextFollowupAt?: Date | null;
};

type AssignmentKind = "telecaller" | "counsellor" | "transferred";

type BatchAssignment = {
  leadId: number;
  leadName?: string | null;
  kind: AssignmentKind;
};

type LeadAssignmentBatchMeta = {
  batch: true;
  assignments: BatchAssignment[];
  assigneeRole: "counsellor" | "telecaller";
};

function leadActionUrl(leadId: number): string {
  return `/leads/${leadId}`;
}

function leadsInboxUrl(role: "counsellor" | "telecaller"): string {
  return role === "counsellor" ? "/leads/counsellor" : "/leads";
}

function resolveLeadOwnerId(lead: LeadLike): number | null {
  return lead.currentCounsellorId ?? lead.currentTelecallerId ?? null;
}

function getReminderMinutesForBody(followupAt: Date): number {
  const configuredMinutes = Math.max(1, getFollowupReminderMinutesBefore());
  const diffMs = followupAt.getTime() - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(diffMs / 60000));
  return Math.min(configuredMinutes, remainingMinutes);
}

function buildBatchCopy(assignments: BatchAssignment[]) {
  const count = assignments.length;
  const transferredCount = assignments.filter((a) => a.kind === "transferred").length;
  const allTransferred = count > 0 && transferredCount === count;

  let title: string;
  let body: string;

  if (count === 1) {
    const a = assignments[0];
    if (a.kind === "transferred") {
      title = "1 lead transferred to you";
      body = `Lead ${a.leadName ?? `#${a.leadId}`} was transferred to you. Open your leads list to review.`;
    } else {
      title = "1 new lead assigned to you";
      body = `Lead ${a.leadName ?? `#${a.leadId}`} was assigned to you. Open your leads list to review.`;
    }
  } else if (allTransferred) {
    title = `${count} leads transferred to you`;
    body = `${count} leads were transferred to you while you were away. Open your leads list to review them.`;
  } else {
    title = `${count} leads assigned to you`;
    body = `${count} leads were assigned to you while you were away. Open your leads list to review them.`;
  }

  const priority =
    transferredCount > 0 ? ("high" as const) : ("normal" as const);

  return { title, body, priority };
}

/**
 * Aggregates lead assign/transfer into one inbox row per user until they mark it read.
 */
export async function appendLeadAssignmentBatch(params: {
  userId: number;
  lead: LeadLike;
  kind: AssignmentKind;
  assigneeRole: "counsellor" | "telecaller";
  actorUserId?: number | null;
  deferDelivery?: boolean;
}): Promise<void> {
  const { userId, lead, kind, assigneeRole, actorUserId, deferDelivery = false } = params;
  const dedupeKey = activeLeadAssignmentBatchDedupeKey(userId);
  const existing = await getUnreadLeadAssignmentBatch(userId);

  let assignments: BatchAssignment[] = [];
  if (existing?.meta && typeof existing.meta === "object") {
    const meta = existing.meta as LeadAssignmentBatchMeta;
    if (Array.isArray(meta.assignments)) {
      assignments = [...meta.assignments];
    }
  }

  const idx = assignments.findIndex((a) => a.leadId === lead.id);
  const entry: BatchAssignment = {
    leadId: lead.id,
    leadName: lead.fullName,
    kind,
  };
  if (idx >= 0) {
    assignments[idx] = entry;
  } else {
    assignments.push(entry);
  }

  const { title, body, priority } = buildBatchCopy(assignments);
  const meta: LeadAssignmentBatchMeta = {
    batch: true,
    assignments,
    assigneeRole,
  };
  const now = new Date();

  if (existing) {
    const updateSet: Record<string, unknown> = {
      type: "lead_assignment_batch",
      category: "leads",
      priority,
      title,
      body,
      entityType: "lead",
      entityId: null,
      actionUrl: leadsInboxUrl(assigneeRole),
      actorUserId: actorUserId ?? null,
      meta,
      deliverAt: now,
      updatedAt: now,
    };

    if (!deferDelivery) {
      updateSet.deliveredAt = null;
      updateSet.readAt = null;
    }

    const [updated] = await db
      .update(notifications)
      .set(updateSet as typeof notifications.$inferInsert)
      .where(eq(notifications.id, existing.id))
      .returning();

    if (updated && !deferDelivery) {
      const row = updated as NotificationRow;
      if (row.deliveredAt) {
        await emitNotificationToUser(row, "notification:updated");
      } else {
        await deliverNotificationRow(row);
      }
    }
    return;
  }

  await notifyUsers({
    type: "lead_assignment_batch",
    userIds: [userId],
    title,
    body,
    priority,
    category: "leads",
    entityType: "lead",
    actionUrl: leadsInboxUrl(assigneeRole),
    actorUserId,
    dedupeKey,
    meta,
    deliverImmediately: !deferDelivery,
  });
}

/** Deliver pending assignment batch once (after bulk assign loop). */
export async function flushLeadAssignmentBatch(userId: number): Promise<void> {
  const existing = await getUnreadLeadAssignmentBatch(userId);
  if (!existing) return;

  const now = new Date();
  await db
    .update(notifications)
    .set({
      deliveredAt: null,
      deliverAt: now,
      updatedAt: now,
    })
    .where(eq(notifications.id, existing.id));

  const fresh = await getUnreadLeadAssignmentBatch(userId);
  if (!fresh) return;

  await deliverNotificationRow(fresh);
}

export async function scheduleLeadFollowupReminder(
  lead: LeadLike,
  followupAt: Date,
  options?: { skipCancel?: boolean }
): Promise<void> {
  const ownerId = resolveLeadOwnerId(lead);
  if (!ownerId) return;

  if (!options?.skipCancel) {
    await cancelPendingLeadFollowupNotifications(lead.id);
  }

  // followupAt is stored as UTC timestamptz — use directly for delivery timing and display.
  const followupInstant = followupAt;
  const whenLabel = formatFollowupTime(followupInstant);
  const leadName = lead.fullName ?? `lead #${lead.id}`;
  const minutesBefore = getReminderMinutesForBody(followupInstant);
  const followupAtIso = followupInstant.toISOString();
  const baseMeta = {
    leadName: lead.fullName,
    followupAt: followupAtIso,
    ownerUserId: ownerId,
  };

  // 1) Reminder N minutes before scheduled follow-up (default 5 min)
  await notifyUsers({
    type: "lead_followup_reminder",
    userIds: [ownerId],
    title: "Follow-up coming up",
    body: `Follow-up with ${leadName} in ${minutesBefore} minutes (at ${whenLabel}).`,
    entityType: "lead",
    entityId: lead.id,
    actionUrl: leadActionUrl(lead.id),
    scheduledAt: followupInstant,
    deliverAt: getFollowupReminderDeliverAt(followupInstant),
    deliverImmediately: false,
    dedupeKey: followupReminderDedupeKey(lead.id, ownerId, followupInstant, "before"),
    meta: { ...baseMeta, phase: "before" },
  });

  // 2) Reminder at the scheduled follow-up time
  await notifyUsers({
    type: "lead_followup_reminder",
    userIds: [ownerId],
    title: "Follow-up now",
    body: `It's time to follow up with ${leadName} (scheduled for ${whenLabel}).`,
    priority: "high",
    entityType: "lead",
    entityId: lead.id,
    actionUrl: leadActionUrl(lead.id),
    scheduledAt: followupInstant,
    deliverAt: getFollowupDueDeliverAt(followupInstant),
    deliverImmediately: false,
    dedupeKey: followupReminderDedupeKey(lead.id, ownerId, followupInstant, "due"),
    meta: { ...baseMeta, phase: "due" },
  });
}

/** Scanner backup: backfill missing chain steps for pending overdue follow-ups. */
export async function processMissedFollowUpOverdueScan(): Promise<void> {
  const earlyLeads = await findMissedFollowUpLeads(getFollowupMissedEarlyCutoff(), 100);
  for (const row of earlyLeads) {
    if (!row.nextFollowupAt) continue;
    const ownerId = resolveLeadOwnerId(row);
    if (!ownerId) continue;
    const followupAt = new Date(row.nextFollowupAt);
    await backfillFollowupChainForLead({
      leadId: row.id,
      ownerId,
      followupAt,
      leadName: row.fullName ?? `lead #${row.id}`,
    });
  }
}

export async function notifyLeadConverted(
  lead: LeadLike,
  actorUserId?: number | null
): Promise<void> {
  const ownerId = resolveLeadOwnerId(lead);
  if (!ownerId) return;

  await cancelPendingLeadFollowupNotifications(lead.id);

  await notifyUsers({
    type: "lead_converted",
    userIds: [ownerId],
    title: "Lead converted",
    body: `Lead ${lead.fullName ?? `#${lead.id}`} has been marked as converted.`,
    entityType: "lead",
    entityId: lead.id,
    actionUrl: leadActionUrl(lead.id),
    actorUserId,
    meta: { leadName: lead.fullName },
  });
}

export async function notifyLeadDropped(
  lead: LeadLike,
  actorUserId?: number | null
): Promise<void> {
  const ownerId = resolveLeadOwnerId(lead);
  if (!ownerId) return;

  await cancelPendingLeadFollowupNotifications(lead.id);

  await notifyUsers({
    type: "lead_dropped",
    userIds: [ownerId],
    title: "Lead dropped",
    body: `Lead ${lead.fullName ?? `#${lead.id}`} has been dropped.`,
    entityType: "lead",
    entityId: lead.id,
    actionUrl: leadActionUrl(lead.id),
    actorUserId,
    meta: { leadName: lead.fullName },
  });
}

export async function notifyLeadJunked(
  lead: LeadLike,
  actorUserId?: number | null
): Promise<void> {
  const ownerId = resolveLeadOwnerId(lead);
  if (!ownerId) return;

  await cancelPendingLeadFollowupNotifications(lead.id);

  await notifyUsers({
    type: "lead_junked",
    userIds: [ownerId],
    title: "Lead marked as junk",
    body: `Lead ${lead.fullName ?? `#${lead.id}`} was marked as junk.`,
    entityType: "lead",
    entityId: lead.id,
    actionUrl: leadActionUrl(lead.id),
    actorUserId,
    meta: { leadName: lead.fullName },
  });
}

/** Pending follow-up stays active; route reminder/overdue notifications to the new counsellor. */
export async function onCounsellorReassignFollowupNotifications(
  lead: LeadLike,
  previousCounsellorId: number,
  newCounsellorId: number,
  followupAt: Date
): Promise<void> {
  await transferLeadFollowupNotifications(lead.id, previousCounsellorId, newCounsellorId);

  const leadForOwner = { ...lead, currentCounsellorId: newCounsellorId };
  await scheduleLeadFollowupReminder(leadForOwner, followupAt, { skipCancel: true });
}

export async function onLeadAssignmentChange(
  previous: LeadLike | null,
  updated: LeadLike,
  options: {
    telecallerId?: number | null;
    counsellorId?: number | null;
    actorUserId?: number | null;
    performerName?: string | null;
    deferDelivery?: boolean;
  }
): Promise<void> {
  const { telecallerId, counsellorId, actorUserId, deferDelivery = false } = options;

  if (telecallerId != null && telecallerId !== previous?.currentTelecallerId) {
    await appendLeadAssignmentBatch({
      userId: telecallerId,
      lead: updated,
      kind: "telecaller",
      assigneeRole: "telecaller",
      actorUserId,
      deferDelivery,
    });
  }

  if (counsellorId != null && counsellorId !== previous?.currentCounsellorId) {
    const transferred = updated.assignmentStatus === "transferred";
    await appendLeadAssignmentBatch({
      userId: counsellorId,
      lead: updated,
      kind: transferred ? "transferred" : "counsellor",
      assigneeRole: "counsellor",
      actorUserId,
      deferDelivery,
    });
  }
}

/** @deprecated Use appendLeadAssignmentBatch via onLeadAssignmentChange */
export async function notifyLeadAssignedCounsellor(
  lead: LeadLike,
  counsellorId: number,
  options: {
    actorUserId?: number | null;
    performerName?: string | null;
    transferred?: boolean;
  } = {}
): Promise<void> {
  const transferred = options.transferred ?? lead.assignmentStatus === "transferred";
  await appendLeadAssignmentBatch({
    userId: counsellorId,
    lead,
    kind: transferred ? "transferred" : "counsellor",
    assigneeRole: "counsellor",
    actorUserId: options.actorUserId,
  });
}
