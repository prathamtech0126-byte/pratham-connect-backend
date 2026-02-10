import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  index,
} from "drizzle-orm/pg-core";

export const loan = pgTable(
  "loan",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    disbursmentDate: date("disbursment_date").notNull(),

    remarks: text("remarks"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    disbursmentDateIdx: index("idx_loan_disbursment_date").on(
      table.disbursmentDate
    ),

    createdAtIdx: index("idx_loan_created_at").on(table.createdAt),
  })
);

