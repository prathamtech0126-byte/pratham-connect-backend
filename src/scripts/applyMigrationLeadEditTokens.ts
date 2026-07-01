import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

/**
 * Creates lead_edit_tokens for front-desk issued client self-edit links.
 */
async function apply() {
  console.log("Applying migration: lead_edit_tokens table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lead_edit_tokens (
      id BIGSERIAL PRIMARY KEY,
      lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_lead_edit_tokens_lead ON lead_edit_tokens(lead_id);
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_lead_edit_tokens_expires ON lead_edit_tokens(expires_at);
  `);

  console.log("✓ lead_edit_tokens migration applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("lead_edit_tokens migration failed:", err);
  process.exit(1);
});
