import {
  bigint,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { amounts } from "./amount.schema";
import { remarks } from "./remark.schema";

/**
 * PROFORMA — issued for each partial/installment payment collected.
 * PAID     — issued when the full payment is settled (one-time or all installments done).
 * CANCELLED / REFUNDED — lifecycle states.
 */
export const invoiceStatusEnum = pgEnum("invoice_status_enum", [
  "PROFORMA",
  "PAID",
  "CANCELLED",
  "REFUNDED",
]);

/**
 * CORE    — consultancy fee (Initial / Before-Visa / After-Visa stages).
 * PRODUCT — product payment (IELTS, Loan, Forex, Air Ticket, etc.).
 */
export const invoiceCategoryEnum = pgEnum("invoice_category_enum", [
  "CORE",
  "PRODUCT",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    /** Human-readable invoice number shown on the document (e.g. INV-2026-001) */
    invoiceNumber: varchar("invoice_number", { length: 100 }).notNull(),

    invoiceStatus: invoiceStatusEnum("invoice_status").notNull(),

    invoiceCategory: invoiceCategoryEnum("invoice_category").notNull(),

    /**
     * Links to the amounts ledger row this invoice covers.
     * For installment payments the amounts row represents one installment's amount.
     * For full payments it represents the total amount row.
     */
    amountId: uuid("amount_id").references(() => amounts.id),

    /** Denormalised total for fast reads without joining amounts */
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),

    remarkId: uuid("remark_id").references(() => remarks.id),

    actionBy: bigint("action_by", { mode: "number" }).notNull(),

    /** Timestamp the invoice was formally issued */
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    invoiceNumberIdx:  uniqueIndex("uniq_invoices_invoice_number").on(table.invoiceNumber),
    clientIdIdx:       index("idx_invoices_client_id").on(table.clientId),
    invoiceStatusIdx:  index("idx_invoices_invoice_status").on(table.invoiceStatus),
    invoiceCategoryIdx:index("idx_invoices_invoice_category").on(table.invoiceCategory),
    amountIdIdx:       index("idx_invoices_amount_id").on(table.amountId),
    issuedAtIdx:       index("idx_invoices_issued_at").on(table.issuedAt),
    createdAtIdx:      index("idx_invoices_created_at").on(table.createdAt),
    actionByIdx:       index("idx_invoices_action_by").on(table.actionBy),
  })
);
