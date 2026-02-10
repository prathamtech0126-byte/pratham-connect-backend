import {
  pgTable,
  varchar,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  index,
} from "drizzle-orm/pg-core";

export const newSell = pgTable(
  "new_sell",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    serviceName: varchar("service_name", { length: 150 }).notNull(),

    serviceInformation: text("service_information"),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    sellDate: date("date").notNull(),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    serviceNameIdx: index("idx_new_sell_service_name").on(table.serviceName),

    sellDateIdx: index("idx_new_sell_date").on(table.sellDate),

    createdAtIdx: index("idx_new_sell_created_at").on(table.createdAt),
  })
);

