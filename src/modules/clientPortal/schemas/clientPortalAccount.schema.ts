import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";

export const clientPortalAccounts = pgTable(
  "client_portal_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull()
      .unique(),

    username: varchar("username", { length: 150 }).notNull().unique(),
    email: varchar("email", { length: 150 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),

    status: varchar("status", { length: 20 }).notNull().default("pending"),
    mustChangePassword: boolean("must_change_password").default(true).notNull(),

    invitedByUserId: bigint("invited_by_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index("idx_client_portal_accounts_client").on(table.clientId),
    usernameIdx: index("idx_client_portal_accounts_username").on(table.username),
    emailIdx: index("idx_client_portal_accounts_email").on(table.email),
    statusIdx: index("idx_client_portal_accounts_status").on(table.status),
  })
);
