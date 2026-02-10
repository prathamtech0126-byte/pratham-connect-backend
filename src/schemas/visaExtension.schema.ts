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

export const visaExtension = pgTable(
  "visa_extension",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    type: varchar("type", { length: 100 }).notNull(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    extensionDate: date("date").notNull(),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    extensionDateIdx: index("idx_visa_extension_date").on(table.extensionDate),

    createdAtIdx: index("idx_visa_extension_created_at").on(table.createdAt),
  })
);

