import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0019: add tour_seen_pages to users...");

  await db.execute(sql`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tour_seen_pages json DEFAULT '[]'::json;
  `);

  console.log("✓ Migration 0019 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0019 failed:", err);
  process.exit(1);
});
