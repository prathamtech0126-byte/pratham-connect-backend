import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as modulesSchema from "../modules/schema";

const DATABASE_URL_SECOND = process.env.DATABASE_URL_SECOND?.trim();

if (!DATABASE_URL_SECOND) {
  throw new Error("DATABASE_URL_SECOND missing");
}

const useSSL = process.env.DB_SSL === "true";

const poolSecond = new Pool({
  connectionString: DATABASE_URL_SECOND,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

poolSecond.on("error", (err) => {
  console.error("❌ Unexpected modules database pool error:", err);
});

poolSecond.on("connect", () => {
  console.log(
    `🔌 Modules DB connected (SSL: ${useSSL ? "enabled" : "disabled"})`
  );
});

/**
 * Drizzle for `src/modules/**` only — connects to DATABASE_URL_SECOND (payment-database).
 * Use instead of `db` from databaseConnection for clients, sales, payments, products, countries.
 */
export const dbSecond = drizzle(poolSecond, { schema: modulesSchema });
export { poolSecond };

export const checkDbSecondConnection = async () => {
  try {
    await poolSecond.query("SELECT current_database()");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Modules database connection error:", message);
    throw error;
  }
};

export default poolSecond;
