// export default pool;
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

// Explicit control via env
const useSSL = process.env.DB_SSL === "true";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

// Pool errors
pool.on("error", (err) => {
  console.error("❌ Unexpected database pool error:", err);
});

// Debug
pool.on("connect", () => {
  console.log(
    `🔌 DB connected (SSL: ${useSSL ? "enabled" : "disabled"})`
  );
});

// Drizzle
export const db = drizzle(pool);
export { pool };

// Health check
export const checkDbConnection = async () => {
  try {
    const result = await pool.query("SELECT current_database()");
    // console.log("✅ Connected to DB:", result.rows[0].current_database);
  } catch (error: any) {
    console.error("❌ Database connection error:", error.message);
    throw error;
  }
}; export default pool;