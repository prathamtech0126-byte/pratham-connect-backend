import { db } from "../../config/databaseConnection";
import { users } from "../../schemas/users.schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { notifications } from "../schemas/notifications.schema";
import {
  followupAdminEscalationDedupeKey,
  followupManagerEscalationDedupeKey,
  followupOverdueDedupeKey,
  getAdminEscalationUserIds,
  getManagerForUser,
  isFollowupStillPending,
  wasNotificationDeliveredByDedupeKey,
} from "../models/notification.model";
import type { NotificationRow } from "../types/notification.types";
import {
  formatFollowupTime,
  getFollowupAdminEscalationDeliverAt,
  getFollowupFinalWarningDeliverAt,
  getFollowupMissedOverdueDeliverAt,
  getFollowupRepeatOverdueDeliverAt,
  notifyUsers,
} from "../services/notification.service";

type FollowupChainMeta = {
  phase?: string;
  followupAt?: string;
  leadName?: string | null;
  ownerUserId?: number;
};

function leadActionUrl(leadId: number): string {
  return `/leads/${leadId}`;
}

function parseChainMeta(row: NotificationRow): FollowupChainMeta {
  return (row.meta ?? {}) as FollowupChainMeta;
}

async function scheduleOverdueStep(params: {
  leadId: number;
  ownerId: number;
  followupAt: Date;
  phase: "early" | "three_hour" | "five_hour";
  leadName: string;
  whenLabel: string;
}): Promise<void> {
  const { leadId, ownerId, followupAt, phase, leadName, whenLabel } = params;
  const followupAtIso = followupAt.toISOString();

  const copy =
    phase === "early"
      ? {
          title: "Follow-up missed",
          body: `Follow-up with ${leadName} was due at ${whenLabel}. Please complete it now.`,
          deliverAt: getFollowupMissedOverdueDeliverAt(followupAt),
        }
      : phase === "three_hour"
        ? {
            title: "Follow-up still overdue",
            body: `Follow-up with ${leadName} (due ${whenLabel}) is still not completed.`,
            deliverAt: getFollowupRepeatOverdueDeliverAt(followupAt),
          }
        : {
            title: "Final follow-up warning",
            body: `Last warning: complete follow-up for ${leadName} (due ${whenLabel}) now or your manager will be notified.`,
            deliverAt: getFollowupFinalWarningDeliverAt(followupAt),
          };

  const dedupeKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, phase);
  if (await wasNotificationDeliveredByDedupeKey(ownerId, dedupeKey)) return;

  await notifyUsers({
    type: "lead_followup_overdue",
    userIds: [ownerId],
    title: copy.title,
    body: copy.body,
    priority: "high",
    category: "alerts",
    entityType: "lead",
    entityId: leadId,
    actionUrl: leadActionUrl(leadId),
    scheduledAt: followupAt,
    deliverAt: copy.deliverAt,
    deliverImmediately: false,
    dedupeKey,
    meta: {
      leadName,
      followupAt: followupAtIso,
      phase,
      ownerUserId: ownerId,
    },
  });
}

async function notifyManagerEscalation(params: {
  leadId: number;
  ownerId: number;
  followupAt: Date;
  leadName: string;
  whenLabel: string;
}): Promise<void> {
  const manager = await getManagerForUser(params.ownerId);
  if (!manager?.id) {
    console.warn("[followup-chain] no manager for user", params.ownerId);
    return;
  }

  const [owner] = await db
    .select({ fullName: users.fullName, role: users.role })
    .from(users)
    .where(eq(users.id, params.ownerId))
    .limit(1);

  const dedupeKey = followupManagerEscalationDedupeKey(
    params.leadId,
    params.ownerId,
    params.followupAt
  );
  if (await wasNotificationDeliveredByDedupeKey(manager.id, dedupeKey)) return;

  await notifyUsers({
    type: "lead_followup_manager_escalation",
    userIds: [manager.id],
    title: "Follow-up missed — team alert",
    body: `${owner?.fullName ?? "A team member"} has not completed follow-up for ${params.leadName} (due ${params.whenLabel}).`,
    priority: "high",
    category: "alerts",
    entityType: "lead",
    entityId: params.leadId,
    actionUrl: leadActionUrl(params.leadId),
    deliverImmediately: true,
    dedupeKey,
    meta: {
      leadName: params.leadName,
      followupAt: params.followupAt.toISOString(),
      phase: "manager",
      ownerUserId: params.ownerId,
      ownerName: owner?.fullName,
      ownerRole: owner?.role,
      escalationReason: "followup_missed_at_5hr",
    },
  });
}

