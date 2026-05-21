import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0011: create rule_configuration_sale_types...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_configuration_sale_types" (
      "id" bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "sale_type_id" bigint NOT NULL,
      "created_at" timestamp DEFAULT now()
    )
  `);

  await db.execute(sql`
    ALTER TABLE "rule_configuration_sale_types"
    ADD CONSTRAINT "rule_configuration_sale_types_rule_configuration_fk"
    FOREIGN KEY ("rule_configuration_id")
    REFERENCES "public"."rule_configuration"("id")
    ON DELETE cascade ON UPDATE no action
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE "rule_configuration_sale_types"
    ADD CONSTRAINT "rule_configuration_sale_types_sale_type_fk"
    FOREIGN KEY ("sale_type_id")
    REFERENCES "public"."sale_type"("id")
    ON DELETE cascade ON UPDATE no action
  `).catch(() => {});

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "uniq_rule_config_sale_type"
    ON "rule_configuration_sale_types" ("rule_configuration_id", "sale_type_id")
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_config"
    ON "rule_configuration_sale_types" ("rule_configuration_id")
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_sale_type"
    ON "rule_configuration_sale_types" ("sale_type_id")
  `);

  console.log("✓ Migration 0011 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0011 failed:", err);
  process.exit(1);
});
