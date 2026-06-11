import {
  bigint,
  date,
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { amounts } from "./amount.schema";

export const dates = pgTable(
  "dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    amountId: uuid("amount_id")
      .references(() => amounts.id)
      .notNull(),
    /** Main CRM client_payment.id — migration idempotency */
    legacyClientPaymentId: bigint("legacy_client_payment_id", {
      mode: "number",
    }).unique(),
    date: date("date").notNull(),
    actionBy: bigint("action_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: index("idx_dates_client_id").on(table.clientId),
    amountIdIdx: index("idx_dates_amount_id").on(table.amountId),
    legacyPaymentIdx: index("idx_dates_legacy_client_payment_id").on(
      table.legacyClientPaymentId
    ),
    dateIdx: index("idx_dates_date").on(table.date),
    actionByIdx: index("idx_dates_action_by").on(table.actionBy),
    createdAtIdx: index("idx_dates_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_dates_updated_at").on(table.updatedAt),
  })
);
