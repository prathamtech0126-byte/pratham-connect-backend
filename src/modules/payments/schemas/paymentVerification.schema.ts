import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
  bigint,
} from "drizzle-orm/pg-core";
import { amounts } from "./amount.schema";
import { paymentMethods } from "./paymentMethod.schema";
import { invoices } from "./invoice.schema";

/**
 * How this payment was processed: proforma issued per installment,
 * paid issued on completion, etc.
 * Mirrors invoice_status_enum — kept separate to avoid a cross-import cycle
 * between payment_modes and invoices.
 */
export const paymentModeInvoiceTypeEnum = pgEnum("payment_mode_invoice_type_enum", [
  "PROFORMA",   // issued for each partial/installment payment
  "PAID",       // issued when payment is fully settled
  "PENDING",
  "CANCELLED",
  "REFUNDED",
  "FAILED",
  "EXPIRED",
]);

export const paymentModes = pgTable(
  "payment_modes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    amountId: uuid("amount_id")
      .references(() => amounts.id)
      .notNull(),

    /** Invoice generated for this payment mode entry */
    invoiceId: uuid("invoice_id")
      .references(() => invoices.id),

    paymentCurrency: varchar("payment_currency", { length: 10 }).notNull(),

    /** Exchange rate at time of payment (1 for INR) */
    currentRate: numeric("current_rate", { precision: 12, scale: 6 })
      .default("1")
      .notNull(),

    paymentMethodId: uuid("payment_method_id")
      .references(() => paymentMethods.id)
      .notNull(),

    invoiceType: paymentModeInvoiceTypeEnum("invoice_type").notNull(),

    /** Main CRM users.id — cross-DB, no FK */
    verificationBy: bigint("verification_by", { mode: "number" }).notNull(),

    verificationDate: date("verification_date").notNull(),

    remark: varchar("remark", { length: 255 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    amountIdIdx:        index("idx_payment_modes_amount_id").on(table.amountId),
    invoiceIdIdx:       index("idx_payment_modes_invoice_id").on(table.invoiceId),
    paymentMethodIdIdx: index("idx_payment_modes_payment_method_id").on(table.paymentMethodId),
    verificationByIdx:  index("idx_payment_modes_verification_by").on(table.verificationBy),
    invoiceTypeIdx:     index("idx_payment_modes_invoice_type").on(table.invoiceType),
    createdAtIdx:       index("idx_payment_modes_created_at").on(table.createdAt),
  })
);
