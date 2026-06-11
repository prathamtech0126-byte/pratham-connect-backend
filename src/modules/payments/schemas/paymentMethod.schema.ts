import { bigint, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  actionBy: bigint("action_by", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (table) => ({
  nameIdx: index("idx_payment_methods_name").on(table.name),
  createdAtIdx: index("idx_payment_methods_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_payment_methods_updated_at").on(table.updatedAt),
}));