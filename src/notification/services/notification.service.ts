import { emitToUser } from "../../config/socket";
import {
  FOLLOWUP_ADMIN_ESCALATION_HOURS,
  FOLLOWUP_FINAL_WARNING_HOURS,
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
import { getRegistryEntry } from "./notificationEventRegistry";
import {
  wrapNotificationSocketPayload,
} from "./notificationRealtime.service";

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
    body: row.body?.replace(/\$/g, "₹") ?? null,
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
    const payload = wrapNotificationSocketPayload(toNotificationPayload(row));
    emitToUser(row.userId, "notification:updated", payload);
    return;
  }

  if (row.deliveredAt) return;

  await markNotificationDelivered(row.id);
  const payload = wrapNotificationSocketPayload(
    toNotificationPayload({ ...row, deliveredAt: new Date() })
  );
  emitToUser(row.userId, "notification:new", payload);
}

export async function deliverNotificationRow(row: NotificationRow): Promise<void> {
  if (row.deliveredAt) {
    await emitNotificationToUser(row, "notification:updated");
    return;
  }
  await emitNotificationToUser(row, "notification:new");

  // Lazy require avoids circular init with followupNotificationChain (which imports notifyUsers).
  const { handleFollowupNotificationDelivered } = require(
    "../integrations/followupNotificationChain.service"
  ) as Pick<
    typeof import("../integrations/followupNotificationChain.service.js"),
    "handleFollowupNotificationDelivered"
  >;
  const deliveredRow = { ...row, deliveredAt: new Date() };
  try {
    await handleFollowupNotificationDelivered(deliveredRow);
  } catch (err) {
    console.error("[notification] followup chain failed", row.id, err);
  }
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

function deliverAtFromFollowup(followupAt: Date, offsetMs: number): Date {
  const at = new Date(followupAt.getTime() + offsetMs);
  return at.getTime() <= Date.now() ? new Date() : at;
}

/** When to deliver the “X minutes before” reminder (default 5 min before follow-up). */
export function getFollowupReminderDeliverAt(followupAt: Date): Date {
  return deliverAtFromFollowup(
    followupAt,
    -FOLLOWUP_REMINDER_MINUTES * 60 * 1000
  );
}

/** When to deliver the “follow-up is now” reminder (at scheduled follow-up time). */
export function getFollowupDueDeliverAt(followupAt: Date): Date {
  return deliverAtFromFollowup(followupAt, 0);
}

export function getFollowupReminderMinutesBefore(): number {
  return FOLLOWUP_REMINDER_MINUTES;
}

/** When to deliver the first “missed follow-up” alert (default 5 min after scheduled time). */
export function getFollowupMissedOverdueDeliverAt(followupAt: Date): Date {
  return deliverAtFromFollowup(followupAt, FOLLOWUP_MISSED_MINUTES * 60 * 1000);
}

/** When to deliver the 3-hour overdue step (default 3 hours after scheduled time). */
export function getFollowupRepeatOverdueDeliverAt(followupAt: Date): Date {
  return deliverAtFromFollowup(
    followupAt,
    FOLLOWUP_OVERDUE_REPEAT_HOURS * 60 * 60 * 1000
  );
}

/** When to deliver the final warning step (default 5 hours after scheduled time). */
export function getFollowupFinalWarningDeliverAt(followupAt: Date): Date {
  return deliverAtFromFollowup(
    followupAt,
    FOLLOWUP_FINAL_WARNING_HOURS * 60 * 60 * 1000
  );
}

/** When to deliver admin escalation after manager was notified. */
export function getFollowupAdminEscalationDeliverAt(managerNotifiedAt: Date): Date {
  const at = new Date(
    managerNotifiedAt.getTime() + FOLLOWUP_ADMIN_ESCALATION_HOURS * 60 * 60 * 1000
  );
  return at.getTime() <= Date.now() ? new Date() : at;
}

/** Format follow-up time for notification body text. */
export function formatFollowupTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
