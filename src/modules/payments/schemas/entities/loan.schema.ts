import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentLoan = pgTable(
  "loan",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    disbursmentDate: date("disbursment_date").notNull(),

    remarks: text("remarks"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_loan_client_id").on(table.clientId),
    disbursmentDateIdx: index("idx_payment_loan_disbursment_date").on(
      table.disbursmentDate
    ),
    createdAtIdx: index("idx_payment_loan_created_at").on(table.createdAt),
  })
);
