import {
  pgTable,
  varchar,
  timestamp,
  index,
  uuid,
  boolean,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { departments } from "./department.schema";
import { users } from "./user.schema";

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    departmentId: uuid("department_id").references(() => departments.id),
    name: varchar("name", { length: 100 }).notNull(),
    location: varchar("location", { length: 100 }),
    phone: varchar("phone", { length: 15 }),
    email: varchar("email", { length: 100 }),
    managerId: uuid("manager_id").references((): AnyPgColumn => users.id),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_branches_id").on(table.id),
    nameIdx: index("idx_branches_name").on(table.name),
    departmentIdIdx: index("idx_branches_department_id").on(table.departmentId),
    isActiveIdx: index("idx_branches_is_active").on(table.isActive),
    createdAtIdx: index("idx_branches_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_branches_updated_at").on(table.updatedAt),
  })
);