async function scheduleAdminEscalation(params: {
  leadId: number;
  ownerId: number;
  followupAt: Date;
  leadName: string;
  whenLabel: string;
  managerNotifiedAt: Date;
}): Promise<void> {
  const adminIds = await getAdminEscalationUserIds();
  if (adminIds.length === 0) return;

  const [owner, manager] = await Promise.all([
    db
      .select({ fullName: users.fullName, role: users.role })
      .from(users)
      .where(eq(users.id, params.ownerId))
      .limit(1)
      .then((rows) => rows[0]),
    getManagerForUser(params.ownerId),
  ]);

  const deliverAt = getFollowupAdminEscalationDeliverAt(params.managerNotifiedAt);

  for (const adminId of adminIds) {
    const dedupeKey = followupAdminEscalationDedupeKey(
      params.leadId,
      params.followupAt,
      adminId
    );
    if (await wasNotificationDeliveredByDedupeKey(adminId, dedupeKey)) continue;

    await notifyUsers({
      type: "lead_followup_admin_escalation",
      userIds: [adminId],
      title: "Follow-up escalation — admin alert",
      body: `${owner?.fullName ?? "A team member"} has still not completed follow-up for ${params.leadName} (due ${params.whenLabel}). Manager ${manager?.fullName ?? "was"} notified 24 hours ago and the follow-up remains pending.`,
      priority: "urgent",
      category: "alerts",
      entityType: "lead",
      entityId: params.leadId,
      actionUrl: leadActionUrl(params.leadId),
      deliverAt,
      deliverImmediately: false,
      dedupeKey,
      meta: {
        leadName: params.leadName,
        followupAt: params.followupAt.toISOString(),
        phase: "admin",
        ownerUserId: params.ownerId,
        ownerName: owner?.fullName,
        ownerRole: owner?.role,
        managerId: manager?.id,
        managerName: manager?.fullName,
        managerNotifiedAt: params.managerNotifiedAt.toISOString(),
        escalationReason: "followup_missed_assignee_and_manager",
      },
    });
  }
}

/** After a follow-up notification is delivered, enqueue the next chain step if still pending. */
export async function handleFollowupNotificationDelivered(
  row: NotificationRow
): Promise<void> {
  const followupTypes = new Set([
    "lead_followup_reminder",
    "lead_followup_overdue",
    "lead_followup_manager_escalation",
    "lead_followup_admin_escalation",
  ]);
  if (!followupTypes.has(row.type)) return;

  const meta = parseChainMeta(row);
  const phase = meta.phase;
  const followupAtIso = meta.followupAt;
  const leadId = row.entityId;
  const ownerId = meta.ownerUserId ?? row.userId;

  if (!phase || !followupAtIso || !leadId) return;

  const followupAt = new Date(followupAtIso);
  if (Number.isNaN(followupAt.getTime())) return;

  if (!(await isFollowupStillPending(leadId, followupAt))) return;

  const leadName = meta.leadName ?? `lead #${leadId}`;
  const whenLabel = formatFollowupTime(followupAt);

  switch (phase) {
    case "due":
      await scheduleOverdueStep({
        leadId,
        ownerId,
        followupAt,
        phase: "early",
        leadName,
        whenLabel,
      });
      break;
    case "early":
      await scheduleOverdueStep({
        leadId,
        ownerId,
        followupAt,
        phase: "three_hour",
        leadName,
        whenLabel,
      });
      break;
    case "three_hour":
      await scheduleOverdueStep({
        leadId,
        ownerId,
        followupAt,
        phase: "five_hour",
        leadName,
        whenLabel,
      });
      break;
    case "five_hour":
      await notifyManagerEscalation({
        leadId,
        ownerId,
        followupAt,
        leadName,
        whenLabel,
      });
      break;
    case "manager":
      await scheduleAdminEscalation({
        leadId,
        ownerId,
        followupAt,
        leadName,
        whenLabel,
        managerNotifiedAt: row.deliveredAt ?? new Date(),
      });
      break;
    default:
      break;
  }
}

