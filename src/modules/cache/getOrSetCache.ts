import { getRedisClient, redisGetJson, redisSetJson } from "../../config/redis";
import { getModulesCacheGeneration } from "./generation";

export type CacheSource = "redis" | "database";

export type CacheResult<T> = {
  data: T;
  /** true when served from Redis; false when freshly loaded from DB. */
  cached: boolean;
  cacheKey: string;
  source: CacheSource;
  redisEnabled: boolean;
};

/** Coalesce concurrent cache misses for the same key into one DB fetch. */
const inflightFetches = new Map<string, Promise<unknown>>();

const MODULES_KEY_PREFIX = "modules:";

const isModulesCacheKey = (key: string): boolean =>
  key.startsWith(MODULES_KEY_PREFIX);

type ResolvedCacheKey = {
  redisKey: string;
  /** Base key returned in API meta; generation suffix omitted. */
  displayKey: string;
  /** Captured at read start — skip cache write if generation changed during fetch. */
  generation: number | null;
};

const resolveCacheKey = async (key: string): Promise<ResolvedCacheKey> => {
  if (!isModulesCacheKey(key)) {
    return { redisKey: key, displayKey: key, generation: null };
  }

  const generation = await getModulesCacheGeneration();
  return {
    redisKey: `${key}:g:${generation}`,
    displayKey: key,
    generation,
  };
};

const shouldWriteCache = async (
  generation: number | null
): Promise<boolean> => {
  if (generation === null) return true;
  return (await getModulesCacheGeneration()) === generation;
};

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  const redisClient = await getRedisClient();
  const redisEnabled = redisClient != null;
  const resolved = await resolveCacheKey(key);

  const hit = await redisGetJson<T>(resolved.redisKey);
  if (hit !== null) {
    return {
      data: hit,
      cached: true,
      cacheKey: resolved.displayKey,
      source: "redis",
      redisEnabled,
    };
  }

  const existing = inflightFetches.get(resolved.redisKey) as
    | Promise<T>
    | undefined;
  if (existing) {
    const data = await existing;
    return {
      data,
      cached: false,
      cacheKey: resolved.displayKey,
      source: "database",
      redisEnabled,
    };
  }

  const fetchPromise = (async () => {
    try {
      const data = await fetcher();
      if (await shouldWriteCache(resolved.generation)) {
        await redisSetJson(resolved.redisKey, data, ttlSeconds);
      }
      return data;
    } finally {
      inflightFetches.delete(resolved.redisKey);
    }
  })();

  inflightFetches.set(resolved.redisKey, fetchPromise);
  const data = await fetchPromise;

  return {
    data,
    cached: false,
    cacheKey: resolved.displayKey,
    source: "database",
    redisEnabled,
  };
}
