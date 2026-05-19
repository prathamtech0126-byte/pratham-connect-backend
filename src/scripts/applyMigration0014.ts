import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0014: create incentive_records and incentive_audit_logs...");

  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE incentive_record_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE incentive_audit_action_type AS ENUM ('CALCULATED', 'EDITED', 'APPROVED', 'REJECTED');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_records (
      id bigserial PRIMARY KEY,
      counsellor_id bigint NOT NULL,
      period_id bigint,
      rule_id bigint,
      rule_sale_type_id bigint NOT NULL,
      sale_type_id bigint,
      other_product_id varchar(100),
      achieved_target_value integer NOT NULL DEFAULT 0,
      achieved_budget_value numeric(14,2) NOT NULL DEFAULT 0,
      calculated_incentive numeric(14,2) NOT NULL DEFAULT 0,
      final_incentive numeric(14,2),
      status incentive_record_status NOT NULL DEFAULT 'PENDING',
      calculated_at timestamp NOT NULL DEFAULT now(),
      approved_at timestamp,
      approved_by bigint,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS incentive_audit_logs (
      id bigserial PRIMARY KEY,
      incentive_record_id bigint NOT NULL,
      action_type incentive_audit_action_type NOT NULL,
      old_value numeric(14,2),
      new_value numeric(14,2),
      remark text,
      action_by bigint,
      action_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_counsellor ON incentive_records (counsellor_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_period ON incentive_records (period_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_rule ON incentive_records (rule_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_rule_sale_type ON incentive_records (rule_sale_type_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_sale_type ON incentive_records (sale_type_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_status ON incentive_records (status);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_records_approved_by ON incentive_records (approved_by);`);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_record ON incentive_audit_logs (incentive_record_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action ON incentive_audit_logs (action_type);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action_by ON incentive_audit_logs (action_by);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_incentive_audit_logs_action_at ON incentive_audit_logs (action_at);`);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_counsellor_id_users_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_counsellor_id_users_id_fk
          FOREIGN KEY (counsellor_id) REFERENCES users(id);
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_period_id_periods_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_period_id_periods_id_fk
          FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_rule_id_rule_configuration_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_rule_id_rule_configuration_id_fk
          FOREIGN KEY (rule_id) REFERENCES rule_configuration(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_rule_sale_type_id_rule_configuration_sale_types_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_rule_sale_type_id_rule_configuration_sale_types_id_fk
          FOREIGN KEY (rule_sale_type_id) REFERENCES rule_configuration_sale_types(id);
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_sale_type_id_sale_type_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_sale_type_id_sale_type_id_fk
          FOREIGN KEY (sale_type_id) REFERENCES sale_type(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_records_approved_by_users_id_fk'
      ) THEN
        ALTER TABLE incentive_records
          ADD CONSTRAINT incentive_records_approved_by_users_id_fk
          FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_audit_logs_incentive_record_id_incentive_records_id_fk'
      ) THEN
        ALTER TABLE incentive_audit_logs
          ADD CONSTRAINT incentive_audit_logs_incentive_record_id_incentive_records_id_fk
          FOREIGN KEY (incentive_record_id) REFERENCES incentive_records(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_audit_logs_action_by_users_id_fk'
      ) THEN
        ALTER TABLE incentive_audit_logs
          ADD CONSTRAINT incentive_audit_logs_action_by_users_id_fk
          FOREIGN KEY (action_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  console.log("✓ Migration 0014 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0014 failed:", err);
  process.exit(1);
});
