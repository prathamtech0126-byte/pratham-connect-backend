import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

/**
 * Migration 0025: leads + lead_activities timestamp columns → timestamptz (UTC).
 * Existing naive values are interpreted as Asia/Kolkata wall clock before conversion.
 */
async function apply() {
  console.log("Applying migration 0025: leads timestamptz columns...");

  const leadColumns = [
    "created_at",
    "updated_at",
    "next_followup_at",
    "transferred_at",
    "converted_at",
    "dropped_at",
    "verified_at",
  ] as const;

  for (const col of leadColumns) {
    await db.execute(sql.raw(`
      ALTER TABLE leads
      ALTER COLUMN ${col} TYPE timestamptz
      USING (
        CASE
          WHEN ${col} IS NULL THEN NULL
          ELSE ${col} AT TIME ZONE 'Asia/Kolkata'
        END
      );
    `));
  }

  await db.execute(sql`
    ALTER TABLE leads
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();
  `);

  console.log("Applying migration 0025: lead_activities timestamptz columns...");

  const activityColumns = ["followup_at", "created_at", "updated_at"] as const;

  for (const col of activityColumns) {
    await db.execute(sql.raw(`
      ALTER TABLE lead_activities
      ALTER COLUMN ${col} TYPE timestamptz
      USING (
        CASE
          WHEN ${col} IS NULL THEN NULL
          ELSE ${col} AT TIME ZONE 'Asia/Kolkata'
        END
      );
    `));
  }

  await db.execute(sql`
    ALTER TABLE lead_activities
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();
  `);

  console.log("✓ Migration 0025 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0025 failed:", err);
  process.exit(1);
});
