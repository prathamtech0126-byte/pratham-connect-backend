import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration: client portal checklist upload tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_checklist_assignments (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      checklist_id UUID NOT NULL,
      visa_type VARCHAR(50) NOT NULL,
      country VARCHAR(100) NOT NULL,
      folder_path VARCHAR(350) NOT NULL,
      workdrive_folder_id VARCHAR(150),
      assigned_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_assignments_client
      ON client_portal_checklist_assignments(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_assignments_checklist
      ON client_portal_checklist_assignments(checklist_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_assignments_status
      ON client_portal_checklist_assignments(status);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_storage_usage (
      client_id BIGINT PRIMARY KEY REFERENCES client_information(id) ON DELETE CASCADE,
      quota_bytes BIGINT NOT NULL,
      used_bytes BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_storage_usage_quota
      ON client_portal_storage_usage(quota_bytes);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_checklist_uploads (
      id BIGSERIAL PRIMARY KEY,
      assignment_id BIGINT NOT NULL REFERENCES client_portal_checklist_assignments(id) ON DELETE CASCADE,
      checklist_item_id UUID NOT NULL,
      client_id BIGINT NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_extension VARCHAR(20),
      size_bytes BIGINT NOT NULL,
      workdrive_file_id VARCHAR(150) NOT NULL,
      workdrive_folder_id VARCHAR(150),
      workdrive_permalink TEXT,
      uploaded_by_account_id BIGINT REFERENCES client_portal_accounts(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE client_portal_checklist_assignments
    DROP CONSTRAINT IF EXISTS client_portal_checklist_assignments_checklist_id_checklists_id_fk;
  `);
  await db.execute(sql`
    ALTER TABLE client_portal_checklist_uploads
    DROP CONSTRAINT IF EXISTS client_portal_checklist_uploads_checklist_item_id_document_items_id_fk;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_uploads_assignment
      ON client_portal_checklist_uploads(assignment_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_uploads_item
      ON client_portal_checklist_uploads(checklist_item_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_uploads_client
      ON client_portal_checklist_uploads(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_uploads_uploaded_at
      ON client_portal_checklist_uploads(uploaded_at);
  `);

  await db.execute(sql`
    ALTER TABLE client_portal_checklist_uploads
    ADD COLUMN IF NOT EXISTS uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_uploads_staff_user
      ON client_portal_checklist_uploads(uploaded_by_user_id);
  `);

  await db.execute(sql`
    INSERT INTO client_portal_storage_usage (client_id, quota_bytes, used_bytes, updated_at)
    SELECT ci.id, ${Number(process.env.CLIENT_STORAGE_QUOTA_BYTES?.trim() || "2147483648")}, 0, now()
    FROM client_information ci
    ON CONFLICT (client_id) DO NOTHING;
  `);

  console.log("✓ Client portal checklist upload migration applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Client portal checklist migration failed:", err);
  process.exit(1);
});
