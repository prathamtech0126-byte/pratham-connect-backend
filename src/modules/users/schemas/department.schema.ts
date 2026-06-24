import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  timestamp,
  index,
  uuid,
  text,
  boolean,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./user.schema";

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    managerId: uuid("manager_id").references((): AnyPgColumn => users.id),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_departments_id").on(table.id),
    nameIdx: index("idx_departments_name").on(table.name),
    createdAtIdx: index("idx_departments_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_departments_updated_at").on(table.updatedAt),
  })
);
