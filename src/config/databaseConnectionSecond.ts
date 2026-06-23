import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as modulesSchema from "../modules/schema";

type ModulesDb = NodePgDatabase<typeof modulesSchema>;

let poolInstance: Pool | null = null;
let dbInstance: ModulesDb | null = null;

export const isModulesDbConfigured = (): boolean =>
  Boolean(process.env.DATABASE_URL_SECOND?.trim());

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL_SECOND?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL_SECOND missing");
  }

  const useSSL = process.env.DB_SSL === "true";
  const pool = new Pool({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  });

  pool.on("error", (err) => {
    console.error("❌ Unexpected modules database pool error:", err);
  });

  pool.on("connect", () => {
    console.log(
      `🔌 Modules DB connected (SSL: ${useSSL ? "enabled" : "disabled"})`
    );
  });

  return pool;
}

export const getPoolSecond = (): Pool => {
  if (!poolInstance) {
    poolInstance = createPool();
  }
  return poolInstance;
};

export const getDbSecond = (): ModulesDb => {
  if (!dbInstance) {
    dbInstance = drizzle(getPoolSecond(), { schema: modulesSchema });
  }
  return dbInstance;
};

function poolProxy(): Pool {
  return getPoolSecond();
}

function dbProxy(): ModulesDb {
  return getDbSecond();
}

/** Lazy modules pool — safe to import before dotenv when DATABASE_URL_SECOND is set later. */
export const poolSecond: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const pool = poolProxy();
    const value = Reflect.get(pool, prop, pool);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(pool)
      : value;
  },
});

/** Lazy Drizzle client for `src/modules/**` (DATABASE_URL_SECOND). */
export const dbSecond: ModulesDb = new Proxy({} as ModulesDb, {
  get(_target, prop) {
    const db = dbProxy();
    const value = Reflect.get(db, prop, db);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(db)
      : value;
  },
});

export const checkDbSecondConnection = async () => {
  try {
    await getPoolSecond().query("SELECT current_database()");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Modules database connection error:", message);
    throw error;
  }
};

export default poolSecond;
