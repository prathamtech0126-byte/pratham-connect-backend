import {
  bigint,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { products } from "../../products/schemas/product.schema";
import { sales } from "../../sales/schemas/sale.schema";
import { paymentBalances } from "./paymentBalance.schema";

export const amountTypeEnum = pgEnum("amount_type_enum", [
  "CORE",
  "PRODUCT",
]);

/**
 * Consultancy stage on individual CORE payment rows.
 *
 * INITIAL        — one-time full payment; never split into installments.
 * BEFORE_VISA    — counsellor may collect multiple partial payments (installment plan).
 * AFTER_VISA     — counsellor may collect multiple partial payments (installment plan).
 * SUBMITTED_VISA — recorded but does not reduce CORE pending.
 */
export const consultancyStageEnum = pgEnum("consultancy_stage_enum", [
  "INITIAL",
  "BEFORE_VISA",
  "AFTER_VISA",
  "SUBMITTED_VISA",
]);

export const amounts = pgTable(
  "amounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    /** Which sale engagement this payment belongs to */
    saleId: uuid("sale_id")
      .references(() => sales.id)
      .notNull(),
    /** Main CRM client_payment.id — migration idempotency */
    legacyClientPaymentId: bigint("legacy_client_payment_id", {
      mode: "number",
    }).unique(),
    amountCode: varchar("amount_code", { length: 100 }).notNull().unique(),
    /** Parent entity uuid — for CORE payments this is modules clients.id */
    amountId: uuid("amount_id").notNull(),
    type: amountTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    balanceId: uuid("balance_id").references(() => paymentBalances.id),
    /** Set when type = CORE */
    consultancyStage: consultancyStageEnum("consultancy_stage"),
    /** Set when type = PRODUCT */
    productId: uuid("product_id").references(() => products.id),
    /** Main CRM users.id (bigint) — no FK */
    actionBy: bigint("action_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: index("idx_amounts_client_id").on(table.clientId),
    saleIdIdx: index("idx_amounts_sale_id").on(table.saleId),
    legacyPaymentIdx: index("idx_amounts_legacy_client_payment_id").on(
      table.legacyClientPaymentId
    ),
    amountCodeIdx: index("idx_amounts_amount_code").on(table.amountCode),
    amountIdIdx: index("idx_amounts_amount_id").on(table.amountId),
    typeIdx: index("idx_amounts_type").on(table.type),
    balanceIdIdx: index("idx_amounts_balance_id").on(table.balanceId),
    consultancyStageIdx: index("idx_amounts_consultancy_stage").on(
      table.consultancyStage
    ),
    productIdIdx: index("idx_amounts_product_id").on(table.productId),
    amountIdx: index("idx_amounts_amount").on(table.amount),
    actionByIdx: index("idx_amounts_action_by").on(table.actionBy),
    createdAtIdx: index("idx_amounts_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_amounts_updated_at").on(table.updatedAt),
  })
);
