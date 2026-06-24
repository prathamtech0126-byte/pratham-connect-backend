import {
  pgTable,
  varchar,
  decimal,
  date,
  text,
  timestamp,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentNewSell = pgTable(
  "new_sell",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    serviceName: varchar("service_name", { length: 150 }).notNull(),

    serviceInformation: text("service_information"),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    sellDate: date("date").notNull(),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_new_sell_client_id").on(table.clientId),
    serviceNameIdx: index("idx_payment_new_sell_service_name").on(
      table.serviceName
    ),
    sellDateIdx: index("idx_payment_new_sell_date").on(table.sellDate),
    createdAtIdx: index("idx_payment_new_sell_created_at").on(table.createdAt),
  })
);
