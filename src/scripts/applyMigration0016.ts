import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0016: incentive constraints and breakdown checks...");

  await db.execute(sql`
    ALTER TABLE incentive_records
      ADD COLUMN IF NOT EXISTS sale_type_category_id bigint,
      ADD COLUMN IF NOT EXISTS approval_batch_id varchar(100),
      ADD COLUMN IF NOT EXISTS override_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_core_sale numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_all_finance numeric(10,2),
      ADD COLUMN IF NOT EXISTS override_other_products numeric(10,2),
      ADD COLUMN IF NOT EXISTS remark text;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_incentive_records_client_period
    ON incentive_records (client_id, period_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_incentive_records_batch
    ON incentive_records (approval_batch_id);
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_incentive_records_client_period
    ON incentive_records (client_id, period_id);
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_sale_type_category_id_sale_type_category_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_sale_type_category_id_sale_type_category_id_fk
          FOREIGN KEY (sale_type_category_id) REFERENCES sale_type_category(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    ALTER TABLE incentive_audit_logs
      ALTER COLUMN old_value TYPE jsonb USING to_jsonb(old_value),
      ALTER COLUMN new_value TYPE jsonb USING to_jsonb(new_value);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_record_breakdowns (
      id bigserial PRIMARY KEY,
      incentive_record_id bigint NOT NULL,
      type varchar(50),
      rule_type varchar(50),
      achieved_value numeric(10,2),
      slab_min integer,
      slab_max integer,
      applied_rate numeric(10,2),
      calculated_amount numeric(10,2),
      meta jsonb,
      created_at timestamp DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_record
    ON incentive_record_breakdowns (incentive_record_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_type
    ON incentive_record_breakdowns (type);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_incentive_record_breakdowns_rule_type
    ON incentive_record_breakdowns (rule_type);
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_record_breakdowns_incentive_record_id_incentive_records_id_fk'
      ) THEN
        ALTER TABLE incentive_record_breakdowns
          ADD CONSTRAINT incentive_record_breakdowns_incentive_record_id_incentive_records_id_fk
          FOREIGN KEY (incentive_record_id) REFERENCES incentive_records(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incentive_record_breakdowns_type'
      ) THEN
        ALTER TABLE incentive_record_breakdowns
          ADD CONSTRAINT chk_incentive_record_breakdowns_type
          CHECK (type IN ('CORE', 'ALL_FINANCE', 'OTHER_PRODUCT'));
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_incentive_record_breakdowns_rule_type'
      ) THEN
        ALTER TABLE incentive_record_breakdowns
          ADD CONSTRAINT chk_incentive_record_breakdowns_rule_type
          CHECK (rule_type IN ('slab', 'budget', 'budget_threshold_slab'));
      END IF;
    END $$;
  `);

  console.log("✓ Migration 0016 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0016 failed:", err);
  process.exit(1);
});
