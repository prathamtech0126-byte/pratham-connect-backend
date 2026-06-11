import { pgTable, timestamp, index, uuid, text, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./client_convert.schema";
import { remarks } from "../../payments/schemas/remark.schema";

export const clientTransfer = pgTable(
  "client_transfer_modules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    /** Main CRM `users.id` (bigint) — no FK */
    fromUserId: bigint("from_user_id", { mode: "number" }),
    toUserId: bigint("to_user_id", { mode: "number" }),
    transferredBy: bigint("transferred_by", { mode: "number" }),
    remarkId: uuid("remark_id").references(() => remarks.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_client_transfer_id").on(table.id),
    clientIdIdx: index("idx_client_transfer_client_id").on(table.clientId),
    fromUserIdIdx: index("idx_client_transfer_from_user_id").on(
      table.fromUserId
    ),
    toUserIdIdx: index("idx_client_transfer_to_user_id").on(table.toUserId),
    transferredByIdx: index("idx_client_transfer_transferred_by").on(
      table.transferredBy
    ),
    createdAtIdx: index("idx_client_transfer_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_client_transfer_updated_at").on(table.updatedAt),
  })
);
