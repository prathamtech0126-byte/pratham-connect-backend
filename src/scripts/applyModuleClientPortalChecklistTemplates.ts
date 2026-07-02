import "dotenv/config";
import { poolSecond } from "../config/databaseConnectionSecond";

async function apply() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Applying modules migration: client portal checklist templates...");

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS client_portal_checklists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title varchar(255) NOT NULL,
      slug varchar(255) NOT NULL UNIQUE,
      visa_type varchar(50) NOT NULL,
      country varchar(100) NOT NULL,
      description text,
      display_order integer DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklists_slug
      ON client_portal_checklists(slug);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklists_visa_type
      ON client_portal_checklists(visa_type);
  `);
  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklists_country
      ON client_portal_checklists(country);
  `);

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS client_portal_checklist_sections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      checklist_id uuid NOT NULL REFERENCES client_portal_checklists(id) ON DELETE CASCADE,
      title varchar(255) NOT NULL,
      description text,
      display_order integer DEFAULT 0,
      is_conditional boolean NOT NULL DEFAULT false,
      condition_text text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_sections_checklist
      ON client_portal_checklist_sections(checklist_id);
  `);

  await poolSecond.query(`
    CREATE TABLE IF NOT EXISTS client_portal_checklist_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      section_id uuid NOT NULL REFERENCES client_portal_checklist_sections(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      notes text,
      is_mandatory boolean NOT NULL DEFAULT true,
      is_conditional boolean NOT NULL DEFAULT false,
      condition_text varchar(255),
      quantity_note varchar(100),
      display_order integer DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await poolSecond.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_items_section
      ON client_portal_checklist_items(section_id);
  `);

  console.log("✓ client portal checklist template tables migration applied.");
  await poolSecond.end();
  process.exit(0);
}

apply().catch((err) => {
  console.error("client portal checklist templates migration failed:", err);
  process.exit(1);
});
