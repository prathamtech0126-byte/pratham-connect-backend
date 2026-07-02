import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

/**
 * Creates client portal tables for invitation + login.
 */
async function apply() {
  console.log("Applying migration: client portal tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_accounts (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL UNIQUE REFERENCES client_information(id) ON DELETE CASCADE,
      username VARCHAR(150) NOT NULL UNIQUE,
      email VARCHAR(150) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      invited_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      invited_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_client
      ON client_portal_accounts(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_username
      ON client_portal_accounts(username);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_email
      ON client_portal_accounts(email);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_status
      ON client_portal_accounts(status);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_invitations (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES client_information(id) ON DELETE CASCADE,
      account_id BIGINT REFERENCES client_portal_accounts(id) ON DELETE SET NULL,
      sent_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      delivery_email VARCHAR(150) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'sent',
      failure_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_invitations_client
      ON client_portal_invitations(client_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_invitations_account
      ON client_portal_invitations(account_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_invitations_created
      ON client_portal_invitations(created_at);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_portal_refresh_tokens (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES client_portal_accounts(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_refresh_tokens_account
      ON client_portal_refresh_tokens(account_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_client_portal_refresh_tokens_expires
      ON client_portal_refresh_tokens(expires_at);
  `);

  console.log("✓ Client portal migration applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Client portal migration failed:", err);
  process.exit(1);
});
