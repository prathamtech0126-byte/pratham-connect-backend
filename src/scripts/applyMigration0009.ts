import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0009...");

  await db.execute(sql`
    CREATE TYPE "public"."rule_type" AS ENUM('budget', 'slab')
  `);
  console.log("✓ Created enum rule_type");

  await db.execute(sql`
    CREATE TABLE "rule_configuration" (
      "id"                     bigserial PRIMARY KEY NOT NULL,
      "name"                   varchar(150) NOT NULL,
      "rule_type"              "rule_type" NOT NULL,
      "start_date"             date NOT NULL,
      "end_date"               date,
      "sale_type_category_id"  bigint,
      "is_active"              boolean DEFAULT true NOT NULL,
      "added_by"               bigint,
      "created_at"             timestamp DEFAULT now()
    )
  `);
  console.log("✓ Created table rule_configuration");

  await db.execute(sql`
    CREATE TABLE "budget_rules" (
      "id"                    bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "budget_amount"         numeric(14, 2) NOT NULL,
      "incentive_amount"      numeric(14, 2) NOT NULL,
      "is_active"             boolean DEFAULT true NOT NULL,
      "created_at"            timestamp DEFAULT now()
    )
  `);
  console.log("✓ Created table budget_rules");

  await db.execute(sql`
    CREATE TABLE "slab_rules" (
      "id"                    bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "min_slab"              numeric(14, 2) NOT NULL,
      "max_slab"              numeric(14, 2),
      "incentive_amount"      numeric(14, 2) NOT NULL,
      "is_active"             boolean DEFAULT true NOT NULL,
      "created_at"            timestamp DEFAULT now()
    )
  `);
  console.log("✓ Created table slab_rules");

  await db.execute(sql`
    ALTER TABLE "budget_rules"
      ADD CONSTRAINT "budget_rules_rule_configuration_id_rule_configuration_id_fk"
      FOREIGN KEY ("rule_configuration_id")
      REFERENCES "public"."rule_configuration"("id")
      ON DELETE cascade ON UPDATE no action
  `);

  await db.execute(sql`
    ALTER TABLE "rule_configuration"
      ADD CONSTRAINT "rule_configuration_sale_type_category_id_sale_type_category_id_fk"
      FOREIGN KEY ("sale_type_category_id")
      REFERENCES "public"."sale_type_category"("id")
      ON DELETE no action ON UPDATE no action
  `);

  await db.execute(sql`
    ALTER TABLE "rule_configuration"
      ADD CONSTRAINT "rule_configuration_added_by_users_id_fk"
      FOREIGN KEY ("added_by")
      REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action
  `);

  await db.execute(sql`
    ALTER TABLE "slab_rules"
      ADD CONSTRAINT "slab_rules_rule_configuration_id_rule_configuration_id_fk"
      FOREIGN KEY ("rule_configuration_id")
      REFERENCES "public"."rule_configuration"("id")
      ON DELETE cascade ON UPDATE no action
  `);
  console.log("✓ Added foreign key constraints");

  await db.execute(sql`CREATE INDEX "idx_budget_rules_config" ON "budget_rules" USING btree ("rule_configuration_id")`);
  await db.execute(sql`CREATE INDEX "idx_budget_rules_active" ON "budget_rules" USING btree ("is_active")`);
  await db.execute(sql`CREATE INDEX "idx_budget_rules_config_active" ON "budget_rules" USING btree ("rule_configuration_id","is_active")`);
  await db.execute(sql`CREATE INDEX "idx_rule_config_rule_type" ON "rule_configuration" USING btree ("rule_type")`);
  await db.execute(sql`CREATE INDEX "idx_rule_config_category" ON "rule_configuration" USING btree ("sale_type_category_id")`);
  await db.execute(sql`CREATE INDEX "idx_rule_config_active" ON "rule_configuration" USING btree ("is_active")`);
  await db.execute(sql`CREATE INDEX "idx_rule_config_dates" ON "rule_configuration" USING btree ("start_date","end_date")`);
  await db.execute(sql`CREATE INDEX "idx_rule_config_added_by" ON "rule_configuration" USING btree ("added_by")`);
  await db.execute(sql`CREATE INDEX "idx_slab_rules_config" ON "slab_rules" USING btree ("rule_configuration_id")`);
  await db.execute(sql`CREATE INDEX "idx_slab_rules_active" ON "slab_rules" USING btree ("is_active")`);
  await db.execute(sql`CREATE INDEX "idx_slab_rules_config_active" ON "slab_rules" USING btree ("rule_configuration_id","is_active")`);
  console.log("✓ Created indexes");

  console.log("Migration 0009 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
