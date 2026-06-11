import {
  pgTable,
  varchar,
  date,
  text,
  timestamp,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentForexCard = pgTable(
  "forex_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    forexCardStatus: varchar("forex_card_status", { length: 100 }),

    cardDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_forex_card_client_id").on(table.clientId),
    forexCardStatusIdx: index("idx_payment_forex_card_status").on(
      table.forexCardStatus
    ),
    cardDateIdx: index("idx_payment_forex_card_date").on(table.cardDate),
    createdAtIdx: index("idx_payment_forex_card_created_at").on(
      table.createdAt
    ),
  })
);
