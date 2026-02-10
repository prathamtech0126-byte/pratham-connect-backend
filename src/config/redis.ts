import { createClient } from "redis";

/** Use the same type createClient returns to avoid generic mismatch (RespVersions, modules, etc.) */
type RedisClientInstance = ReturnType<typeof createClient>;

let client: RedisClientInstance | null = null;
let connectPromise: Promise<RedisClientInstance | null> | null = null;
/** Once connection has failed, stop retrying so we don't spam logs. */
let connectionFailed = false;

const isRedisConfigured = () =>
  Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

const getRedisUrl = () => {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;

  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD;

  if (!host) return null;

  // redis://[:password@]host:port
  const auth = password ? `:${encodeURIComponent(password)}@` : "";
  return `redis://${auth}${host}:${port}`;
};

export async function getRedisClient(): Promise<RedisClientInstance | null> {
  if (!isRedisConfigured()) return null;
  if (connectionFailed) return null;
  if (client) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      const url = getRedisUrl();
      if (!url) return null;

      const c = createClient({ url });

      c.on("error", (err: any) => {
        if (!connectionFailed) {
          connectionFailed = true;
          const code = err?.code || err?.errors?.[0]?.code;
          const msg = code === "ECONNREFUSED"
            ? "Redis connection refused (cache disabled). Start Redis or leave REDIS_URL unset."
            : (err?.message || String(err));
          console.error("⚠️ Redis:", msg);
        }
      });

      await c.connect();
      client = c;
      return client;
    } catch (err: any) {
      if (!connectionFailed) {
        connectionFailed = true;
        const code = err?.code || err?.errors?.[0]?.code;
        const msg = code === "ECONNREFUSED"
          ? "Redis connection refused (cache disabled). Start Redis or leave REDIS_URL unset."
          : (err?.message || String(err));
        console.error("⚠️ Redis:", msg);
      }
      client = null;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  try {
    const c = await getRedisClient();
    if (!c) return null;
    const raw = await c.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  try {
    const c = await getRedisClient();
    if (!c) return;
    const payload = JSON.stringify(value);
    await c.set(key, payload, { EX: ttlSeconds });
  } catch {
    // ignore cache write errors
  }
}

export async function redisDel(keys: string | string[]): Promise<void> {
  try {
    const c = await getRedisClient();
    if (!c) return;
    const arr = Array.isArray(keys) ? keys : [keys];
    if (arr.length === 0) return;
    await c.del(arr);
  } catch {
    // ignore
  }
}

export async function redisDelByPrefix(prefix: string): Promise<void> {
  try {
    const c = await getRedisClient();
    if (!c) return;

    const batch: string[] = [];
    for await (const key of c.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 200,
    })) {
      batch.push(String(key));
      if (batch.length >= 200) {
        await c.del(batch);
        batch.length = 0;
      }
    }
    if (batch.length) {
      await c.del(batch);
    }
  } catch {
    // ignore
  }
}

/** Optional eager connect at startup (safe: failure doesn't crash). Returns client if connected, null otherwise. */
export async function initRedis(): Promise<RedisClientInstance | null> {
  return getRedisClient();
}

