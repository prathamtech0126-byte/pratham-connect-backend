import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Creating incentive_category_rule_group enum and incentive_category_rules table...");

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."incentive_category_rule_group"
        AS ENUM('core_visitor', 'visitor_product');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$
  `);
  console.log("✓ Ensured enum incentive_category_rule_group exists");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "incentive_category_rules" (
      "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "rule_group"       "incentive_category_rule_group" NOT NULL,
      "label"            varchar(100) NOT NULL,
      "incentive_amount" integer NOT NULL,
      "sort_order"       integer DEFAULT 0 NOT NULL,
      "created_at"       timestamp DEFAULT now(),
      "updated_at"       timestamp DEFAULT now()
    )
  `);
  console.log("✓ Ensured table incentive_category_rules exists");

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_incentive_category_rules_group"
      ON "incentive_category_rules" USING btree ("rule_group")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_incentive_category_rules_group_sort"
      ON "incentive_category_rules" USING btree ("rule_group", "sort_order")
  `);
  console.log("✓ Ensured indexes exist");

  console.log("Done.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
