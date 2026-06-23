import {
  pgTable,
  bigserial,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/** Canonical application roles (aligned with `src/types/role.ts` / `users.role`). */
export const roles = pgTable(
  "roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    name: varchar("name", { length: 50 }).notNull().unique(),

    description: varchar("description", { length: 255 }),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    nameIdx: index("idx_roles_name").on(table.name),
  })
);