/** Backup scanner: ensure chain steps exist for overdue pending follow-ups. */
export async function backfillFollowupChainForLead(params: {
  leadId: number;
  ownerId: number;
  followupAt: Date;
  leadName: string;
}): Promise<void> {
  const { leadId, ownerId, followupAt, leadName } = params;
  if (!(await isFollowupStillPending(leadId, followupAt))) return;

  const whenLabel = formatFollowupTime(followupAt);
  const now = Date.now();

  const dueKey = `lead_followup:${leadId}:${ownerId}:${followupAt.getTime()}:due`;
  if (
    now >= followupAt.getTime() &&
    (await wasNotificationDeliveredByDedupeKey(ownerId, dueKey))
  ) {
    const earlyKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "early");
    if (!(await wasNotificationDeliveredByDedupeKey(ownerId, earlyKey))) {
      if (now >= getFollowupMissedOverdueDeliverAt(followupAt).getTime()) {
        await scheduleOverdueStep({
          leadId,
          ownerId,
          followupAt,
          phase: "early",
          leadName,
          whenLabel,
        });
      }
    }
  }

  const earlyKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "early");
  if (
    (await wasNotificationDeliveredByDedupeKey(ownerId, earlyKey)) &&
    now >= getFollowupRepeatOverdueDeliverAt(followupAt).getTime()
  ) {
    const threeKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "three_hour");
    if (!(await wasNotificationDeliveredByDedupeKey(ownerId, threeKey))) {
      await scheduleOverdueStep({
        leadId,
        ownerId,
        followupAt,
        phase: "three_hour",
        leadName,
        whenLabel,
      });
    }
  }

  const threeKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "three_hour");
  if (
    (await wasNotificationDeliveredByDedupeKey(ownerId, threeKey)) &&
    now >= getFollowupFinalWarningDeliverAt(followupAt).getTime()
  ) {
    const fiveKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "five_hour");
    if (!(await wasNotificationDeliveredByDedupeKey(ownerId, fiveKey))) {
      await scheduleOverdueStep({
        leadId,
        ownerId,
        followupAt,
        phase: "five_hour",
        leadName,
        whenLabel,
      });
    }
  }

  const fiveKey = followupOverdueDedupeKey(leadId, ownerId, followupAt, "five_hour");
  if (await wasNotificationDeliveredByDedupeKey(ownerId, fiveKey)) {
    const mgrKey = followupManagerEscalationDedupeKey(leadId, ownerId, followupAt);
    const manager = await getManagerForUser(ownerId);
    if (manager?.id && !(await wasNotificationDeliveredByDedupeKey(manager.id, mgrKey))) {
      await notifyManagerEscalation({ leadId, ownerId, followupAt, leadName, whenLabel });
    }
  }

  const mgrKey = followupManagerEscalationDedupeKey(leadId, ownerId, followupAt);
  const manager = await getManagerForUser(ownerId);
  if (manager?.id && (await wasNotificationDeliveredByDedupeKey(manager.id, mgrKey))) {
    const [deliveredMgr] = await db
      .select({ deliveredAt: notifications.deliveredAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, manager.id),
          eq(notifications.dedupeKey, mgrKey),
          isNotNull(notifications.deliveredAt)
        )
      )
      .limit(1);
    if (deliveredMgr?.deliveredAt) {
      const adminDeliverAt = getFollowupAdminEscalationDeliverAt(deliveredMgr.deliveredAt);
      if (Date.now() >= adminDeliverAt.getTime()) {
        await scheduleAdminEscalation({
          leadId,
          ownerId,
          followupAt,
          leadName,
          whenLabel,
          managerNotifiedAt: deliveredMgr.deliveredAt,
        });
      }
    }
  }
}
