import { pgTable, bigserial, varchar, index } from "drizzle-orm/pg-core";

/** Fine-grained capabilities (optional matrix via `role_permissions`). */
export const permissions = pgTable(
  "permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    name: varchar("name", { length: 100 }).notNull().unique(),

    description: varchar("description", { length: 255 }),
  },
  (table) => ({
    nameIdx: index("idx_permissions_name").on(table.name),
  })
);
