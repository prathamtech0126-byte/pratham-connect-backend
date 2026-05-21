/**
 * Combined migration script for all incentive/rule tables.
 * Run this against the LIVE database after setting DATABASE_URL to the live connection string.
 *
 * Usage:
 *   1. Set DATABASE_URL in .env to the live database
 *   2. ts-node src/scripts/migrateIncentiveTables.ts
 *   3. Restore DATABASE_URL to local after done
 */
import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

function isAlreadyExistsError(err: any): boolean {
  const code = err?.code ?? err?.cause?.code ?? err?.original?.code;
  const msg: string = err?.message ?? "";
  return (
    code === "42710" || // duplicate_object (type/enum)
    code === "42P07" || // duplicate_table
    code === "42701" || // duplicate_column
    code === "23505" || // unique_violation (index)
    msg.includes("already exists")
  );
}

async function step(label: string, fn: () => Promise<any>) {
  try {
    await fn();
    console.log(`✓ ${label}`);
  } catch (err: any) {
    if (isAlreadyExistsError(err)) {
      console.log(`  (skip) ${label} — already exists`);
    } else {
      console.error(`✗ FAILED: ${label}`);
      console.error("  Error:", err?.message ?? err);
      throw err;
    }
  }
}

async function apply() {
  console.log("=== Incentive / Rule table migration ===\n");

  // ── 0007: incentive_slab_rules ──────────────────────────────────────────
  await step("enum incentive_slab_rule_group", () => db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."incentive_slab_rule_group"
        AS ENUM('core_spouse', 'finance_spouse', 'canada_student', 'student', 'all_finance');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `));

  await step("table incentive_slab_rules", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "incentive_slab_rules" (
      "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "rule_group"       "incentive_slab_rule_group" NOT NULL,
      "min_count"        integer NOT NULL,
      "max_count"        integer NOT NULL,
      "incentive_amount" integer NOT NULL,
      "sort_order"       integer DEFAULT 0 NOT NULL,
      "created_at"       timestamp DEFAULT now(),
      "updated_at"       timestamp DEFAULT now()
    )
  `));

  await step("indexes on incentive_slab_rules", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_incentive_slab_rules_group" ON "incentive_slab_rules" USING btree ("rule_group")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_incentive_slab_rules_group_sort" ON "incentive_slab_rules" USING btree ("rule_group", "sort_order")`);
  });

  // ── categoryRules: incentive_category_rules ─────────────────────────────
  await step("enum incentive_category_rule_group", () => db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."incentive_category_rule_group" AS ENUM('core_visitor', 'visitor_product');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$
  `));

  await step("table incentive_category_rules", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "incentive_category_rules" (
      "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "rule_group"       "incentive_category_rule_group" NOT NULL,
      "label"            varchar(100) NOT NULL,
      "incentive_amount" integer NOT NULL,
      "sort_order"       integer DEFAULT 0 NOT NULL,
      "created_at"       timestamp DEFAULT now(),
      "updated_at"       timestamp DEFAULT now()
    )
  `));

  await step("indexes on incentive_category_rules", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_incentive_category_rules_group" ON "incentive_category_rules" USING btree ("rule_group")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_incentive_category_rules_group_sort" ON "incentive_category_rules" USING btree ("rule_group", "sort_order")`);
  });

  // ── 0008: other_products ────────────────────────────────────────────────
  await step("table other_products", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "other_products" (
      "id"            serial PRIMARY KEY NOT NULL,
      "product_id"    varchar(100) NOT NULL,
      "name"          varchar(255) NOT NULL,
      "category"      varchar(50) NOT NULL,
      "product_name"  varchar(100) NOT NULL,
      "form_type"     varchar(100) NOT NULL,
      "description"   text,
      "is_active"     boolean DEFAULT true NOT NULL,
      "display_order" integer DEFAULT 0,
      "metadata"      text,
      "created_at"    timestamp DEFAULT now() NOT NULL,
      "updated_at"    timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "other_products_product_id_unique" UNIQUE("product_id"),
      CONSTRAINT "other_products_product_name_unique" UNIQUE("product_name")
    )
  `));

  // ── 0009: rule_configuration, budget_rules, slab_rules ─────────────────
  await step("enum rule_type", () => db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."rule_type" AS ENUM('budget', 'slab');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `));

  await step("table rule_configuration", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_configuration" (
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
  `));

  await step("table budget_rules", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "budget_rules" (
      "id"                    bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "budget_amount"         numeric(14, 2) NOT NULL,
      "incentive_amount"      numeric(14, 2) NOT NULL,
      "is_active"             boolean DEFAULT true NOT NULL,
      "created_at"            timestamp DEFAULT now()
    )
  `));

  await step("table slab_rules", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "slab_rules" (
      "id"                    bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "min_slab"              numeric(14, 2) NOT NULL,
      "max_slab"              numeric(14, 2),
      "incentive_amount"      numeric(14, 2) NOT NULL,
      "is_active"             boolean DEFAULT true NOT NULL,
      "created_at"            timestamp DEFAULT now()
    )
  `));

  await step("FK and indexes for rule tables", async () => {
    await db.execute(sql`ALTER TABLE "budget_rules" ADD CONSTRAINT "budget_rules_rule_configuration_id_rule_configuration_id_fk" FOREIGN KEY ("rule_configuration_id") REFERENCES "public"."rule_configuration"("id") ON DELETE cascade ON UPDATE no action`).catch(() => {});
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD CONSTRAINT "rule_configuration_sale_type_category_id_sale_type_category_id_fk" FOREIGN KEY ("sale_type_category_id") REFERENCES "public"."sale_type_category"("id") ON DELETE no action ON UPDATE no action`).catch(() => {});
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD CONSTRAINT "rule_configuration_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`).catch(() => {});
    await db.execute(sql`ALTER TABLE "slab_rules" ADD CONSTRAINT "slab_rules_rule_configuration_id_rule_configuration_id_fk" FOREIGN KEY ("rule_configuration_id") REFERENCES "public"."rule_configuration"("id") ON DELETE cascade ON UPDATE no action`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_budget_rules_config" ON "budget_rules" USING btree ("rule_configuration_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_budget_rules_active" ON "budget_rules" USING btree ("is_active")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_budget_rules_config_active" ON "budget_rules" USING btree ("rule_configuration_id","is_active")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_rule_type" ON "rule_configuration" USING btree ("rule_type")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_category" ON "rule_configuration" USING btree ("sale_type_category_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_active" ON "rule_configuration" USING btree ("is_active")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_dates" ON "rule_configuration" USING btree ("start_date","end_date")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_added_by" ON "rule_configuration" USING btree ("added_by")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_slab_rules_config" ON "slab_rules" USING btree ("rule_configuration_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_slab_rules_active" ON "slab_rules" USING btree ("is_active")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_slab_rules_config_active" ON "slab_rules" USING btree ("rule_configuration_id","is_active")`);
  });

  // ── 0011: rule_configuration_sale_types ────────────────────────────────
  await step("table rule_configuration_sale_types", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rule_configuration_sale_types" (
      "id"                    bigserial PRIMARY KEY NOT NULL,
      "rule_configuration_id" bigint NOT NULL,
      "sale_type_id"          bigint NOT NULL,
      "created_at"            timestamp DEFAULT now()
    )
  `));

  await step("FK + indexes on rule_configuration_sale_types", async () => {
    await db.execute(sql`ALTER TABLE "rule_configuration_sale_types" ADD CONSTRAINT "rule_configuration_sale_types_rule_configuration_fk" FOREIGN KEY ("rule_configuration_id") REFERENCES "public"."rule_configuration"("id") ON DELETE cascade ON UPDATE no action`).catch(() => {});
    await db.execute(sql`ALTER TABLE "rule_configuration_sale_types" ADD CONSTRAINT "rule_configuration_sale_types_sale_type_fk" FOREIGN KEY ("sale_type_id") REFERENCES "public"."sale_type"("id") ON DELETE cascade ON UPDATE no action`).catch(() => {});
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "uniq_rule_config_sale_type" ON "rule_configuration_sale_types" ("rule_configuration_id", "sale_type_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_config" ON "rule_configuration_sale_types" ("rule_configuration_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_sale_type" ON "rule_configuration_sale_types" ("sale_type_id")`);
  });

  // ── 0012: add other_product_id to rule_configuration_sale_types ─────────
  await step("sale_type_id nullable + other_product_id column", async () => {
    await db.execute(sql`ALTER TABLE "rule_configuration_sale_types" ALTER COLUMN "sale_type_id" DROP NOT NULL`).catch(() => {});
    await db.execute(sql`ALTER TABLE "rule_configuration_sale_types" ADD COLUMN IF NOT EXISTS "other_product_id" varchar(100)`);
    await db.execute(sql`
      ALTER TABLE "rule_configuration_sale_types"
      ADD CONSTRAINT "chk_rule_config_sale_type_xor_other_product"
      CHECK (
        (sale_type_id IS NOT NULL AND other_product_id IS NULL) OR
        (sale_type_id IS NULL AND other_product_id IS NOT NULL)
      )
    `).catch(() => {});
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "uniq_rule_config_other_product" ON "rule_configuration_sale_types" ("rule_configuration_id", "other_product_id") WHERE "other_product_id" IS NOT NULL`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_sale_types_other_product" ON "rule_configuration_sale_types" ("other_product_id")`);
  });

  // ── 0013: periods + rule_configuration extensions + budget_rules.label ──
  await step("table periods", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS "periods" (
      "id"         bigserial PRIMARY KEY,
      "name"       varchar(150) NOT NULL,
      "start_date" date NOT NULL,
      "end_date"   date,
      "is_active"  boolean NOT NULL DEFAULT true,
      "created_by" bigint REFERENCES "users"("id"),
      "created_at" timestamp DEFAULT now()
    )
  `));

  await step("indexes on periods", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_periods_dates" ON "periods" ("start_date", "end_date")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_periods_active" ON "periods" ("is_active")`);
  });

  await step("rule_type enum value budget_threshold_slab", () => db.execute(sql`
    DO $$ BEGIN
      ALTER TYPE "rule_type" ADD VALUE 'budget_threshold_slab';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `));

  await step("rule_configuration extra columns", async () => {
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD COLUMN IF NOT EXISTS "period_id" bigint REFERENCES "periods"("id") ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD COLUMN IF NOT EXISTS "description" text`);
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD COLUMN IF NOT EXISTS "min_budget_threshold" numeric(18, 2)`);
    await db.execute(sql`ALTER TABLE "rule_configuration" ADD COLUMN IF NOT EXISTS "all_finance_sale_type_categories" jsonb`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_rule_config_period" ON "rule_configuration" ("period_id")`);
  });

  await step("budget_rules.label column", () => db.execute(sql`
    ALTER TABLE "budget_rules" ADD COLUMN IF NOT EXISTS "label" varchar(255)
  `));

  // ── 0014: incentive_records + incentive_audit_logs ──────────────────────
  await step("enum incentive_record_status", () => db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE incentive_record_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `));

  await step("enum incentive_audit_action_type", () => db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE incentive_audit_action_type AS ENUM ('CALCULATED', 'EDITED', 'APPROVED', 'REJECTED');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `));

  await step("table incentive_records", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_records (
      id                        bigserial PRIMARY KEY,
      counsellor_id             bigint NOT NULL,
      period_id                 bigint,
      rule_id                   bigint,
      rule_sale_type_id         bigint NOT NULL,
      sale_type_id              bigint,
      other_product_id          varchar(100),
      achieved_target_value     integer NOT NULL DEFAULT 0,
      achieved_budget_value     numeric(14,2) NOT NULL DEFAULT 0,
      calculated_incentive      numeric(14,2) NOT NULL DEFAULT 0,
      final_incentive           numeric(14,2),
      status                    incentive_record_status NOT NULL DEFAULT 'PENDING',
      calculated_at             timestamp NOT NULL DEFAULT now(),
      approved_at               timestamp,
      approved_by               bigint,
      created_at                timestamp NOT NULL DEFAULT now(),
      updated_at                timestamp NOT NULL DEFAULT now()
    )
  `));

  await step("table incentive_audit_logs", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_audit_logs (
      id                   bigserial PRIMARY KEY,
      incentive_record_id  bigint NOT NULL,
      action_type          incentive_audit_action_type NOT NULL,
      old_value            numeric(14,2),
      new_value            numeric(14,2),
      remark               text,
      action_by            bigint,
      action_at            timestamp NOT NULL DEFAULT now()
    )
  `));

  await step("indexes + FKs for incentive_records and incentive_audit_logs", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_counsellor ON incentive_records (counsellor_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_period ON incentive_records (period_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_rule ON incentive_records (rule_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_rule_sale_type ON incentive_records (rule_sale_type_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_sale_type ON incentive_records (sale_type_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_status ON incentive_records (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_approved_by ON incentive_records (approved_by)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_record ON incentive_audit_logs (incentive_record_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action ON incentive_audit_logs (action_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action_by ON incentive_audit_logs (action_by)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action_at ON incentive_audit_logs (action_at)`);
    // FKs with existence checks
    for (const [name, stmt] of [
      ["incentive_records_counsellor_id_users_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_counsellor_id_users_id_fk FOREIGN KEY (counsellor_id) REFERENCES users(id)`],
      ["incentive_records_period_id_periods_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_period_id_periods_id_fk FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE SET NULL`],
      ["incentive_records_rule_id_rule_configuration_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_rule_id_rule_configuration_id_fk FOREIGN KEY (rule_id) REFERENCES rule_configuration(id) ON DELETE SET NULL`],
      ["incentive_records_rule_sale_type_id_rule_configuration_sale_types_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_rule_sale_type_id_rule_configuration_sale_types_id_fk FOREIGN KEY (rule_sale_type_id) REFERENCES rule_configuration_sale_types(id)`],
      ["incentive_records_sale_type_id_sale_type_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_sale_type_id_sale_type_id_fk FOREIGN KEY (sale_type_id) REFERENCES sale_type(id) ON DELETE SET NULL`],
      ["incentive_records_approved_by_users_id_fk", sql`ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL`],
      ["incentive_audit_logs_incentive_record_id_incentive_records_id_fk", sql`ALTER TABLE incentive_audit_logs ADD CONSTRAINT incentive_audit_logs_incentive_record_id_incentive_records_id_fk FOREIGN KEY (incentive_record_id) REFERENCES incentive_records(id) ON DELETE CASCADE`],
      ["incentive_audit_logs_action_by_users_id_fk", sql`ALTER TABLE incentive_audit_logs ADD CONSTRAINT incentive_audit_logs_action_by_users_id_fk FOREIGN KEY (action_by) REFERENCES users(id) ON DELETE SET NULL`],
    ] as const) {
      await db.execute(stmt as any).catch(() => {});
    }
  });

  // ── 0015: incentive_records extra columns ───────────────────────────────
  await step("incentive_records columns (client_id, incentive breakdowns, snapshots)", () => db.execute(sql`
    ALTER TABLE incentive_records
      ADD COLUMN IF NOT EXISTS client_id                      bigint,
      ADD COLUMN IF NOT EXISTS core_incentive_amount          numeric(10,2),
      ADD COLUMN IF NOT EXISTS finance_incentive_amount       numeric(10,2),
      ADD COLUMN IF NOT EXISTS other_product_incentive_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS total_incentive_amount         numeric(10,2),
      ADD COLUMN IF NOT EXISTS rule_snapshot                  jsonb,
      ADD COLUMN IF NOT EXISTS calculation_snapshot           jsonb
  `));

  await step("FK + index for incentive_records.client_id", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_client ON incentive_records (client_id)`);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_records_client_id_client_information_id_fk') THEN
          ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_client_id_client_information_id_fk FOREIGN KEY (client_id) REFERENCES client_information(id) ON DELETE SET NULL;
        END IF;
      END $$
    `);
  });

  // ── 0016: more incentive_records columns + incentive_record_breakdowns ──
  await step("incentive_records columns (override, batch, category)", () => db.execute(sql`
    ALTER TABLE incentive_records
      ADD COLUMN IF NOT EXISTS sale_type_category_id   bigint,
      ADD COLUMN IF NOT EXISTS approval_batch_id       varchar(100),
      ADD COLUMN IF NOT EXISTS override_amount         numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_core_sale      numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_all_finance    numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_other_products numeric(10,2),
      ADD COLUMN IF NOT EXISTS remark                  text
  `));

  await step("composite index + unique index on incentive_records", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_client_period ON incentive_records (client_id, period_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_batch ON incentive_records (approval_batch_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_incentive_records_client_period ON incentive_records (client_id, period_id)`);
  });

  await step("FK incentive_records.sale_type_category_id", () => db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_records_sale_type_category_id_sale_type_category_id_fk') THEN
        ALTER TABLE incentive_records ADD CONSTRAINT incentive_records_sale_type_category_id_sale_type_category_id_fk FOREIGN KEY (sale_type_category_id) REFERENCES sale_type_category(id) ON DELETE SET NULL;
      END IF;
    END $$
  `));

  await step("alter incentive_audit_logs old_value/new_value to jsonb", () => db.execute(sql`
    ALTER TABLE incentive_audit_logs
      ALTER COLUMN old_value TYPE jsonb USING to_jsonb(old_value),
      ALTER COLUMN new_value TYPE jsonb USING to_jsonb(new_value)
  `));

  await step("table incentive_record_breakdowns", () => db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_record_breakdowns (
      id                   bigserial PRIMARY KEY,
      incentive_record_id  bigint NOT NULL,
      type                 varchar(50),
      rule_type            varchar(50),
      achieved_value       numeric(10,2),
      slab_min             integer,
      slab_max             integer,
      applied_rate         numeric(10,2),
      calculated_amount    numeric(10,2),
      meta                 jsonb,
      created_at           timestamp DEFAULT now()
    )
  `));

  await step("indexes + FKs + CHECKs for incentive_record_breakdowns", async () => {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_record ON incentive_record_breakdowns (incentive_record_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_type ON incentive_record_breakdowns (type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_rule_type ON incentive_record_breakdowns (rule_type)`);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incentive_record_breakdowns_incentive_record_id_incentive_records_id_fk') THEN
          ALTER TABLE incentive_record_breakdowns ADD CONSTRAINT incentive_record_breakdowns_incentive_record_id_incentive_records_id_fk FOREIGN KEY (incentive_record_id) REFERENCES incentive_records(id) ON DELETE CASCADE;
        END IF;
      END $$
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_incentive_record_breakdowns_type') THEN
          ALTER TABLE incentive_record_breakdowns ADD CONSTRAINT chk_incentive_record_breakdowns_type CHECK (type IN ('CORE', 'ALL_FINANCE', 'OTHER_PRODUCT'));
        END IF;
      END $$
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_incentive_record_breakdowns_rule_type') THEN
          ALTER TABLE incentive_record_breakdowns ADD CONSTRAINT chk_incentive_record_breakdowns_rule_type CHECK (rule_type IN ('slab', 'budget', 'budget_threshold_slab'));
        END IF;
      END $$
    `);
  });

  // ── 0017: incentive_record_breakdowns extra columns ─────────────────────
  await step("incentive_record_breakdowns extra columns (sub_type, status, reference)", () => db.execute(sql`
    ALTER TABLE incentive_record_breakdowns
      ADD COLUMN IF NOT EXISTS sub_type       varchar(100),
      ADD COLUMN IF NOT EXISTS status         varchar(50),
      ADD COLUMN IF NOT EXISTS reference_id   bigint,
      ADD COLUMN IF NOT EXISTS reference_type varchar(50)
  `));

  console.log("\n=== All incentive/rule migrations applied successfully ===");
  process.exit(0);
}

apply().catch((err) => {
  console.error("\nMigration failed:", err?.message ?? err);
  process.exit(1);
});
