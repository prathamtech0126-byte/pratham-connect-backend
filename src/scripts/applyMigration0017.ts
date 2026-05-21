import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0017: add status, sub_type, reference_id to incentive_record_breakdowns...");

  await db.execute(sql`
    ALTER TABLE incentive_record_breakdowns
      ADD COLUMN IF NOT EXISTS sub_type varchar(100),
      ADD COLUMN IF NOT EXISTS status varchar(50),
      ADD COLUMN IF NOT EXISTS reference_id bigint,
      ADD COLUMN IF NOT EXISTS reference_type varchar(50);
  `);

  console.log("✓ Migration 0017 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0017 failed:", err);
  process.exit(1);
});
