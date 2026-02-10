import {
  pgTable,
  varchar,
  date,
  text,
  timestamp,
  bigserial,
  index,
} from "drizzle-orm/pg-core";

export const forexCard = pgTable(
  "forex_card",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    forexCardStatus: varchar("forex_card_status", { length: 100 }),

    cardDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    forexCardStatusIdx: index("idx_forex_card_status").on(
      table.forexCardStatus
    ),

    cardDateIdx: index("idx_forex_card_date").on(table.cardDate),

    createdAtIdx: index("idx_forex_card_created_at").on(table.createdAt),
  })
);

