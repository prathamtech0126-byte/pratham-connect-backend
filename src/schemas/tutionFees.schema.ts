import {
  pgTable,
  date,
  text,
  timestamp,
  bigserial,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const tutionFeesStatusEnum = pgEnum("tution_fees_status_enum", [
  "paid",
  "pending",
]);

export const tutionFees = pgTable(
  "tution_fees",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    tutionFeesStatus: tutionFeesStatusEnum("tution_fees_status").notNull(),

    feeDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    tutionFeesStatusIdx: index("idx_tution_fees_status").on(
      table.tutionFeesStatus
    ),

    feeDateIdx: index("idx_tution_fees_date").on(table.feeDate),

    createdAtIdx: index("idx_tution_fees_created_at").on(table.createdAt),
  })
);

