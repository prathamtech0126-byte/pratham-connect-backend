// import {
//   pgTable,
//   bigserial,
//   bigint,
//   varchar,
//   timestamp,
// } from "drizzle-orm/pg-core";
// import { AnyPgColumn } from "drizzle-orm/pg-core";

// export const users = pgTable("users", {
//   id: bigserial("id", { mode: "number" }).primaryKey(),
//   emp_id: varchar("emp_id", { length: 50 }).unique(),
//   fullName: varchar("full_name", { length: 100 }).notNull(),
//   email: varchar("email", { length: 150 }).notNull().unique(),
//   passwordHash: varchar("password_hash", { length: 255 }).notNull(),
//   role: varchar("role", { length: 50 }).notNull(),
//   managerId: bigint("manager_id", { mode: "number" })
//     .references((): AnyPgColumn => users.id), // ✅ nullable by default
//   officePhone: varchar("office_phone", { length: 10 }).unique(),
//   personalPhone: varchar("personal_phone", { length: 10 }).unique(),
//   designation: varchar("designation", { length: 100 }),
//   createdAt: timestamp("created_at").defaultNow(),
// });
import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  boolean,
  index,
  AnyPgColumn,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    emp_id: varchar("emp_id", { length: 50 }).unique(),

    fullName: varchar("full_name", { length: 100 }).notNull(),

    email: varchar("email", { length: 150 }).notNull().unique(),

    passwordHash: varchar("password_hash", { length: 255 }).notNull(),

    role: varchar("role", { length: 50 }).notNull(),

    managerId: bigint("manager_id", { mode: "number" })
      .references((): AnyPgColumn => users.id), // ✅ nullable by default

    officePhone: varchar("office_phone", { length: 10 }).unique(),

    personalPhone: varchar("personal_phone", { length: 10 }).unique(),

    designation: varchar("designation", { length: 100 }),

    isSupervisor: boolean("is_supervisor").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    roleIdx: index("idx_users_role").on(table.role),
                
    managerIdx: index("idx_users_manager").on(table.managerId),

    createdAtIdx: index("idx_users_created_at").on(table.createdAt),

    roleManagerIdx: index("idx_users_role_manager").on(
      table.role,
      table.managerId
    ),
  })
);
