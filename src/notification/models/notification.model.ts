import { db } from "../../config/databaseConnection";
import { notifications } from "../schemas/notifications.schema";
import { leads } from "../../Leads/schemas/leads.schema";
import { leadActivities } from "../../Leads/schemas/leadActivities.schema";
import { users } from "../../schemas/users.schema";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { NotificationRow } from "../types/notification.types";

/** Minutes after scheduled follow-up before the first “missed” alert (default 5). */
export const FOLLOWUP_MISSED_MINUTES = parseInt(
  process.env.FOLLOWUP_MISSED_MINUTES || "5",
  10
);

/** Hours after scheduled follow-up for the 3-hour overdue step (default 3). */
export const FOLLOWUP_OVERDUE_REPEAT_HOURS = parseInt(
  process.env.FOLLOWUP_OVERDUE_HOURS || "3",
  10
);

/** Hours after scheduled follow-up for the final warning step (default 5). */
export const FOLLOWUP_FINAL_WARNING_HOURS = parseInt(
  process.env.FOLLOWUP_FINAL_WARNING_HOURS || "5",
  10
);

/** Hours after manager escalation before admin is notified (default 24). */
export const FOLLOWUP_ADMIN_ESCALATION_HOURS = parseInt(
  process.env.FOLLOWUP_ADMIN_ESCALATION_HOURS || "24",
  10
);

export type FollowupOverduePhase = "early" | "three_hour" | "five_hour";

export function followupReminderDedupeKey(
  leadId: number,
  userId: number,
  followupAt: Date,
  phase: "before" | "due"
): string {
  return `lead_followup:${leadId}:${userId}:${followupAt.getTime()}:${phase}`;
}

export function followupOverdueDedupeKey(
  leadId: number,
  userId: number,
  followupAt: Date,
  phase: FollowupOverduePhase
): string {
  return `lead_overdue:${leadId}:${userId}:${followupAt.getTime()}:${phase}`;
}

export function followupManagerEscalationDedupeKey(
  leadId: number,
  ownerId: number,
  followupAt: Date
): string {
  return `lead_followup_escalation:${leadId}:${ownerId}:${followupAt.getTime()}:manager`;
}

export function followupAdminEscalationDedupeKey(
  leadId: number,
  followupAt: Date,
  adminUserId: number
): string {
  return `lead_followup_escalation:${leadId}:${followupAt.getTime()}:admin:${adminUserId}`;
}

function followupCompletedMetaPatch(): Record<string, unknown> {
  return { followupCompletedAt: new Date().toISOString(), followupCompleted: true };
}

/** UTC cutoff: follow-ups scheduled at or before this time are past the “missed” window. */
export function getFollowupMissedEarlyCutoff(): Date {
  const minutes = Math.max(0, FOLLOWUP_MISSED_MINUTES);
  return new Date(Date.now() - minutes * 60 * 1000);
}

/** UTC cutoff: follow-ups at or before this time qualify for the 3h repeat alert. */
export function getFollowupOverdueRepeatCutoff(): Date {
  const hours = Math.max(0, FOLLOWUP_OVERDUE_REPEAT_HOURS);
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** @deprecated Use getFollowupOverdueRepeatCutoff */
export function getFollowupOverdueCutoff(): Date {
  return getFollowupOverdueRepeatCutoff();
}

/** Inbox list + cleanup window (default 7 days). */
export const NOTIFICATION_RETENTION_DAYS = parseInt(
  process.env.NOTIFICATION_RETENTION_DAYS || "7",
  10
);

export function getNotificationRetentionCutoff(): Date {
  const days = Math.max(1, NOTIFICATION_RETENTION_DAYS);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export type ListNotificationsOptions = {
  userId: number;
  page?: number;
  limit?: number;
  category?: string;
  type?: string;
  unreadOnly?: boolean;
};

export const insertNotification = async (
  data: typeof notifications.$inferInsert
): Promise<NotificationRow> => {
  const now = new Date();
  const values = { ...data, updatedAt: now };

  if (data.dedupeKey) {
    const [row] = await db
      .insert(notifications)
      .values(values)
      .onConflictDoUpdate({
        target: [notifications.userId, notifications.dedupeKey],
        set: {
          title: data.title,
          body: data.body,
          priority: data.priority,
          category: data.category,
          deliverAt: data.deliverAt,
          scheduledAt: data.scheduledAt,
          meta: data.meta,
          actionUrl: data.actionUrl,
          entityType: data.entityType,
          entityId: data.entityId,
          actorUserId: data.actorUserId,
          updatedAt: now,
        },
        setWhere: isNull(notifications.deliveredAt),
      })
      .returning();
    if (row) return row as NotificationRow;

    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, data.userId),
          eq(notifications.dedupeKey, data.dedupeKey!)
        )
      )
      .limit(1);
    return existing as NotificationRow;
  }

  const [row] = await db.insert(notifications).values(values).returning();
  return row as NotificationRow;
};

