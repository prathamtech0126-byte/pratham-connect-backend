import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0024: client_information.converted_lead_id...");

  await db.execute(sql`
    ALTER TABLE client_information
    ADD COLUMN IF NOT EXISTS converted_lead_id bigint REFERENCES leads(id);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_converted_lead
      ON client_information(converted_lead_id);
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_converted_lead_unique
      ON client_information(converted_lead_id)
      WHERE converted_lead_id IS NOT NULL;
  `);

  console.log("Applying migration 0024: create notifications table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id bigserial PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type varchar(64) NOT NULL,
      category varchar(32) NOT NULL DEFAULT 'system',
      priority varchar(16) NOT NULL DEFAULT 'normal',
      title varchar(255) NOT NULL,
      body text NOT NULL,
      entity_type varchar(64),
      entity_id bigint,
      action_url varchar(512),
      actor_user_id bigint REFERENCES users(id),
      scheduled_at timestamp,
      deliver_at timestamp NOT NULL DEFAULT now(),
      delivered_at timestamp,
      read_at timestamp,
      dismissed_at timestamp,
      dedupe_key varchar(128),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
      ON notifications (user_id, read_at, created_at);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_deliver_pending
      ON notifications (deliver_at, delivered_at);
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
      ON notifications (user_id, dedupe_key);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_type
      ON notifications (type);
  `);

  console.log("✓ Migration 0024 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0024 failed:", err);
  process.exit(1);
});
