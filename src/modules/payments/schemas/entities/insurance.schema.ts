import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  index,
  varchar,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentInsurance = pgTable(
  "insurance",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    policyNumber: varchar("policy_number", { length: 50 }).unique(),

    insuranceDate: date("date").notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_insurance_client_id").on(table.clientId),
    insuranceDateIdx: index("idx_payment_insurance_date").on(
      table.insuranceDate
    ),
    createdAtIdx: index("idx_payment_insurance_created_at").on(
      table.createdAt
    ),
  })
);