export const getDueUndeliveredNotifications = async (
  limit = 100
): Promise<NotificationRow[]> => {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        isNull(notifications.deliveredAt),
        isNull(notifications.dismissedAt),
        lte(notifications.deliverAt, new Date())
      )
    )
    .orderBy(notifications.deliverAt)
    .limit(limit);

  return rows as NotificationRow[];
};

export const markNotificationDelivered = async (id: number): Promise<void> => {
  await db
    .update(notifications)
    .set({ deliveredAt: new Date(), updatedAt: new Date() })
    .where(eq(notifications.id, id));
};

export const listNotificationsForUser = async (
  options: ListNotificationsOptions
): Promise<{
  items: NotificationRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 30, 100);
  const offset = (page - 1) * limit;

  const conditions = [
    eq(notifications.userId, options.userId),
    isNotNull(notifications.deliveredAt),
    isNull(notifications.dismissedAt),
    gte(notifications.createdAt, getNotificationRetentionCutoff()),
  ];

  if (options.category) {
    conditions.push(eq(notifications.category, options.category));
  }
  if (options.type) {
    conditions.push(eq(notifications.type, options.type));
  }
  if (options.unreadOnly) {
    conditions.push(isNull(notifications.readAt));
  }

  const whereClause = and(...conditions);

  const items = await db
    .select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(whereClause);

  return {
    items: items as NotificationRow[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

export const getUnreadNotificationCount = async (
  userId: number,
  category?: string
): Promise<number> => {
  const conditions = [
    eq(notifications.userId, userId),
    isNotNull(notifications.deliveredAt),
    isNull(notifications.readAt),
    isNull(notifications.dismissedAt),
    gte(notifications.createdAt, getNotificationRetentionCutoff()),
  ];
  if (category) {
    conditions.push(eq(notifications.category, category));
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(...conditions));

  return total;
};

export const activeLeadAssignmentBatchDedupeKey = (userId: number) =>
  `lead_assign_batch:${userId}`;

export const archiveLeadAssignmentBatchDedupeKey = (
  userId: number,
  notificationId: number
) => `lead_assign_batch:${userId}:archived:${notificationId}`;

export const getUnreadLeadAssignmentBatch = async (
  userId: number
): Promise<NotificationRow | null> => {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.dedupeKey, activeLeadAssignmentBatchDedupeKey(userId)),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt)
      )
    )
    .limit(1);

  return (row as NotificationRow) || null;
};

export const markNotificationRead = async (
  id: number,
  userId: number
): Promise<NotificationRow | null> => {
  const [existing] = await db
    .select({ id: notifications.id, type: notifications.type })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .limit(1);

  const readAt = new Date();
  const patch: Partial<typeof notifications.$inferInsert> = {
    readAt,
    updatedAt: readAt,
  };

  if (existing?.type === "lead_assignment_batch") {
    patch.dedupeKey = archiveLeadAssignmentBatchDedupeKey(userId, id);
  }

  const [row] = await db
    .update(notifications)
    .set(patch)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();

  return (row as NotificationRow) || null;
};

export const markAllNotificationsRead = async (
  userId: number,
  category?: string
): Promise<number> => {
  const conditions = [
    eq(notifications.userId, userId),
    isNull(notifications.readAt),
    isNotNull(notifications.deliveredAt),
  ];
  if (category) {
    conditions.push(eq(notifications.category, category));
  }

  const now = new Date();
  const rows = await db
    .update(notifications)
    .set({ readAt: now, updatedAt: now })
    .where(and(...conditions))
    .returning({ id: notifications.id, type: notifications.type });

  for (const row of rows) {
    if (row.type === "lead_assignment_batch") {
      await db
        .update(notifications)
        .set({
          dedupeKey: archiveLeadAssignmentBatchDedupeKey(userId, row.id),
          updatedAt: now,
        })
        .where(eq(notifications.id, row.id));
    }
  }

  return rows.length;
};

