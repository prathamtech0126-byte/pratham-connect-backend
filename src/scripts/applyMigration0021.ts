import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0021: add dropped_at to leads...");

  await db.execute(sql`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS dropped_at timestamp;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_leads_dropped_at ON leads (dropped_at);
  `);

  await db.execute(sql`
    UPDATE leads
    SET dropped_at = updated_at
    WHERE dropped_at IS NULL
      AND assignment_status = 'dropped';
  `);

  console.log("✓ Migration 0021 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0021 failed:", err);
  process.exit(1);
});
