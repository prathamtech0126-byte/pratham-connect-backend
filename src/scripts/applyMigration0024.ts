import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0024: client_information.converted_lead_id...");

  await db.execute(sql`
    ALTER TABLE client_information
    ADD COLUMN IF NOT EXISTS converted_lead_id bigint REFERENCES leads(id);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_converted_lead
      ON client_information(converted_lead_id);
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_converted_lead_unique
      ON client_information(converted_lead_id)
      WHERE converted_lead_id IS NOT NULL;
  `);

  console.log("✓ Migration 0024 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0024 failed:", err);
  process.exit(1);
});
