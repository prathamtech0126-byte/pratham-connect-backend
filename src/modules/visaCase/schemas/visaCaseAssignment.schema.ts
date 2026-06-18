import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { visaAssignedTeamEnum, visaCases } from "./visaCase.schema";

/** Append-only audit log for visa case employee assignments. */
export const visaCaseAssignments = pgTable(
  "visa_case_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    visaCaseId: uuid("visa_case_id")
      .references(() => visaCases.id)
      .notNull(),

    assignedTeam: visaAssignedTeamEnum("assigned_team").notNull(),

    /** Main CRM users.id */
    assignedUserId: bigint("assigned_user_id", { mode: "number" }).notNull(),

    previousUserId: bigint("previous_user_id", { mode: "number" }),
    previousTeam: visaAssignedTeamEnum("previous_team"),

    /** Main CRM users.id */
    assignedBy: bigint("assigned_by", { mode: "number" }).notNull(),
    assignedByRole: varchar("assigned_by_role", { length: 50 }),

    assignmentType: varchar("assignment_type", { length: 30 }).notNull(),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    visaCaseIdIdx: index("idx_visa_case_assignments_visa_case_id").on(
      table.visaCaseId
    ),
    assignedUserIdIdx: index("idx_visa_case_assignments_assigned_user_id").on(
      table.assignedUserId
    ),
    createdAtIdx: index("idx_visa_case_assignments_created_at").on(
      table.createdAt
    ),
  })
);
