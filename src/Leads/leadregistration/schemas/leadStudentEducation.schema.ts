import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";

export const leadStudentEducation = pgTable(
  "lead_student_education",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    leadId: bigint("lead_id", { mode: "number" })
      .references(() => leads.id, { onDelete: "cascade" })
      .notNull(),

    educationLevel: varchar("education_level", { length: 50 }),
    schoolName: varchar("school_name", { length: 200 }),
    specialization: varchar("specialization", { length: 200 }),
    yearOfCompletion: integer("year_of_completion"),
    percentageOrCgpa: varchar("percentage_or_cgpa", { length: 30 }),
    numberOfBacklogs: integer("number_of_backlogs").default(0),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("idx_student_education_lead").on(table.leadId),
  })
);
