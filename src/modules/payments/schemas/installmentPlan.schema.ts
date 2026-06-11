import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "../../clients/schemas/client_convert.schema";
import { products } from "../../products/schemas/product.schema";
import { sales } from "../../sales/schemas/sale.schema";
import { invoices } from "./invoice.schema";
import { paymentBalances } from "./paymentBalance.schema";

/**
 * CORE    — consultancy fee stages (BEFORE_VISA / AFTER_VISA).
 * PRODUCT — a specific product (IELTS, Forex, Air Ticket, etc.).
 */
export const installmentPaymentCategoryEnum = pgEnum(
  "installment_payment_category_enum",
  ["CORE", "PRODUCT"]
);

/**
 * Which consultancy stage this plan applies to.
 * Only relevant when paymentCategory = CORE.
 * INITIAL is always a single full payment — not eligible for installments.
 */
export const installmentConsultancyStageEnum = pgEnum(
  "installment_consultancy_stage_enum",
  ["BEFORE_VISA", "AFTER_VISA"]
);

/**
 * Lifecycle of an installment plan:
 *
 *   DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → COMPLETED
 *                           ↘ REJECTED  (counsellor revises and resubmits)
 *   Any state → CANCELLED   (voided before completion)
 */
export const installmentPlanStatusEnum = pgEnum(
  "installment_plan_status_enum",
  [
    "DRAFT",             // counsellor is building the plan
    "PENDING_APPROVAL",  // submitted; awaiting manager / TL / admin sign-off
    "APPROVED",          // approved; ready to collect installments
    "REJECTED",          // declined; rejectionReason is set
    "ACTIVE",            // approved + at least one installment collected
    "COMPLETED",         // all installments collected; final PAID invoice issued
    "CANCELLED",         // voided at any point
  ]
);

export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    /** Links to payment_balances — single source of truth for total/pending */
    balanceId: uuid("balance_id").references(() => paymentBalances.id),

    paymentCategory: installmentPaymentCategoryEnum(
      "payment_category"
    ).notNull(),

    /**
     * Set when paymentCategory = CORE.
     * Only BEFORE_VISA and AFTER_VISA are eligible for partial payment.
     */
    consultancyStage: installmentConsultancyStageEnum("consultancy_stage"),

    /**
     * Set when paymentCategory = PRODUCT.
     * Links to the product being paid for in partial installments.
     */
    productId: uuid("product_id").references(() => products.id),

    /** Agreed total the client will pay across all installments */
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),

    /** Running total of amounts collected so far */
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),

    /**
     * Number of installments the counsellor has split the total into.
     * Constrained to 2–5 at the DB level.
     */
    installmentCount: integer("installment_count").notNull(),

    status: installmentPlanStatusEnum("status")
      .notNull()
      .default("DRAFT"),

    saleId: uuid("sale_id")
      .references(() => sales.id)
      .notNull(),

    /** Main CRM users.id — counsellor who created this plan (cross-DB, no FK) */
    requestedBy: bigint("requested_by", { mode: "number" }).notNull(),

    /** Manager / team lead / admin who approved (cross-DB, no FK) */
    approvedBy: bigint("approved_by", { mode: "number" }),

    /** Manager / team lead / admin who rejected (cross-DB, no FK) */
    rejectedBy: bigint("rejected_by", { mode: "number" }),

    rejectionReason: text("rejection_reason"),

    /** Timestamp of the approve/reject action */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    /**
     * The final PAID invoice, generated when all installments are collected.
     * Null until the plan reaches COMPLETED status.
     */
    finalInvoiceId: uuid("final_invoice_id").references(() => invoices.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx:          index("idx_installment_plans_client_id").on(table.clientId),
    balanceIdIdx:         index("idx_installment_plans_balance_id").on(table.balanceId),
    statusIdx:            index("idx_installment_plans_status").on(table.status),
    paymentCategoryIdx:   index("idx_installment_plans_payment_category").on(table.paymentCategory),
    consultancyStageIdx:  index("idx_installment_plans_consultancy_stage").on(table.consultancyStage),
    productIdIdx:         index("idx_installment_plans_product_id").on(table.productId),
    saleIdIdx:              index("idx_installment_plans_sale_id").on(table.saleId),
    requestedByIdx:       index("idx_installment_plans_requested_by").on(table.requestedBy),
    approvedByIdx:        index("idx_installment_plans_approved_by").on(table.approvedBy),
    createdAtIdx:         index("idx_installment_plans_created_at").on(table.createdAt),

    /** DB-level guard: installmentCount must be between 2 and 5 inclusive */
    installmentCountCheck: check(
      "chk_installment_count_range",
      sql`${table.installmentCount} BETWEEN 2 AND 5`
    ),

    /** Ensure totalAmount is positive */
    totalAmountCheck: check(
      "chk_installment_plan_total_amount_positive",
      sql`${table.totalAmount} > 0`
    ),

    /** paidAmount must not exceed totalAmount */
    paidAmountCheck: check(
      "chk_installment_plan_paid_lte_total",
      sql`${table.paidAmount} <= ${table.totalAmount}`
    ),

    /**
     * Mutual exclusivity rule:
     *
     * CORE plan    → consultancy_stage MUST be set (BEFORE_VISA or AFTER_VISA)
     *                product_id MUST be null
     *                (INITIAL is always one-time full payment — never an installment plan)
     *
     * PRODUCT plan → product_id MUST be set
     *                consultancy_stage MUST be null
     *                (products have no before/after visa stages)
     */
    categoryFieldsCheck: check(
      "chk_installment_plan_category_fields",
      sql`(
        (payment_category = 'CORE'    AND consultancy_stage IS NOT NULL AND product_id IS NULL)
        OR
        (payment_category = 'PRODUCT' AND product_id IS NOT NULL         AND consultancy_stage IS NULL)
      )`
    ),
  })
);
