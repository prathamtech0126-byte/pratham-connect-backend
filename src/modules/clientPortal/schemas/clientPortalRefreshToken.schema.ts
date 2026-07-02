import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { clientPortalAccounts } from "./clientPortalAccount.schema";

export const clientPortalRefreshTokens = pgTable(
  "client_portal_refresh_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    accountId: bigint("account_id", { mode: "number" })
      .references(() => clientPortalAccounts.id, { onDelete: "cascade" })
      .notNull(),

    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked: boolean("revoked").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    accountIdx: index("idx_client_portal_refresh_tokens_account").on(table.accountId),
    expiresIdx: index("idx_client_portal_refresh_tokens_expires").on(table.expiresAt),
  })
);
