import {
  cacheLeadSnapshot,
  invalidateLeadListCaches,
  publishLeadChange,
} from "../../services/leadRealtime.service";
import { invalidateFrontDeskCaches } from "../../../modules/cache/invalidate";
import { publishFrontDeskRealtimeOnWrite } from "../../../modules/realtime/publishFrontDesk";
import {
  publishFrontDeskNotification,
  type FrontDeskNotificationKind,
} from "../../../modules/notifications/publish";

export type FrontDeskOnWriteMeta = {
  reason: string;
  leadId: number;
  leadName?: string | null;
  actorUserId?: number | null;
  snapshot?: Record<string, unknown>;
  skipNotification?: boolean;
  notificationKind?: FrontDeskNotificationKind;
  recipientUserIds?: number[];
  notificationDedupeKey?: string | null;
  /** Also broadcast to telecaller/counsellor lead pipeline. */
  leadChangeEvent?: string;
  leadChangePayload?: Record<string, unknown>;
  notifyCounsellorId?: number | null;
  notifyTelecallerId?: number | null;
};

/**
 * Single entry point after front desk–relevant CRM writes:
 * realtime first (instant) → Redis bust → notifications → lead pipeline.
 */
export async function publishFrontDeskOnWrite(
  meta: FrontDeskOnWriteMeta
): Promise<void> {
  // 1. Socket signals first — do not block on Redis/cache.
  publishFrontDeskRealtimeOnWrite({
    reason: meta.reason,
    leadId: meta.leadId,
    frontDesk: {
      leadId: meta.leadId,
      snapshot: meta.snapshot,
    },
  });

  // 2. Bust front desk Redis immediately so the next GET is fresh.
  await invalidateFrontDeskCaches();
  // 3. In-app notifications (non-blocking).
  if (!meta.skipNotification && meta.notificationKind) {
    publishFrontDeskNotification({
      kind: meta.notificationKind,
      leadId: meta.leadId,
      leadName: meta.leadName,
      actorUserId: meta.actorUserId,
      recipientUserIds: meta.recipientUserIds,
      dedupeKey: meta.notificationDedupeKey,
    }).catch((err) =>
      console.error("[frontdeskOnWrite] notification error:", err)
    );
  }

  // 4. Counsellor/telecaller lead pipeline (also busts leads:list cache).
  if (meta.leadChangeEvent && meta.leadChangePayload) {
    try {
      await publishLeadChange(meta.leadChangeEvent, meta.leadChangePayload, {
        notifyCounsellorId: meta.notifyCounsellorId,
        notifyTelecallerId: meta.notifyTelecallerId,
      });
    } catch {
      // non-fatal
    }
    return;
  }

  try {
    await invalidateLeadListCaches();
    if (meta.snapshot) await cacheLeadSnapshot(meta.snapshot);
  } catch (err) {
    console.error("[frontdeskOnWrite] cache error:", err);
  }
}