export const dismissNotification = async (
  id: number,
  userId: number
): Promise<boolean> => {
  const [row] = await db
    .update(notifications)
    .set({ dismissedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });

  return !!row;
};

export const cancelNotificationsByDedupePrefix = async (
  userId: number,
  dedupePrefix: string
): Promise<void> => {
  await db
    .update(notifications)
    .set({ dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        sql`${notifications.dedupeKey} LIKE ${dedupePrefix + "%"}`,
        isNull(notifications.deliveredAt)
      )
    );
};

export const cancelLeadFollowupReminders = async (leadId: number): Promise<void> => {
  await closeAllLeadFollowupNotificationsForLead(leadId);
};

/** @deprecated Use closeAllLeadFollowupNotificationsForLead */
export const cancelLeadFollowupOverdue = async (leadId: number): Promise<void> => {
  await closeAllLeadFollowupNotificationsForLead(leadId);
};

export const cancelPendingLeadFollowupNotifications = async (
  leadId: number,
  followupAt?: Date
): Promise<void> => {
  await closeAllLeadFollowupNotificationsForLead(leadId, followupAt);
};

export const LEAD_FOLLOWUP_NOTIFICATION_TYPES = [
  "lead_followup_reminder",
  "lead_followup_overdue",
  "lead_followup_manager_escalation",
  "lead_followup_admin_escalation",
] as const;

/** Mark follow-up chain notifications read + dismissed (stops escalation). */
export const closeAllLeadFollowupNotificationsForLead = async (
  leadId: number,
  followupAt?: Date
): Promise<void> => {
  const completedMeta = JSON.stringify(followupCompletedMetaPatch());
  const now = new Date();
  const followupAtIso = followupAt?.toISOString();

  const conditions = [
    eq(notifications.entityId, leadId),
    inArray(notifications.type, [...LEAD_FOLLOWUP_NOTIFICATION_TYPES]),
  ];
  if (followupAtIso) {
    conditions.push(sql`${notifications.meta}->>'followupAt' = ${followupAtIso}`);
  }

  await db
    .update(notifications)
    .set({
      readAt: now,
      dismissedAt: now,
      updatedAt: now,
      meta: sql`COALESCE(${notifications.meta}, '{}'::jsonb) || ${completedMeta}::jsonb`,
    })
    .where(and(...conditions));
};

export const isFollowupStillPending = async (
  leadId: number,
  followupAt: Date
): Promise<boolean> => {
  const rows = await db
    .select({ followupAt: leadActivities.followupAt })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.leadId, leadId),
        eq(leadActivities.activityType, "followup"),
        eq(leadActivities.status, "pending"),
        isNotNull(leadActivities.followupAt)
      )
    );
  const targetMs = followupAt.getTime();
  return rows.some((row) => {
    if (!row.followupAt) return false;
    return Math.abs(new Date(row.followupAt).getTime() - targetMs) < 2000;
  });
};

export const getManagerForUser = async (
  userId: number
): Promise<{ id: number; fullName: string | null } | null> => {
  const [owner] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!owner?.managerId) return null;

  const [manager] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, owner.managerId))
    .limit(1);
  return manager ?? null;
};

export const getAdminEscalationUserIds = async (): Promise<number[]> => {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.role, ["admin", "superadmin"] as any[]),
        eq(users.status, true)
      )
    );
  return rows.map((r) => r.id);
};

export const wasNotificationDeliveredByDedupeKey = async (
  userId: number,
  dedupeKey: string
): Promise<boolean> => wasOverdueNotificationDelivered(userId, dedupeKey);

function replaceUserIdInDedupeKey(
  dedupeKey: string | null,
  fromUserId: number,
  toUserId: number
): string | null {
  if (!dedupeKey) return null;
  return dedupeKey.split(`:${fromUserId}:`).join(`:${toUserId}:`);
}

