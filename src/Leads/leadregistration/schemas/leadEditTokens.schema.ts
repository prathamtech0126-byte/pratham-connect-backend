import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";
import { users } from "../../../schemas/users.schema";

export const leadEditTokens = pgTable(
  "lead_edit_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    leadId: bigint("lead_id", { mode: "number" })
      .references(() => leads.id, { onDelete: "cascade" })
      .notNull(),

    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),

    createdByUserId: bigint("created_by_user_id", { mode: "number" })
      .references(() => users.id, { onDelete: "set null" }),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked: boolean("revoked").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("idx_lead_edit_tokens_lead").on(table.leadId),
    expiresIdx: index("idx_lead_edit_tokens_expires").on(table.expiresAt),
  })
);
