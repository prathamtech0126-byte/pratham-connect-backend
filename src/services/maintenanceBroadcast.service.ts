import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { eq } from "drizzle-orm";
import { sendBroadcastMessage } from "./message.service";
import type { MaintenanceState } from "./maintenance.service";

/** Roles that receive maintenance broadcast alerts (all non-developer app users). */
export const MAINTENANCE_BROADCAST_TARGET_ROLES = [
  "manager",
  "counsellor",
  "telecaller",
  "front_desk",
  "marketing_head",
  "superadmin",
  "admin",
] as const;

function formatDisplayTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function buildScheduledBody(startTime: string, endTime: string): string {
  return (
    `Pratham Connect will be under scheduled maintenance today from ${formatDisplayTime(startTime)} to ${formatDisplayTime(endTime)}. ` +
    `Please save your work and expect limited access during this window. We will be back online as soon as possible.`
  );
}

function buildImmediateBody(): string {
  return (
    `Pratham Connect is entering maintenance mode now. ` +
    `Please save your work — the application will be temporarily unavailable for your role until maintenance is complete.`
  );
}

function buildLiveBody(startTime: string, endTime: string): string {
  return (
    `Pratham Connect is now under maintenance until ${formatDisplayTime(endTime)} (started at ${formatDisplayTime(startTime)}). ` +
    `Thank you for your patience while we complete scheduled updates.`
  );
}

export async function resolveMaintenanceBroadcastSender(
  preferredSenderId?: number
): Promise<{ id: number; name: string } | null> {
  if (preferredSenderId) {
    const [sender] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, preferredSenderId))
      .limit(1);
    if (sender) return { id: sender.id, name: sender.fullName };
  }

  const [developer] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.role, "developer"))
    .limit(1);

  return developer ? { id: developer.id, name: developer.fullName } : null;
}

export type MaintenanceBroadcastKind = "scheduled" | "immediate" | "live";

export async function sendMaintenanceBroadcast(
  kind: MaintenanceBroadcastKind,
  state: Pick<MaintenanceState, "startTime" | "endTime">,
  preferredSenderId?: number
): Promise<void> {
  const sender = await resolveMaintenanceBroadcastSender(preferredSenderId);
  if (!sender) {
    console.warn("[maintenance] No sender found for maintenance broadcast — skipping");
    return;
  }

  const { startTime, endTime } = state;
  let title = "Scheduled Maintenance";
  let message: string;
  let priority: "high" | "urgent" = "high";

  if (kind === "immediate") {
    title = "Maintenance Starting Now";
    message = buildImmediateBody();
    priority = "urgent";
  } else if (kind === "live" && startTime && endTime) {
    title = "Maintenance In Progress";
    message = buildLiveBody(startTime, endTime);
    priority = "urgent";
  } else if (kind === "scheduled" && startTime && endTime) {
    title = "Scheduled Maintenance Notice";
    message = buildScheduledBody(startTime, endTime);
  } else {
    return;
  }

  if (message.length < 10) return;

  await sendBroadcastMessage(
    {
      title,
      message,
      targetRoles: [...MAINTENANCE_BROADCAST_TARGET_ROLES],
      priority,
    },
    sender.id,
    sender.name
  );
}

/** Notify users when maintenance is armed or goes live. */
export async function notifyMaintenanceBroadcast(
  armed: boolean,
  state: MaintenanceState,
  preferredSenderId?: number,
  effectiveNow = false
): Promise<void> {
  if (!armed) return;

  try {
    if (state.startTime && state.endTime) {
      const kind: MaintenanceBroadcastKind = effectiveNow ? "live" : "scheduled";
      await sendMaintenanceBroadcast(kind, state, preferredSenderId);
    } else {
      await sendMaintenanceBroadcast("immediate", state, preferredSenderId);
    }
  } catch (error) {
    console.error("[maintenance] Failed to send maintenance broadcast:", error);
  }
}
