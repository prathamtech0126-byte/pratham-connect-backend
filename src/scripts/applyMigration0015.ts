import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0015: add missing columns in incentive_records...");

  await db.execute(sql`
    ALTER TABLE incentive_records
      ADD COLUMN IF NOT EXISTS client_id bigint,
      ADD COLUMN IF NOT EXISTS core_incentive_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS finance_incentive_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS other_product_incentive_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS total_incentive_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS rule_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb;
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_client ON incentive_records (client_id);`);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_client_id_client_information_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_client_id_client_information_id_fk
          FOREIGN KEY (client_id) REFERENCES client_information(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  console.log("✓ Migration 0015 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0015 failed:", err);
  process.exit(1);
});
