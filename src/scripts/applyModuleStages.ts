import "dotenv/config";
import { poolSecond } from "../config/databaseConnectionSecond";

async function apply() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Applying modules migration: stage pipelines and definitions...");

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS stage_pipelines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(64) NOT NULL UNIQUE,
      name varchar(255) NOT NULL,
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_pipelines_code
      ON stage_pipelines(code);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_pipelines_is_active
      ON stage_pipelines(is_active);
  `);

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS stage_definitions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pipeline_id uuid NOT NULL REFERENCES stage_pipelines(id) ON DELETE CASCADE,
      parent_id uuid,
      code varchar(128) NOT NULL,
      label varchar(255) NOT NULL,
      description text,
      kind varchar(32) NOT NULL DEFAULT 'macro',
      team varchar(32),
      sort_order integer NOT NULL DEFAULT 0,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_system boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uniq_stage_definitions_pipeline_code UNIQUE (pipeline_id, code)
    );
  `);

  await poolSecond.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'stage_definitions_parent_id_fkey'
      ) THEN
        ALTER TABLE stage_definitions
          ADD CONSTRAINT stage_definitions_parent_id_fkey
          FOREIGN KEY (parent_id) REFERENCES stage_definitions(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_definitions_pipeline_id
      ON stage_definitions(pipeline_id);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_definitions_parent_id
      ON stage_definitions(parent_id);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_definitions_is_active
      ON stage_definitions(is_active);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_stage_definitions_sort_order
      ON stage_definitions(sort_order);
  `);

  console.log("✓ stage pipelines and definitions migration applied.");
  await poolSecond.end();
  process.exit(0);
}

apply().catch((err) => {
  console.error("stage migration failed:", err);
  process.exit(1);
});
