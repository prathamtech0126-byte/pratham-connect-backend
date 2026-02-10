import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  index,
  varchar,
} from "drizzle-orm/pg-core";

export const insurance = pgTable(
  "insurance",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    policyNumber: varchar("policy_number", { length: 50 }).unique(),

    insuranceDate: date("date").notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    insuranceDateIdx: index("idx_insurance_date").on(table.insuranceDate),

    createdAtIdx: index("idx_insurance_created_at").on(table.createdAt),
  })
);

