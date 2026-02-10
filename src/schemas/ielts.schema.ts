import {
  pgTable,
  varchar,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const ielts = pgTable(
  "ielts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    enrolledStatus: boolean("enrolled_status").default(false),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    enrollmentDate: date("date"),

    remarks: text("remarks"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    enrolledStatusIdx: index("idx_ielts_enrolled_status").on(
      table.enrolledStatus
    ),

    enrollmentDateIdx: index("idx_ielts_date").on(table.enrollmentDate),

    createdAtIdx: index("idx_ielts_created_at").on(table.createdAt),
  })
);

