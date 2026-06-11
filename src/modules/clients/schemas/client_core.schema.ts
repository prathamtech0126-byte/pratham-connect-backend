import { pgTable, text, uuid, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { clients } from "./client_convert.schema";
import { sql } from "drizzle-orm";

export const coreTypeEnum = pgEnum("core_type", [
  "core",
  "non-core",
]);

export const clientCore = pgTable("client_core_modules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: uuid("client_id").references(() => clients.id).notNull(),
  coreType: coreTypeEnum("core_type").notNull().default("core"),
  coreValue: text("core_value").notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_client_core_id").on(table.id),
  clientIdIdx: index("idx_client_core_client_id").on(table.clientId),
  coreTypeIdx: index("idx_client_core_core_type").on(table.coreType),
  coreValueIdx: index("idx_client_core_core_value").on(table.coreValue),
  createdAtIdx: index("idx_client_core_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_client_core_updated_at").on(table.updatedAt),
}));

