import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

export const forexSideEnum = pgEnum("forex_side_enum", ["PI", "TP"]);

export const forexFees = pgTable(
  "forex_fees",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    side: forexSideEnum("side").notNull(),

    feeDate: date("date"),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sideIdx: index("idx_forex_fees_side").on(table.side),

    feeDateIdx: index("idx_forex_fees_date").on(table.feeDate),

    createdAtIdx: index("idx_forex_fees_created_at").on(table.createdAt),
  })
);

