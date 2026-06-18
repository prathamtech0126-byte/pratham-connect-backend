import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  visaCases,
  visaProcessingStageEnum,
  visaProcessingSubStatusEnum,
} from "./visaCase.schema";

/** Immutable audit log for visa case stage / sub-status changes. */
export const visaCaseStatusEvents = pgTable(
  "visa_case_status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    visaCaseId: uuid("visa_case_id")
      .references(() => visaCases.id)
      .notNull(),

    fromStage: visaProcessingStageEnum("from_stage"),
    toStage: visaProcessingStageEnum("to_stage"),

    fromSubStatus: visaProcessingSubStatusEnum("from_sub_status"),
    toSubStatus: visaProcessingSubStatusEnum("to_sub_status").notNull(),

    /** Main CRM users.id */
    changedBy: bigint("changed_by", { mode: "number" }).notNull(),
    changedByRole: varchar("changed_by_role", { length: 50 }),

    notes: text("notes"),

    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    visaCaseIdIdx: index("idx_visa_case_status_events_visa_case_id").on(
      table.visaCaseId
    ),
    changedAtIdx: index("idx_visa_case_status_events_changed_at").on(
      table.changedAt
    ),
    changedByIdx: index("idx_visa_case_status_events_changed_by").on(
      table.changedBy
    ),
  })
);
