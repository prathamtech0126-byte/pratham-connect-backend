import {
  pgTable,
  varchar,
  timestamp,
  index,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  AnyPgColumn,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** Maps to main CRM `roles.id` (bigint) after migration. */
    legacyRoleId: bigint("legacy_role_id", { mode: "number" }).unique(),

    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    level: integer("level").default(0).notNull(),
    parentRoleId: uuid("parent_role_id").references((): AnyPgColumn => roles.id),
    permissions: jsonb("permissions").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    nameIdx: index("idx_roles_name").on(table.name),
    levelIdx: index("idx_roles_level").on(table.level),
    parentRoleIdIdx: index("idx_roles_parent_role_id").on(table.parentRoleId),
    isActiveIdx: index("idx_roles_is_active").on(table.isActive),
    legacyRoleIdIdx: index("idx_roles_legacy_role_id").on(table.legacyRoleId),
  })
);
