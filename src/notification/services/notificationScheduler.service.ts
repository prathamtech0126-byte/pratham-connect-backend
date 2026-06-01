import {
  deleteNotificationsOlderThan,
  FOLLOWUP_MISSED_MINUTES,
  FOLLOWUP_OVERDUE_REPEAT_HOURS,
  NOTIFICATION_RETENTION_DAYS,
} from "../models/notification.model";
import { processMissedFollowUpOverdueScan } from "../integrations/leadNotifications";
import { processDueNotifications } from "./notification.service";

let deliveryInterval: ReturnType<typeof setInterval> | null = null;
let overdueInterval: ReturnType<typeof setInterval> | null = null;
let retentionInterval: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;
let inFlightTicks = 0;

const DELIVERY_SEC = parseInt(process.env.NOTIFICATION_DELIVERY_INTERVAL_SEC || "60", 10);
const OVERDUE_SCAN_SEC = parseInt(process.env.FOLLOWUP_OVERDUE_SCAN_SEC || "300", 10);
const RETENTION_DAYS = NOTIFICATION_RETENTION_DAYS;
const SHUTDOWN_WAIT_MS = parseInt(process.env.NOTIFICATION_SHUTDOWN_WAIT_MS || "5000", 10);

async function runSchedulerTick(label: string, fn: () => Promise<void>): Promise<void> {
  if (shuttingDown) return;
  inFlightTicks++;
  try {
    await fn();
  } catch (err) {
    console.error(`[notificationScheduler] ${label} failed:`, err);
  } finally {
    inFlightTicks--;
  }
}

async function runDeliveryTick(): Promise<void> {
  await runSchedulerTick("delivery tick", async () => {
    await processDueNotifications();
  });
}

async function runOverdueFollowupScan(): Promise<void> {
  await runSchedulerTick("overdue scan", async () => {
    try {
      await processMissedFollowUpOverdueScan();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('relation "notifications" does not exist')) {
        console.warn(
          "[notificationScheduler] notifications table missing — run: npx drizzle-kit migrate"
        );
        return;
      }
      throw err;
    }
  });
}

async function runRetentionCleanup(): Promise<void> {
  await runSchedulerTick("retention cleanup", async () => {
    const deleted = await deleteNotificationsOlderThan(RETENTION_DAYS);
    if (deleted > 0 && process.env.NODE_ENV !== "production") {
      console.log(
        `[notificationScheduler] deleted ${deleted} notifications older than ${RETENTION_DAYS} days`
      );
    }
  });
}

export function startNotificationScheduler(): void {
  if (deliveryInterval) return;

  shuttingDown = false;

  const deliveryMs = Math.max(15, DELIVERY_SEC) * 1000;
  const overdueMs = Math.max(60, OVERDUE_SCAN_SEC) * 1000;

  void runDeliveryTick();
  deliveryInterval = setInterval(() => void runDeliveryTick(), deliveryMs);

  void runOverdueFollowupScan();
  overdueInterval = setInterval(() => void runOverdueFollowupScan(), overdueMs);

  // Daily retention at startup + every 24h
  void runRetentionCleanup();
  retentionInterval = setInterval(() => void runRetentionCleanup(), 24 * 60 * 60 * 1000);

  console.log(
    `🔔 Notification scheduler started (delivery every ${DELIVERY_SEC}s, missed scan every ${OVERDUE_SCAN_SEC}s, missed after ${FOLLOWUP_MISSED_MINUTES}min, repeat after ${FOLLOWUP_OVERDUE_REPEAT_HOURS}h)`
  );
}

export async function stopNotificationScheduler(): Promise<void> {
  shuttingDown = true;

  if (deliveryInterval) clearInterval(deliveryInterval);
  if (overdueInterval) clearInterval(overdueInterval);
  if (retentionInterval) clearInterval(retentionInterval);
  deliveryInterval = null;
  overdueInterval = null;
  retentionInterval = null;

  const deadline = Date.now() + Math.max(1000, SHUTDOWN_WAIT_MS);
  while (inFlightTicks > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
