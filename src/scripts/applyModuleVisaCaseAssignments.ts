import "dotenv/config";
import { poolSecond } from "../config/databaseConnectionSecond";

/**
 * Creates visa_case_assignments + assigned_user_id indexes on modules DB.
 * Safe to run multiple times (IF NOT EXISTS).
 *
 * Usage: npm run migrate:module-visa-case-assignments
 */
async function apply() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Applying modules migration: visa_case_assignments...");

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS visa_case_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visa_case_id uuid NOT NULL REFERENCES visa_cases(id),
      assigned_team visa_assigned_team_enum NOT NULL,
      assigned_user_id bigint NOT NULL,
      previous_user_id bigint,
      previous_team visa_assigned_team_enum,
      assigned_by bigint NOT NULL,
      assigned_by_role varchar(50),
      assignment_type varchar(30) NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_case_assignments_visa_case_id
      ON visa_case_assignments (visa_case_id);
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_case_assignments_assigned_user_id
      ON visa_case_assignments (assigned_user_id);
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_case_assignments_created_at
      ON visa_case_assignments (created_at);
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_cases_assigned_user_id
      ON visa_cases (assigned_user_id);
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_visa_cases_assigned_user_team
      ON visa_cases (assigned_user_id, assigned_team);
  `);

  console.log("✓ visa_case_assignments migration applied successfully.");
  await poolSecond.end();
  process.exit(0);
}

apply().catch((err) => {
  console.error("visa_case_assignments migration failed:", err);
  process.exit(1);
});
