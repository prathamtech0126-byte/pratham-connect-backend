import {
  bigint,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { amounts } from "./amount.schema";

export const remarks = pgTable("remarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id).notNull(),
  amountId: uuid("amount_id").references(() => amounts.id).notNull(),
  remark: varchar("remark", { length: 100 }).notNull(),
  actionBy: bigint("action_by", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (table) => ({
  clientIdIdx: index("idx_remarks_client_id").on(table.clientId),
  amountIdIdx: index("idx_remarks_amount_id").on(table.amountId),
  actionByIdx: index("idx_remarks_action_by").on(table.actionBy),
  createdAtIdx: index("idx_remarks_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_remarks_updated_at").on(table.updatedAt),
}));