import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  pgEnum,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentForexSideEnum = pgEnum("forex_side_enum", ["PI", "TP"]);

export const paymentForexFees = pgTable(
  "forex_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    side: paymentForexSideEnum("side").notNull(),

    feeDate: date("date"),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_forex_fees_client_id").on(table.clientId),
    sideIdx: index("idx_payment_forex_fees_side").on(table.side),
    feeDateIdx: index("idx_payment_forex_fees_date").on(table.feeDate),
    createdAtIdx: index("idx_payment_forex_fees_created_at").on(
      table.createdAt
    ),
  })
);
