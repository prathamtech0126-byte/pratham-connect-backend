/**
 * Lead list real-time layer: Redis entity snapshots + list-cache bust + Socket.io broadcast.
 * Call after every successful lead DB mutation so clients refresh instantly.
 */
import { redisDelByPrefix, redisSetJson } from "../../config/redis";
import { TELECALLER_DASHBOARD_STATS_PREFIX } from "./telecallerStatsCache.service";
import { emitToRoles } from "../../config/socket";

export const LEAD_LIST_CACHE_PREFIX = "leads:list:";
const LEAD_REPORT_CACHE_PREFIX = "leads:report:";
const LEAD_ENTITY_PREFIX = "leads:entity:";
const LEAD_ENTITY_TTL_SECONDS = 300;

/** Store latest lead row for quick reads / debugging (list queries still hit DB after cache bust). */
export async function cacheLeadSnapshot(lead: Record<string, unknown>): Promise<void> {
  const id = lead?.id ?? lead?.logId;
  if (id == null) return;
  await redisSetJson(`${LEAD_ENTITY_PREFIX}${id}`, lead, LEAD_ENTITY_TTL_SECONDS);
}

/** Invalidate paginated lead list + report caches so next HTTP fetch is fresh. */
export async function invalidateLeadListCaches(): Promise<void> {
  await Promise.all([
    redisDelByPrefix(LEAD_LIST_CACHE_PREFIX),
    redisDelByPrefix(LEAD_REPORT_CACHE_PREFIX),
    redisDelByPrefix(TELECALLER_DASHBOARD_STATS_PREFIX),
  ]);
}

type PublishLeadChangeOptions = {
  /** When set, telecallers receive `lead:assigned:notify` (filtered client-side by id). */
  notifyTelecallerId?: number | null;
  /** When set, counsellors receive `lead:transferred:notify` (filtered client-side by id). */
  notifyCounsellorId?: number | null;
};

/**
 * Redis first (entity snapshot + list cache bust), then Socket.io to role rooms.
 */
export async function publishLeadChange(
  event: string,
  lead: Record<string, unknown>,
  options?: PublishLeadChangeOptions
): Promise<void> {
  try {
    await invalidateLeadListCaches();
    await cacheLeadSnapshot(lead);
  } catch {
    // non-fatal — DB is source of truth
  }

  try {
    const roles = ["telecaller", "counsellor", "admin", "developer", "manager", "marketing_head"];
    emitToRoles(roles, event, lead);

    const telecallerId = options?.notifyTelecallerId;
    if (telecallerId != null) {
      emitToRoles(["telecaller"], "lead:assigned:notify", {
        lead,
        telecallerId,
      });
    }

    const counsellorId = options?.notifyCounsellorId;
    if (counsellorId != null) {
      emitToRoles(["counsellor"], "lead:transferred:notify", {
        lead,
        counsellorId,
      });
    }
  } catch {
    // ignore websocket errors in HTTP path
  }
}
