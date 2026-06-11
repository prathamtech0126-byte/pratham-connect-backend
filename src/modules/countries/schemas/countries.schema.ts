import { pgTable, varchar, timestamp, index, uuid, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const countries = pgTable("countries", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  isoCode: varchar("iso_code", { length: 10 }).notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_countries_id").on(table.id),
  nameIdx: index("idx_countries_name").on(table.name),
  isoCodeIdx: index("idx_countries_iso_code").on(table.isoCode),
  isActiveIdx: index("idx_countries_is_active").on(table.isActive),
  createdAtIdx: index("idx_countries_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_countries_updated_at").on(table.updatedAt),
}));