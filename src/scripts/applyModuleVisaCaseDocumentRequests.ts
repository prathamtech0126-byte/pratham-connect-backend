import "dotenv/config";
import { poolSecond } from "../config/databaseConnectionSecond";

/**
 * Creates visa_case_document_requests table for per-client doc requests.
 * Safe to run multiple times (IF NOT EXISTS).
 * Upgrades legacy person_id column to client_id when present.
 *
 * Usage: npm run migrate:module-visa-case-document-requests
 */
async function apply() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Applying modules migration: visa_case_document_requests...");

  await poolSecond.query(`
    DO $$
    BEGIN
      CREATE TYPE visa_document_request_status_enum AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS visa_case_document_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visa_case_id uuid NOT NULL REFERENCES visa_cases(id),
      client_id uuid REFERENCES clients(id),
      person_label varchar(150) NOT NULL,
      document_type varchar(120) NOT NULL,
      notes text,
      request_status visa_document_request_status_enum NOT NULL DEFAULT 'OPEN',
      raised_by bigint NOT NULL,
      raised_by_role varchar(50),
      target_team visa_assigned_team_enum NOT NULL DEFAULT 'cx',
      source_stage visa_processing_stage_enum NOT NULL,
      source_sub_status visa_processing_sub_status_enum NOT NULL,
      source_team visa_assigned_team_enum NOT NULL,
      fulfilled_by bigint,
      fulfilled_at timestamptz,
      fulfilment_notes text,
      cancelled_by bigint,
      cancelled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visa_case_document_requests'
          AND column_name = 'person_id'
      ) THEN
        ALTER TABLE visa_case_document_requests
          ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);

        UPDATE visa_case_document_requests dr
        SET client_id = c.id
        FROM clients c
        WHERE dr.client_id IS NULL
          AND dr.person_id IS NOT NULL
          AND c.person_id = dr.person_id;

        ALTER TABLE visa_case_document_requests DROP COLUMN person_id;
        DROP INDEX IF EXISTS idx_visa_doc_requests_person_id;
      END IF;
    END $$;
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_doc_requests_visa_case_id
      ON visa_case_document_requests (visa_case_id);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_doc_requests_status
      ON visa_case_document_requests (request_status);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_doc_requests_client_id
      ON visa_case_document_requests (client_id);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_doc_requests_created_at
      ON visa_case_document_requests (created_at);
  `);

  console.log("✓ visa_case_document_requests migration applied successfully.");
  await poolSecond.end();
  process.exit(0);
}

apply().catch((err) => {
  console.error("visa_case_document_requests migration failed:", err);
  process.exit(1);
});
