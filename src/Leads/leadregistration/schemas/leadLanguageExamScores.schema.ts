import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";

export const leadLanguageExamScores = pgTable(
  "lead_language_exam_scores",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    leadId: bigint("lead_id", { mode: "number" })
      .references(() => leads.id, { onDelete: "cascade" })
      .notNull(),

    examType: varchar("exam_type", { length: 30 }),
    listening: numeric("listening", { precision: 4, scale: 1 }),
    reading: numeric("reading", { precision: 4, scale: 1 }),
    writing: numeric("writing", { precision: 4, scale: 1 }),
    speaking: numeric("speaking", { precision: 4, scale: 1 }),
    overallBand: numeric("overall_band", { precision: 4, scale: 1 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("idx_exam_scores_lead").on(table.leadId),
  })
);
