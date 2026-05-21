import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0012: add other_product_id to rule_configuration_sale_types...");

  // 1. Make sale_type_id nullable
  await db.execute(sql`
    ALTER TABLE "rule_configuration_sale_types"
    ALTER COLUMN "sale_type_id" DROP NOT NULL
  `);
  console.log("✓ sale_type_id is now nullable");

  // 2. Add other_product_id varchar column
  await db.execute(sql`
    ALTER TABLE "rule_configuration_sale_types"
    ADD COLUMN IF NOT EXISTS "other_product_id" varchar(100)
  `);
  console.log("✓ other_product_id column added");

  // 3. Add CHECK constraint: exactly one of sale_type_id / other_product_id must be non-null
  await db.execute(sql`
    ALTER TABLE "rule_configuration_sale_types"
    ADD CONSTRAINT "chk_rule_config_sale_type_xor_other_product"
    CHECK (
      (sale_type_id IS NOT NULL AND other_product_id IS NULL) OR
      (sale_type_id IS NULL AND other_product_id IS NOT NULL)
    )
  `).catch((err) => {
    if (err.message?.includes("already exists")) {
      console.log("  (CHECK constraint already exists, skipping)");
    } else {
      throw err;
    }
  });
  console.log("✓ XOR CHECK constraint added");

  // 4. Add unique index for other_product_id per config
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "uniq_rule_config_other_product"
    ON "rule_configuration_sale_types" ("rule_configuration_id", "other_product_id")
    WHERE "other_product_id" IS NOT NULL
  `);
  console.log("✓ unique index for other_product_id added");

  // 5. Add index for other_product_id lookups
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_other_product"
    ON "rule_configuration_sale_types" ("other_product_id")
  `);
  console.log("✓ index for other_product_id added");

  console.log("✓ Migration 0012 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0012 failed:", err);
  process.exit(1);
});
