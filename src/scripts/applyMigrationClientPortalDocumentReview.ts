import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration: client portal document review tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_checklist_item_status (
      id BIGSERIAL PRIMARY KEY,
      assignment_id BIGINT NOT NULL REFERENCES client_portal_checklist_assignments(id) ON DELETE CASCADE,
      checklist_item_id UUID NOT NULL,
      client_id BIGINT NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'under_review',
      latest_upload_id BIGINT REFERENCES client_portal_checklist_uploads(id) ON DELETE SET NULL,
      reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      rejection_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (assignment_id, checklist_item_id)
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_item_status_client
      ON client_portal_checklist_item_status(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_item_status_status
      ON client_portal_checklist_item_status(status);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_checklist_item_status_updated
      ON client_portal_checklist_item_status(updated_at);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_document_review_events (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      assignment_id BIGINT NOT NULL REFERENCES client_portal_checklist_assignments(id) ON DELETE CASCADE,
      checklist_item_id UUID NOT NULL,
      upload_id BIGINT REFERENCES client_portal_checklist_uploads(id) ON DELETE SET NULL,
      event_type VARCHAR(20) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      file_name VARCHAR(255),
      rejection_reason TEXT,
      actor_type VARCHAR(10) NOT NULL,
      actor_account_id BIGINT REFERENCES client_portal_accounts(id) ON DELETE SET NULL,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_document_review_events_client
      ON client_portal_document_review_events(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_document_review_events_assignment
      ON client_portal_document_review_events(assignment_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_document_review_events_created
      ON client_portal_document_review_events(created_at);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_document_review_events_type
      ON client_portal_document_review_events(event_type);
  `);

  // Backfill status rows for existing uploads (latest upload per item → under_review).
  await db.execute(sql`
    INSERT INTO client_portal_checklist_item_status (
      assignment_id,
      checklist_item_id,
      client_id,
      status,
      latest_upload_id,
      updated_at
    )
    SELECT DISTINCT ON (u.assignment_id, u.checklist_item_id)
      u.assignment_id,
      u.checklist_item_id,
      u.client_id,
      'under_review',
      u.id,
      u.uploaded_at
    FROM client_portal_checklist_uploads u
    ORDER BY u.assignment_id, u.checklist_item_id, u.uploaded_at DESC
    ON CONFLICT (assignment_id, checklist_item_id) DO NOTHING;
  `);

  console.log("✓ Client portal document review migration applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Client portal document review migration failed:", err);
  process.exit(1);
});
