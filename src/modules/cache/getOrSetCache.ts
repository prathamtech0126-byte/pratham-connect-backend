import { getRedisClient, redisGetJson, redisSetJson } from "../../config/redis";

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

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  const redisClient = await getRedisClient();
  const redisEnabled = redisClient != null;

  const hit = await redisGetJson<T>(key);
  if (hit !== null) {
    return {
      data: hit,
      cached: true,
      cacheKey: key,
      source: "redis",
      redisEnabled,
    };
  }

  const existing = inflightFetches.get(key) as Promise<T> | undefined;
  if (existing) {
    const data = await existing;
    return {
      data,
      cached: false,
      cacheKey: key,
      source: "database",
      redisEnabled,
    };
  }

  const fetchPromise = (async () => {
    try {
      const data = await fetcher();
      await redisSetJson(key, data, ttlSeconds);
      return data;
    } finally {
      inflightFetches.delete(key);
    }
  })();

  inflightFetches.set(key, fetchPromise);
  const data = await fetchPromise;

  return {
    data,
    cached: false,
    cacheKey: key,
    source: "database",
    redisEnabled,
  };
}
