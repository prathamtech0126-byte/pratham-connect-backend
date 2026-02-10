import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  index,
} from "drizzle-orm/pg-core";

export const beaconAccount = pgTable(
  "beacon_account",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    openingDate: date("opening_date"),
    fundingDate: date("funding_date"),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    openingDateIdx: index("idx_beacon_account_opening_date").on(table.openingDate),
    fundingDateIdx: index("idx_beacon_account_funding_date").on(table.fundingDate),
    createdAtIdx: index("idx_beacon_account_created_at").on(table.createdAt),
  })
);

