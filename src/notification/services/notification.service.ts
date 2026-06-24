import { emitToUser } from "../../config/socket";
import {
  FOLLOWUP_MISSED_MINUTES,
  FOLLOWUP_OVERDUE_REPEAT_HOURS,
  getDueUndeliveredNotifications,
  insertNotification,
  markNotificationDelivered,
} from "../models/notification.model";
import type {
  NotificationPayload,
  NotificationRow,
  NotifyInput,
} from "../types/notification.types";
import {
  formatIndianTimeForDisplay,
  indianWallClockToInstant,
} from "../../utils/istTime";
import { getRegistryEntry } from "./notificationEventRegistry";

const FOLLOWUP_REMINDER_MINUTES = parseInt(
  process.env.FOLLOWUP_REMINDER_MINUTES_BEFORE || "5",
  10
);

export function toNotificationPayload(row: NotificationRow): NotificationPayload {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    priority: row.priority,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    actionUrl: row.actionUrl,
    meta: row.meta ?? {},
    deliverAt: row.deliverAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

export async function emitNotificationToUser(
  row: NotificationRow,
  event: "notification:new" | "notification:updated"
): Promise<void> {
  if (event === "notification:updated") {
    const payload = toNotificationPayload(row);
    emitToUser(row.userId, "notification:updated", payload);
    return;
  }

  if (row.deliveredAt) return;

  await markNotificationDelivered(row.id);
  const payload = toNotificationPayload({ ...row, deliveredAt: new Date() });
  emitToUser(row.userId, "notification:new", payload);
}

export async function deliverNotificationRow(row: NotificationRow): Promise<void> {
  await emitNotificationToUser(row, "notification:new");
}

export async function notifyUsers(input: NotifyInput): Promise<void> {
  const registry = getRegistryEntry(input.type);
  const category = input.category ?? registry.category;
  const priority = input.priority ?? registry.defaultPriority;
  const deliverAt = input.deliverAt ?? new Date();
  const deliverImmediately = input.deliverImmediately !== false;

  const uniqueUserIds = [...new Set(input.userIds.filter((id) => id > 0))];
  if (uniqueUserIds.length === 0) return;

  for (const userId of uniqueUserIds) {
    try {
      const row = await insertNotification({
        userId,
        type: input.type,
        category,
        priority,
        title: input.title,
        body: input.body,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
        actorUserId: input.actorUserId ?? null,
        scheduledAt: input.scheduledAt ?? null,
        deliverAt,
        deliveredAt: null,
        dedupeKey: input.dedupeKey ?? null,
        meta: input.meta ?? {},
      });

      if (deliverImmediately && deliverAt.getTime() <= Date.now()) {
        await deliverNotificationRow(row);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = (err as { cause?: { message?: string } })?.cause?.message ?? "";
      if (
        msg.includes('relation "notifications" does not exist') ||
        cause.includes('relation "notifications" does not exist')
      ) {
        return;
      }
      console.error("[notification] Failed to notify user", userId, input.type, err);
    }
  }
}

export async function processDueNotifications(): Promise<number> {
  const due = await getDueUndeliveredNotifications(200);
  for (const row of due) {
    try {
      await deliverNotificationRow(row);
    } catch (err) {
      console.error("[notification] deliver failed", row.id, err);
    }
  }
  return due.length;
}

/** Compute deliverAt from naive IST follow-up wall clock + offset (ms can be negative). */
function deliverAtFromPgNaiveFollowup(followupNaive: Date, offsetMs: number): Date {
  const instant = indianWallClockToInstant(followupNaive);
  const at = new Date(instant.getTime() + offsetMs);
  return at.getTime() <= Date.now() ? new Date() : at;
}

/** When to deliver the “X minutes before” reminder (default 5 min before follow-up). */
export function getFollowupReminderDeliverAt(followupAt: Date): Date {
  return deliverAtFromPgNaiveFollowup(
    followupAt,
    -FOLLOWUP_REMINDER_MINUTES * 60 * 1000
  );
}

/** When to deliver the “follow-up is now” reminder (at scheduled follow-up time). */
export function getFollowupDueDeliverAt(followupAt: Date): Date {
  return deliverAtFromPgNaiveFollowup(followupAt, 0);
}

export function getFollowupReminderMinutesBefore(): number {
  return FOLLOWUP_REMINDER_MINUTES;
}

/** When to deliver the first “missed follow-up” alert (default 5 min after scheduled time). */
export function getFollowupMissedOverdueDeliverAt(followupAt: Date): Date {
  return deliverAtFromPgNaiveFollowup(followupAt, FOLLOWUP_MISSED_MINUTES * 60 * 1000);
}

/** When to deliver the “still overdue” alert (default 3 hours after scheduled time). */
export function getFollowupRepeatOverdueDeliverAt(followupAt: Date): Date {
  return deliverAtFromPgNaiveFollowup(
    followupAt,
    FOLLOWUP_OVERDUE_REPEAT_HOURS * 60 * 60 * 1000
  );
}

/** Format follow-up time for notification body text (IST wall clock from naive PG Date). */
export function formatFollowupTime(d: Date): string {
  return formatIndianTimeForDisplay(d);
}
