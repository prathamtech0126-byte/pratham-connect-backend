import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { installmentPlans } from "./installmentPlan.schema";
import { invoices } from "./invoice.schema";

/**
 * PENDING  — due but not yet collected.
 * PAID     — collected; proformaInvoiceId is set.
 * OVERDUE  — past dueDate and still unpaid.
 * CANCELLED — removed from the plan (e.g. plan was cancelled).
 */
export const installmentStatusEnum = pgEnum("installment_status_enum", [
  "PENDING",
  "PAID",
  "OVERDUE",
  "CANCELLED",
]);

export const installments = pgTable(
  "installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .references(() => installmentPlans.id, { onDelete: "cascade" })
      .notNull(),
    /** 1-based sequence within the plan (1 = first, up to 5 = last) */
    installmentNumber: integer("installment_number").notNull(),
    /** Amount due for this specific installment */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date").notNull(),
    /** Actual date the payment was received; null until paid */
    paidDate: date("paid_date"),
    status: installmentStatusEnum("status").notNull().default("PENDING"),
    /**
     * PROFORMA invoice issued when this installment is collected.
     * Set to null until the installment is marked PAID.
     * When the last installment is paid, the plan generates a final PAID invoice
     * stored on installmentPlans.finalInvoiceId — this field always holds the proforma.
     */
    proformaInvoiceId: uuid("proforma_invoice_id")
      .references(() => invoices.id),
    /** Main CRM users.id — staff member who recorded this payment (cross-DB, no FK) */
    collectedBy: bigint("collected_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    planIdIdx:             index("idx_installments_plan_id").on(table.planId),
    statusIdx:             index("idx_installments_status").on(table.status),
    dueDateIdx:            index("idx_installments_due_date").on(table.dueDate),
    paidDateIdx:           index("idx_installments_paid_date").on(table.paidDate),
    proformaInvoiceIdIdx:  index("idx_installments_proforma_invoice_id").on(table.proformaInvoiceId),
    collectedByIdx:        index("idx_installments_collected_by").on(table.collectedBy),
    createdAtIdx:          index("idx_installments_created_at").on(table.createdAt),

    /** Each installment number must be unique within a plan */
    uniqPlanInstallmentNumber: uniqueIndex("uniq_installments_plan_number").on(
      table.planId,
      table.installmentNumber
    ),

    /** installmentNumber must be between 1 and 5 */
    installmentNumberCheck: check(
      "chk_installment_number_range",
      sql`${table.installmentNumber} BETWEEN 1 AND 5`
    ),

    /** Amount must be positive */
    amountCheck: check(
      "chk_installment_amount_positive",
      sql`${table.amount} > 0`
    ),
  })
);