/**
 * Move undelivered follow-up notifications from the previous counsellor to the new assignee.
 * Marks the previous counsellor's already-delivered follow-up alerts as read.
 */
export const transferLeadFollowupNotifications = async (
  leadId: number,
  fromUserId: number,
  toUserId: number
): Promise<number> => {
  if (fromUserId === toUserId) return 0;

  const pendingRows = await db
    .select({
      id: notifications.id,
      dedupeKey: notifications.dedupeKey,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, leadId),
        eq(notifications.userId, fromUserId),
        inArray(notifications.type, [...LEAD_FOLLOWUP_NOTIFICATION_TYPES]),
        isNull(notifications.dismissedAt),
        isNull(notifications.deliveredAt)
      )
    );

  const now = new Date();
  let transferred = 0;
  for (const row of pendingRows) {
    const nextDedupeKey = replaceUserIdInDedupeKey(row.dedupeKey, fromUserId, toUserId);
    await db
      .update(notifications)
      .set({
        userId: toUserId,
        dedupeKey: nextDedupeKey,
        updatedAt: now,
      })
      .where(eq(notifications.id, row.id));
    transferred++;
  }

  await db
    .update(notifications)
    .set({ readAt: now, updatedAt: now })
    .where(
      and(
        eq(notifications.entityId, leadId),
        eq(notifications.userId, fromUserId),
        inArray(notifications.type, [...LEAD_FOLLOWUP_NOTIFICATION_TYPES]),
        isNotNull(notifications.deliveredAt),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt)
      )
    );

  return transferred;
};

export const wasOverdueNotificationDelivered = async (
  userId: number,
  dedupeKey: string
): Promise<boolean> => {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.dedupeKey, dedupeKey),
        isNotNull(notifications.deliveredAt)
      )
    )
    .limit(1);

  return !!row;
};

/** Delete all notifications older than the retention window (read and unread). */
export const deleteNotificationsOlderThan = async (
  retentionDays: number
): Promise<number> => {
  const days = Math.max(1, retentionDays);
  const result = await db
    .delete(notifications)
    .where(
      sql`${notifications.createdAt} <= NOW() - INTERVAL ${sql.raw(`'${days} days'`)}`
    )
    .returning({ id: notifications.id });

  return result.length;
};

/** @deprecated Use deleteNotificationsOlderThan */
export const deleteOldReadNotifications = async (
  retentionDays: number
): Promise<number> => deleteNotificationsOlderThan(retentionDays);

/**
 * Leads that have at least one PENDING follow-up activity whose scheduled
 * time is at or before `cutoff`. Uses the actual activity record rather than
 * the denormalised `leads.next_followup_at` so completed follow-ups can never
 * trigger a spurious overdue alert.
 *
 * Returns the earliest pending overdue `followupAt` per lead so the notification
 * body always shows the correct (current) follow-up time.
 */
export const findMissedFollowUpLeads = async (cutoff: Date, limit = 100) => {
  const rows = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      nextFollowupAt: sql<Date>`MIN(${leadActivities.followupAt})`,
      currentCounsellorId: leads.currentCounsellorId,
      currentTelecallerId: leads.currentTelecallerId,
    })
    .from(leads)
    .innerJoin(
      leadActivities,
      and(
        eq(leadActivities.leadId, leads.id),
        eq(leadActivities.activityType, "followup"),
        eq(leadActivities.status, "pending"),
        isNotNull(leadActivities.followupAt),
        lte(leadActivities.followupAt, cutoff)
      )
    )
    .where(eq(leads.progressStatus, "follow_up"))
    .groupBy(
      leads.id,
      leads.fullName,
      leads.currentCounsellorId,
      leads.currentTelecallerId
    )
    .limit(limit);

  return rows;
};

/** @deprecated Use findMissedFollowUpLeads */
export const findOverdueFollowUpLeads = async (limit = 50) =>
  findMissedFollowUpLeads(getFollowupOverdueRepeatCutoff(), limit);

export const getApproverUserIds = async (): Promise<number[]> => {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      inArray(users.role, [
        "superadmin",
        "director",
        "manager",
        "admin",
      ] as any[])
    );

  return rows.map((r) => r.id);
};
