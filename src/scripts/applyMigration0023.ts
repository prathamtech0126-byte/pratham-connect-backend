import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0023: add process_completed to student_application_status...");

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TYPE student_application_status ADD VALUE 'process_completed';
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  console.log("✓ Migration 0023 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0023 failed:", err);
  process.exit(1);
});
