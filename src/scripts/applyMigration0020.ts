import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0020: add transferred_at to leads...");

  await db.execute(sql`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS transferred_at timestamp;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_leads_transferred_at ON leads (transferred_at);
  `);

  await db.execute(sql`
    UPDATE leads
    SET transferred_at = updated_at
    WHERE transferred_at IS NULL
      AND assignment_status IN ('transferred', 'converted', 'dropped')
      AND current_telecaller_id IS NOT NULL;
  `);

  console.log("✓ Migration 0020 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0020 failed:", err);
  process.exit(1);
});
