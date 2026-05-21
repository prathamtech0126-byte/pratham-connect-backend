import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  boolean,
  date,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";

export const leadStudentProfiles = pgTable(
  "lead_student_profiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    leadId: bigint("lead_id", { mode: "number" })
      .references(() => leads.id, { onDelete: "cascade" })
      .notNull(),

    gender: varchar("gender", { length: 20 }),
    dateOfBirth: date("date_of_birth"),
    alternatePhone: varchar("alternate_phone", { length: 30 }),

    hasPassport: boolean("has_passport").default(false),
    passportNumber: varchar("passport_number", { length: 50 }),
    passportExpiryDate: date("passport_expiry_date"),

    languageExamGiven: boolean("language_exam_given").default(false),
    visaRefusalDetails: text("visa_refusal_details"),
    preferredCountry: varchar("preferred_country", { length: 100 }),
    fieldOfInterest: varchar("field_of_interest", { length: 150 }),

    sourceReferenceId: varchar("source_reference_id", { length: 100 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("idx_student_profiles_lead").on(table.leadId),
  })
);
