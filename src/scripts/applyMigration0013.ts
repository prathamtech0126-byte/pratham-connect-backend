import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

/**
 * Migration 0013 — rule configuration contract alignment
 *
 * - periods: first-class date windows (optional FK from rule_configuration)
 * - rule_configuration: description, min_budget_threshold, all_finance_sale_type_categories, period_id
 * - rule_type enum: budget_threshold_slab
 * - budget_rules.label
 *
 * Enum mapping (API ↔ DB, see ruleConfiguration.serializer.ts):
 *   slab ↔ slab, budget ↔ budget, budget_threshold_slab ↔ budget_threshold_slab
 */
async function apply() {
  console.log("Applying migration 0013: periods + rule_configuration extensions + budget_rules.label...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "periods" (
      "id" bigserial PRIMARY KEY,
      "name" varchar(150) NOT NULL,
      "start_date" date NOT NULL,
      "end_date" date,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_by" bigint REFERENCES "users"("id"),
      "created_at" timestamp DEFAULT now()
    )
  `);
  console.log("✓ periods table");

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_periods_dates" ON "periods" ("start_date", "end_date")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_periods_active" ON "periods" ("is_active")
  `);

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TYPE "rule_type" ADD VALUE 'budget_threshold_slab';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  console.log("✓ rule_type enum value budget_threshold_slab");

  await db.execute(sql`
    ALTER TABLE "rule_configuration"
    ADD COLUMN IF NOT EXISTS "period_id" bigint REFERENCES "periods"("id") ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE "rule_configuration"
    ADD COLUMN IF NOT EXISTS "description" text
  `);
  await db.execute(sql`
    ALTER TABLE "rule_configuration"
    ADD COLUMN IF NOT EXISTS "min_budget_threshold" numeric(18, 2)
  `);
  await db.execute(sql`
    ALTER TABLE "rule_configuration"
    ADD COLUMN IF NOT EXISTS "all_finance_sale_type_categories" jsonb
  `);
  console.log("✓ rule_configuration columns");

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_rule_config_period" ON "rule_configuration" ("period_id")
  `);

  await db.execute(sql`
    ALTER TABLE "budget_rules"
    ADD COLUMN IF NOT EXISTS "label" varchar(255)
  `);
  console.log("✓ budget_rules.label");

  console.log("✓ Migration 0013 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0013 failed:", err);
  process.exit(1);
});
