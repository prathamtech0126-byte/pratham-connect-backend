import type { CacheResult } from "./getOrSetCache";

/** Fields included on modules API responses so cache behavior is visible. */
export type ApiCacheMeta = {
  cached: boolean;
  cacheSource: "redis" | "database";
  cacheKey: string;
  redisEnabled: boolean;
};

export const toApiCacheMeta = <T>(result: CacheResult<T>): ApiCacheMeta => ({
  cached: result.cached,
  cacheSource: result.source,
  cacheKey: result.cacheKey,
  redisEnabled: result.redisEnabled,
});
