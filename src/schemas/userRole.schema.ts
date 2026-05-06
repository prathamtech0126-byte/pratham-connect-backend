import {
  pgTable,
  bigint,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { roles } from "./role.schema";

/**
 * Mirrors `users.role` as the primary assignment today (one row per user).
 * Keeps the door open for multiple roles later without changing `users.role` yet.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
    userIdx: index("idx_user_roles_user_id").on(table.userId),
    roleIdx: index("idx_user_roles_role_id").on(table.roleId),
  })
);
