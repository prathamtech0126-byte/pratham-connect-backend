import { db } from "../../config/databaseConnection";
import { users } from "../../schemas/users.schema";
import { notifyUsers } from "../../notification/services/notification.service";
import { and, eq } from "drizzle-orm";

export type FrontDeskNotificationKind =
  | "lead_inbound_registered"
  | "lead_client_self_edited"
  | "lead_frontdesk_verified"
  | "lead_frontdesk_assigned"
  | "lead_frontdesk_updated";

export type PublishFrontDeskNotificationInput = {
  kind: FrontDeskNotificationKind;
  leadId: number;
  leadName?: string | null;
  actorUserId?: number | null;
  /** When set, only notify this user (e.g. link creator). Otherwise all active front_desk users. */
  recipientUserIds?: number[];
  dedupeKey?: string | null;
  meta?: Record<string, unknown>;
};

const frontDeskLeadUrl = (leadId: number): string => `/front-desk/leads/${leadId}`;

async function getActiveFrontDeskUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "front_desk"), eq(users.status, true)));

  return rows.map((row) => row.id);
}

function buildCopy(input: PublishFrontDeskNotificationInput): {
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
} {
  const name = input.leadName?.trim() || `Lead #${input.leadId}`;

  switch (input.kind) {
    case "lead_inbound_registered":
      return {
        title: "New registration",
        body: `${name} registered via the website.`,
        priority: "normal",
      };
    case "lead_client_self_edited":
      return {
        title: "Client updated registration",
        body: `${name} updated their registration via the edit link.`,
        priority: "normal",
      };
    case "lead_frontdesk_verified":
      return {
        title: "Lead verified",
        body: `${name} was verified at front desk.`,
        priority: "normal",
      };
    case "lead_frontdesk_assigned":
      return {
        title: "Lead assigned",
        body: `${name} was assigned to a counsellor.`,
        priority: "normal",
      };
    case "lead_frontdesk_updated":
    default:
      return {
        title: "Lead updated",
        body: `${name} was updated at front desk.`,
        priority: "low",
      };
  }
}

/**
 * Persist + deliver in-app notifications to front desk staff.
 * Uses the main CRM notifications table (src/notification).
 */
export async function publishFrontDeskNotification(
  input: PublishFrontDeskNotificationInput
): Promise<void> {
  const userIds =
    input.recipientUserIds && input.recipientUserIds.length > 0
      ? [...new Set(input.recipientUserIds.filter((id) => id > 0))]
      : await getActiveFrontDeskUserIds();

  if (userIds.length === 0) return;

  const copy = buildCopy(input);

  await notifyUsers({
    type: input.kind,
    userIds,
    title: copy.title,
    body: copy.body,
    priority: copy.priority,
    entityType: "lead",
    entityId: input.leadId,
    actionUrl: frontDeskLeadUrl(input.leadId),
    actorUserId: input.actorUserId ?? null,
    dedupeKey: input.dedupeKey ?? `${input.kind}:${input.leadId}`,
    meta: {
      leadId: input.leadId,
      leadName: input.leadName ?? null,
      ...(input.meta ?? {}),
    },
  });
}
