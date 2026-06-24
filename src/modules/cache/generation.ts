import { getRedisClient, redisIncr } from "../../config/redis";

/** Global modules cache generation — bump on any modules DB write. */
export const MODULES_CACHE_GEN_KEY = "modules:cache:generation";

export async function getModulesCacheGeneration(): Promise<number> {
  try {
    const c = await getRedisClient();
    if (!c) return 0;
    const raw = await c.get(MODULES_CACHE_GEN_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Bump generation so all `modules:*` cache keys miss on the next read. */
export async function bumpModulesCacheGeneration(): Promise<number | null> {
  return redisIncr(MODULES_CACHE_GEN_KEY);
}
