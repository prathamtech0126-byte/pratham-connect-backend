import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { clients } from "../../clients/schemas/client_convert.schema";
import { products } from "../../products/schemas/product.schema";
import { sales } from "../../sales/schemas/sale.schema";
import { saleItems } from "../../sales/schemas/saleItem.schema";

/**
 * CORE    — one consultancy fee balance per sale (Initial + Before + After combined).
 * PRODUCT — one balance per product_transactions row (one loan, one ticket, one all_finance, …).
 */
export const paymentBalanceScopeEnum = pgEnum("payment_balance_scope_enum", [
  "CORE",
  "PRODUCT",
]);

export const paymentBalances = pgTable(
  "payment_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    scope: paymentBalanceScopeEnum("scope").notNull(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    /** Set when scope = CORE — sale type is resolved via sales.sale_type_id */
    saleId: uuid("sale_id").references(() => sales.id),

    /** Set when scope = PRODUCT */
    productId: uuid("product_id").references(() => products.id),

    /**
     * Set when scope = PRODUCT — one balance per product instance.
     * FK to product_transactions.id (no Drizzle .references() here to avoid circular import).
     */
    productTransactionId: uuid("product_transaction_id"),

    /** Optional link to a specific sale line item */
    saleItemId: uuid("sale_item_id").references(() => saleItems.id),

    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),

    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),

    pendingAmount: numeric("pending_amount", { precision: 12, scale: 2 })
      .generatedAlwaysAs(
        (): SQL =>
          sql`${paymentBalances.totalAmount} - ${paymentBalances.paidAmount}`
      ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_balances_client_id").on(table.clientId),
    scopeIdx: index("idx_payment_balances_scope").on(table.scope),
    saleIdIdx: index("idx_payment_balances_sale_id").on(table.saleId),
    productIdIdx: index("idx_payment_balances_product_id").on(table.productId),
    productTransactionIdIdx: index(
      "idx_payment_balances_product_transaction_id"
    ).on(table.productTransactionId),
    saleItemIdIdx: index("idx_payment_balances_sale_item_id").on(table.saleItemId),
    createdAtIdx: index("idx_payment_balances_created_at").on(table.createdAt),

    /** Exactly one CORE balance per sale */
    uniqCoreSale: uniqueIndex("uniq_payment_balances_core_sale")
      .on(table.saleId)
      .where(sql`${table.scope} = 'CORE'`),

    /** One PRODUCT balance per product transaction instance */
    uniqProductTransaction: uniqueIndex(
      "uniq_payment_balances_product_transaction"
    )
      .on(table.productTransactionId)
      .where(sql`${table.scope} = 'PRODUCT'`),

    totalAmountCheck: check(
      "chk_payment_balance_total_amount_positive",
      sql`${table.totalAmount} >= 0`
    ),

    paidAmountCheck: check(
      "chk_payment_balance_paid_lte_total",
      sql`${table.paidAmount} <= ${table.totalAmount}`
    ),

    /**
     * CORE    → sale_id required; product fields null
     * PRODUCT → product_id and product_transaction_id must be set
     */
    scopeFieldsCheck: check(
      "chk_payment_balance_scope_fields",
      sql`(
        (scope = 'CORE'    AND sale_id IS NOT NULL AND product_id IS NULL AND product_transaction_id IS NULL AND sale_item_id IS NULL)
        OR
        (scope = 'PRODUCT' AND product_id IS NOT NULL AND product_transaction_id IS NOT NULL)
      )`
    ),
  })
);
