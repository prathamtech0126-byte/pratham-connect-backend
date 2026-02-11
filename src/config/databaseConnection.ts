import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";


const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

// Parse DATABASE_URL to check for SSL parameters
const isLocalhost = DATABASE_URL.includes("localhost") || DATABASE_URL.includes("127.0.0.1");
const isProduction = process.env.NODE_ENV === "production";

// For localhost, remove any SSL parameters from connection string
let cleanDatabaseUrl = DATABASE_URL;
if (isLocalhost) {
  // Remove sslmode and other SSL-related parameters for localhost
  cleanDatabaseUrl = DATABASE_URL
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/[?&]ssl=[^&]*/gi, "")
    .replace(/[?&]channel_binding=[^&]*/gi, "");
}

// Determine SSL configuration
// - Localhost: Always disable SSL (local PostgreSQL typically doesn't support SSL)
// - Any remote DB (Neon, Supabase, etc.): Use SSL with rejectUnauthorized: false
//   to avoid "UNABLE_TO_VERIFY_LEAF_SIGNATURE" with cloud provider certificates
let sslConfig: boolean | { rejectUnauthorized: boolean } = false;

if (isLocalhost) {
  // Local database - explicitly disable SSL
  sslConfig = false;
} else {
  // Remote/cloud database - require SSL but do not verify server certificate
  // (cloud providers often use certs that fail default Node verification)
  sslConfig = { rejectUnauthorized: false };
}

if (process.env.NODE_ENV !== "production") {
  console.log(`🔐 SSL Configuration: ${sslConfig === false ? "Disabled" : "Enabled"}`);
  if (isLocalhost) {
    console.log("   ℹ️  Local database detected - SSL disabled");
    if (DATABASE_URL !== cleanDatabaseUrl) {
      console.log("   ℹ️  Removed SSL parameters from connection string");
    }
  }
}

const pool = new Pool({
  connectionString: cleanDatabaseUrl,
  ssl: sslConfig,
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("❌ Unexpected database pool error:", err);
});

// Handle connection errors
pool.on("connect", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("🔌 Database pool connection established");
  }
});

// ✅ Drizzle instance (USE THIS IN CONTROLLERS)
export const db = drizzle(pool);

// ✅ Raw pool for simple queries (e.g. SELECT NOW()) when Drizzle subquery is problematic
export { pool };

// ✅ Connection health check (startup)
export const checkDbConnection = async () => {
  try {
    const result = await pool.query("SELECT current_database()");
    console.log("✅ Connected to DB:", result.rows[0].current_database);
  } catch (error: any) {
    console.error("❌ Database connection error details:");
    console.error("   Error message:", error.message);
    console.error("   Error code:", error.code);
    if (error.code === "ECONNREFUSED") {
      console.error("   💡 Tip: Make sure PostgreSQL is running on localhost:5432");
    } else if (error.code === "28P01") {
      console.error("   💡 Tip: Check your database username and password");
    } else if (error.code === "3D000") {
      console.error("   💡 Tip: Database 'any' does not exist. Create it first.");
    } else if (error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || (error.message?.includes("SSL") || error.message?.includes("certificate"))) {
      console.error("   💡 Tip: SSL/certificate issue. For local DB remove '?sslmode=require' from DATABASE_URL.");
      console.error("   💡 For cloud DB (Neon/Supabase/etc.) the app uses rejectUnauthorized: false - if this still fails, check DATABASE_URL and network.");
    }
    throw error; // Re-throw to let server.ts handle it
  }
};

export default pool;
