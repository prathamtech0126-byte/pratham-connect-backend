import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0022: student_application table...");

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE student_application_status AS ENUM (
        'app_submitted',
        'offer_received',
        'cas_received',
        'visa_submitted'
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS student_application (
      id bigserial PRIMARY KEY,
      client_id bigint NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      sale_type_id bigint NOT NULL REFERENCES sale_type(id) ON DELETE RESTRICT,
      counsellor_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      university_name varchar(255) NOT NULL,
      course_name varchar(500),
      country varchar(100),
      status student_application_status NOT NULL DEFAULT 'app_submitted',
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_student_application_client ON student_application(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_student_application_counsellor ON student_application(counsellor_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_student_application_status ON student_application(status);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_student_application_sale_type ON student_application(sale_type_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_student_application_client_created
      ON student_application(client_id, created_at);
  `);

  console.log("✓ Migration 0022 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0022 failed:", err);
  process.exit(1);
});
