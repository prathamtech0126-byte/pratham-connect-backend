import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { products } from "../../products/schemas/product.schema";
import { paymentBalances } from "./paymentBalance.schema";

/**
 * ACTIVE    — product registered; payment is in progress (not yet fully collected).
 * COMPLETED — all payments collected for this product.
 * CANCELLED — product transaction was voided before completion.
 *
 * Note: PENDING / FAILED are payment states — they live on individual amounts rows,
 * not on the product transaction itself.
 */
export const productTransactionStatusEnum = pgEnum(
  "product_transaction_status_enum",
  ["ACTIVE", "COMPLETED", "CANCELLED"]
);

/**
 * One row per product instance purchased by a client (one loan, one ticket, one sim, …).
 *
 * Financial collections live in amounts + invoices:
 *   amounts.amount_id = product_transactions.id   (amounts points HERE — not the reverse)
 *
 * Product-specific fields (ticket numbers, plans, policy numbers, etc.) live in
 * product_transaction_attributes — one row per field, no jsonb.
 *
 * Primary business date for reports/filtering:
 *   event_date — disbursement, enrollment, ticket, giving date, etc.
 *
 * Secondary dates (activationDate, cardDate, …) → attribute rows with date_value.
 */
export const productTransactions = pgTable(
  "product_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),

    /**
     * Balance for this specific product instance (total / paid / pending).
     * Set after the balance row is created; nullable during creation sequence.
     */
    balanceId: uuid("balance_id").references(() => paymentBalances.id),

    status: productTransactionStatusEnum("status")
      .notNull()
      .default("ACTIVE"),

    /**
     * Primary business date — indexed for report range queries.
     * Maps from old entity tables: disbursmentDate, enrollmentDate, ticketDate,
     * simCardGivingDate, cardGivingDate, insuranceDate, etc.
     */
    eventDate: date("event_date"),

    /**
     * Product-level notes. Payment-level notes go on remarks (linked to amounts).
     * Cannot use remarks table here because remarks.amount_id is NOT NULL
     * and the amounts row may not exist yet at creation time.
     */
    remarks: text("remarks"),

    /** Main CRM users.id — counsellor who registered this product (cross-DB, no FK) */
    handledBy: bigint("handled_by", { mode: "number" }).notNull(),

    /** Main CRM client_product_payment.id — migration idempotency */
    legacyProductPaymentId: bigint("legacy_product_payment_id", {
      mode: "number",
    }).unique(),

    /** Main CRM entity_type enum value, e.g. airTicket_id, loan_id */
    legacyEntityType: varchar("legacy_entity_type", { length: 50 }),

    /** Main CRM entity table primary key (air_ticket.id, loan.id, …) */
    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: index("idx_product_transactions_client_id").on(table.clientId),
    productIdIdx: index("idx_product_transactions_product_id").on(
      table.productId
    ),
    balanceIdIdx: index("idx_product_transactions_balance_id").on(
      table.balanceId
    ),
    statusIdx: index("idx_product_transactions_status").on(table.status),
    eventDateIdx: index("idx_product_transactions_event_date").on(
      table.eventDate
    ),
    handledByIdx: index("idx_product_transactions_handled_by").on(
      table.handledBy
    ),
    createdAtIdx: index("idx_product_transactions_created_at").on(
      table.createdAt
    ),
    legacyEntityIdx: index("idx_product_transactions_legacy_entity").on(
      table.legacyEntityType,
      table.legacyEntityId
    ),

    /** Client profile: all instances of a product type */
    clientProductIdx: index("idx_product_transactions_client_product").on(
      table.clientId,
      table.productId
    ),

    /** Reports: product activity in a date range for a client */
    clientEventDateIdx: index("idx_product_transactions_client_event_date").on(
      table.clientId,
      table.eventDate
    ),
  })
);
