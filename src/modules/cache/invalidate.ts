import { redisDel, redisDelByPrefix } from "../../config/redis";
import {
  publishModulesRealtimeOnWrite,
  type ModulesRealtimeWriteMeta,
} from "../realtime/publish";
import { bumpModulesCacheGeneration } from "./generation";
import { MODULE_CACHE_KEYS } from "./keys";

const safeRun = async (
  task: () => Promise<void>,
  label = "cache invalidation"
): Promise<void> => {
  try {
    await task();
  } catch (err) {
    // Must never fail a DB write or API response — log for ops visibility.
    console.warn(`[cache] ${label} failed:`, err);
  }
};

export async function invalidateStagesCaches(): Promise<void> {
  await safeRun(async () => {
    await Promise.all([
      redisDelByPrefix(MODULE_CACHE_KEYS.STAGES_PIPELINES),
      redisDelByPrefix(MODULE_CACHE_KEYS.STAGES_PIPELINE),
      redisDelByPrefix(MODULE_CACHE_KEYS.STAGES_TREE),
      redisDelByPrefix(MODULE_CACHE_KEYS.STAGES_LIST),
      redisDelByPrefix(MODULE_CACHE_KEYS.STAGES_DETAIL),
    ]);
  });
}

export async function invalidateCountriesCaches(): Promise<void> {
  await safeRun(async () => {
    await Promise.all([
      redisDelByPrefix(MODULE_CACHE_KEYS.COUNTRIES_LIST),
      redisDelByPrefix(MODULE_CACHE_KEYS.COUNTRIES_DETAIL),
    ]);
  });
}

export async function invalidateReportsCaches(): Promise<void> {
  await safeRun(() => redisDelByPrefix(MODULE_CACHE_KEYS.REPORTS));
}

export async function invalidateVisaCaseCaches(): Promise<void> {
  await safeRun(() => redisDelByPrefix(MODULE_CACHE_KEYS.VISA_CASE));
}

export async function invalidateJourneyCachesForClient(
  clientId: string
): Promise<void> {
  await safeRun(async () => {
    await Promise.all([
      redisDel(`${MODULE_CACHE_KEYS.JOURNEY_TIMELINE}${clientId}`),
      redisDel(`${MODULE_CACHE_KEYS.JOURNEY_SUMMARY}${clientId}`),
    ]);
  });
}

/** Immediately invalidate front desk reads (bump generation + delete stale keys). */
export async function invalidateFrontDeskCaches(): Promise<void> {
  await safeRun(async () => {
    await bumpModulesCacheGeneration();
    await redisDelByPrefix(MODULE_CACHE_KEYS.FRONTDESK);
  }, "front desk cache invalidation");
}

export type ModulesCacheInvalidation = ModulesRealtimeWriteMeta & {
  countries?: boolean;
};

/**
 * Immediately delete related Redis keys after a modules DB write.
 * TTL is only a fallback — the next read always hits the database after any mutation.
 */
export async function invalidateModulesCachesOnWrite(
  options: ModulesCacheInvalidation = {}
): Promise<void> {
  await safeRun(async () => {
    // Bump generation first — next read misses immediately (no SCAN race).
    await bumpModulesCacheGeneration();

    const tasks: Promise<void>[] = [
      invalidateVisaCaseCaches(),
      invalidateReportsCaches(),
    ];

    const clientId = options.clientId?.trim();
    if (clientId) {
      tasks.push(invalidateJourneyCachesForClient(clientId));
    }

    if (options.countries) {
      tasks.push(invalidateCountriesCaches());
    }

    await Promise.all(tasks);
    publishModulesRealtimeOnWrite(options);
  });
}

/** @deprecated Use invalidateModulesCachesOnWrite */
export const invalidateAfterVisaCaseMutation = invalidateModulesCachesOnWrite;
