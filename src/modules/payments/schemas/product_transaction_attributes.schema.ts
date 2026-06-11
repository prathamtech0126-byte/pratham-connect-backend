import {
  bigint,
  boolean,
  date,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { productTransactions } from "./product_transactions.schema";

/**
 * One row per product-specific field on a product transaction (EAV — no jsonb).
 *
 * Each attribute is stored in exactly one typed value column:
 *   stringValue  — ticketNumber, policyNumber, plan, cardStatus, examType, serviceName, …
 *   numberValue  — product value amount (loan/ticket/insurance face value, not collected payment)
 *   booleanValue — isBooked, isActivated, enrolledStatus, …
 *   dateValue    — secondary dates (activationDate, givingDate, feeDate, …)
 *
 * Primary report date lives on product_transactions.eventDate — not here.
 *
 * Attribute keys per product (validated in app):
 *   AIR_TICKET     → ticketNumber, isBooked, amount
 *   LOAN           → amount
 *   SIM_CARD       → plan, isActivated, givingDate, activationDate
 *   FOREX_CARD     → cardStatus
 *   FOREX_FEES     → side, amount
 *   VISA_EXTENSION → extensionType, amount, invoiceNumber
 *   INSURANCE      → policyNumber, amount
 *   NEW_SELL       → serviceName, serviceInfo, amount, invoiceNumber
 *   IELTS          → examType, enrolledStatus, amount
 *   CREDIT_CARD    → plan, isActivated, givingDate, activationDate, cardDate
 *   TUTION_FEES    → status
 *   ALL_FINANCE    → totalAmount, partialPayment, approvalStatus, invoiceNumber
 *   BEACON_ACCOUNT → amount
 *   MASTER_ONLY    → invoiceNumber (amount/date on payment rows from client_product_payment)
 */
export const productTransactionAttributes = pgTable(
  "product_transaction_attributes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productTransactionId: uuid("product_transaction_id")
      .references(() => productTransactions.id, { onDelete: "cascade" })
      .notNull(),

    /** Stable key, e.g. ticketNumber, policyNumber, examType, plan, isActivated */
    attributeKey: varchar("attribute_key", { length: 100 }).notNull(),

    stringValue: varchar("string_value", { length: 500 }),
    numberValue: numeric("number_value", { precision: 12, scale: 2 }),
    booleanValue: boolean("boolean_value"),
    dateValue: date("date_value"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** One value per key per transaction */
    uniqTransactionAttribute: uniqueIndex(
      "uniq_product_transaction_attributes_txn_key"
    ).on(table.productTransactionId, table.attributeKey),

    productTransactionIdIdx: index(
      "idx_product_transaction_attributes_transaction_id"
    ).on(table.productTransactionId),

    attributeKeyIdx: index("idx_product_transaction_attributes_key").on(
      table.attributeKey
    ),

    /** Lookup by key + string value (e.g. ticketNumber, policyNumber) */
    keyStringIdx: index("idx_product_transaction_attributes_key_string").on(
      table.attributeKey,
      table.stringValue
    ),
  })
);
