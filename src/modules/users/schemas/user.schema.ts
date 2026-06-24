import {
  pgTable,
  varchar,
  timestamp,
  boolean,
  index,
  AnyPgColumn,
  uuid,
  text,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { roles } from "./role.schema";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** Maps to main CRM `users.id` (bigint) after migration. */
    legacyUserId: bigint("legacy_user_id", { mode: "number" }).unique(),

    departmentId: uuid("department_id"),
    branchId: uuid("branch_id"),
    teamId: uuid("team_id"),

    roleId: uuid("role_id").references(() => roles.id),

    managerId: uuid("manager_id").references((): AnyPgColumn => users.id),

    empId: varchar("emp_id", { length: 50 }).unique(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    email: varchar("email", { length: 150 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),

    officePhone: varchar("office_phone", { length: 15 }),
    personalPhone: varchar("personal_phone", { length: 15 }).unique(),
    designation: varchar("designation", { length: 100 }),

    isSupervisor: boolean("is_supervisor").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => ({
    legacyUserIdIdx: index("idx_users_legacy_user_id").on(table.legacyUserId),
    departmentIdx: index("idx_users_department_id").on(table.departmentId),
    branchIdx: index("idx_users_branch_id").on(table.branchId),
    teamIdx: index("idx_users_team_id").on(table.teamId),
    roleIdx: index("idx_users_role_id").on(table.roleId),
    managerIdx: index("idx_users_manager_id").on(table.managerId),
    emailIdx: index("idx_users_email").on(table.email),
    empIdIdx: index("idx_users_emp_id").on(table.empId),
    isActiveIdx: index("idx_users_is_active").on(table.isActive),
    supervisorIdx: index("idx_users_is_supervisor").on(table.isSupervisor),
  })
);
