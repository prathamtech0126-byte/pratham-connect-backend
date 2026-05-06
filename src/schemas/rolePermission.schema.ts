import {
  pgTable,
  bigint,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { roles } from "./role.schema";
import { permissions } from "./permission.schema";

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),

    permissionId: bigint("permission_id", { mode: "number" })
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
    roleIdx: index("idx_role_permissions_role_id").on(table.roleId),
    permissionIdx: index("idx_role_permissions_permission_id").on(
      table.permissionId
    ),
  })
);
