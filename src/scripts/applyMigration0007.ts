import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0007...");

  await db.execute(sql`
    CREATE TYPE "public"."incentive_slab_rule_group"
      AS ENUM('core_spouse', 'finance_spouse', 'canada_student', 'student', 'all_finance')
  `);
  console.log("✓ Created enum incentive_slab_rule_group");

  await db.execute(sql`
    CREATE TABLE "incentive_slab_rules" (
      "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "rule_group"       "incentive_slab_rule_group" NOT NULL,
      "min_count"        integer NOT NULL,
      "max_count"        integer NOT NULL,
      "incentive_amount" integer NOT NULL,
      "sort_order"       integer DEFAULT 0 NOT NULL,
      "created_at"       timestamp DEFAULT now(),
      "updated_at"       timestamp DEFAULT now()
    )
  `);
  console.log("✓ Created table incentive_slab_rules");

  await db.execute(sql`
    CREATE INDEX "idx_incentive_slab_rules_group"
      ON "incentive_slab_rules" USING btree ("rule_group")
  `);
  await db.execute(sql`
    CREATE INDEX "idx_incentive_slab_rules_group_sort"
      ON "incentive_slab_rules" USING btree ("rule_group", "sort_order")
  `);
  console.log("✓ Created indexes");

  // Drop old table/type if they exist from a prior naming iteration
  await db.execute(sql`DROP TABLE IF EXISTS "incentive_range_rules" CASCADE`);
  await db.execute(sql`DROP TYPE IF EXISTS "public"."incentive_range_rule_group"`);
  console.log("✓ Dropped legacy incentive_range_rules table and enum (if existed)");

  console.log("Migration 0007 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
