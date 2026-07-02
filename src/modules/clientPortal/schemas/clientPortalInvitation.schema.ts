import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";
import { clientPortalAccounts } from "./clientPortalAccount.schema";

export const clientPortalInvitations = pgTable(
  "client_portal_invitations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),

    accountId: bigint("account_id", { mode: "number" }).references(
      () => clientPortalAccounts.id,
      { onDelete: "set null" }
    ),

    sentByUserId: bigint("sent_by_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),

    deliveryEmail: varchar("delivery_email", { length: 150 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("sent"),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index("idx_client_portal_invitations_client").on(table.clientId),
    accountIdx: index("idx_client_portal_invitations_account").on(table.accountId),
    createdIdx: index("idx_client_portal_invitations_created").on(table.createdAt),
  })
);
