/**
 * Lead list real-time layer: Redis entity snapshots + list-cache bust + Socket.io broadcast.
 * Call after every successful lead DB mutation so clients refresh instantly.
 */
import { redisDelByPrefix, redisGetJson, redisIncr, redisSetJson } from "../../config/redis";
import { TELECALLER_DASHBOARD_STATS_PREFIX } from "./telecallerStatsCache.service";
import { emitToRoles } from "../../config/socket";

export const LEAD_LIST_CACHE_PREFIX = "leads:list:";
const LEAD_REPORT_CACHE_PREFIX = "leads:report:";
const LEAD_ENTITY_PREFIX = "leads:entity:";
const LEAD_ENTITY_TTL_SECONDS = 300;

/**
 * Redis key holding the current lead-list cache generation (integer counter).
 * Incrementing this key effectively invalidates all previously cached list pages
 * without needing a SCAN over potentially hundreds of keys.
 */
const LEAD_LIST_GEN_KEY = "leads:list-gen";
// Keep the generation counter alive for 7 days — it auto-resets to 0 on cold start.
const LEAD_LIST_GEN_TTL = 7 * 24 * 60 * 60;

/** Read the current cache generation (0 when key doesn't exist). */
export async function getLeadListCacheGen(): Promise<number> {
  try {
    const v = await redisGetJson<number>(LEAD_LIST_GEN_KEY);
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

/** Store latest lead row for quick reads / debugging (list queries still hit DB after cache bust). */
export async function cacheLeadSnapshot(lead: Record<string, unknown>): Promise<void> {
  const id = lead?.id ?? lead?.logId;
  if (id == null) return;
  await redisSetJson(`${LEAD_ENTITY_PREFIX}${id}`, lead, LEAD_ENTITY_TTL_SECONDS);
}

/**
 * Invalidate paginated lead list + report + dashboard-stats caches.
 *
 * The list cache uses a generation counter (atomic INCR) instead of a SCAN-based
 * key sweep.  Incrementing the generation makes every previously cached list page
 * unreadable (wrong generation in the key) without touching them directly; they
 * expire on their own TTL.  This is O(1) and cannot silently fail the way SCAN can.
 *
 * The report and telecaller-stats caches are smaller and less critical, so they
 * continue to use prefix-based deletion.
 */
export async function invalidateLeadListCaches(): Promise<void> {
  await Promise.all([
    // Bump the generation counter — the primary, reliable invalidation path.
    redisIncr(LEAD_LIST_GEN_KEY, LEAD_LIST_GEN_TTL),
    // Report and stats caches are smaller; SCAN-delete is fine for them.
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

/** Per-assignee socket notifies after bulk assign (dashboard banner + alert sound). */
export function emitBulkAssignmentNotifies(
  leads: Record<string, unknown>[]
): void {
  const telecallerLatest = new Map<number, Record<string, unknown>>();
  const counsellorLatest = new Map<number, Record<string, unknown>>();

  for (const lead of leads) {
    const telecallerId = Number(lead.currentTelecallerId);
    if (
      Number.isFinite(telecallerId) &&
      telecallerId > 0 &&
      lead.assignmentStatus === "assigned"
    ) {
      telecallerLatest.set(telecallerId, lead);
    }
    const counsellorId = Number(lead.currentCounsellorId);
    if (Number.isFinite(counsellorId) && counsellorId > 0) {
      counsellorLatest.set(counsellorId, lead);
    }
  }

  for (const [telecallerId, lead] of telecallerLatest) {
    emitToRoles(["telecaller"], "lead:assigned:notify", { lead, telecallerId });
  }
  for (const [counsellorId, lead] of counsellorLatest) {
    emitToRoles(["counsellor"], "lead:transferred:notify", { lead, counsellorId });
  }
}

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
  } catch (err) {
    // Non-fatal — DB is source of truth, but log so we can detect failures.
    console.error("[leadRealtime] Cache invalidation error:", err);
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
