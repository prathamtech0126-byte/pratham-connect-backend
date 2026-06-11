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
import { sql } from "drizzle-orm";
import { branches } from "./branch.schema";
import { users } from "./user.schema";
import { departments } from "./department.schema";

export const teams = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    departmentId: uuid("department_id").references(() => departments.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    teamLeadId: uuid("team_lead_id").references((): AnyPgColumn => users.id),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_teams_id").on(table.id),
    branchIdIdx: index("idx_teams_branch_id").on(table.branchId),
    departmentIdIdx: index("idx_teams_department_id").on(table.departmentId),
    teamLeadIdIdx: index("idx_teams_team_lead_id").on(table.teamLeadId),
    createdAtIdx: index("idx_teams_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_teams_updated_at").on(table.updatedAt),
  })
);
