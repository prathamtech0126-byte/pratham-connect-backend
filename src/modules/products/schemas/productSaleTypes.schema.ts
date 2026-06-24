import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./product.schema";
import { countries } from "../../countries/schemas/countries.schema";
import { saleTypes } from "../../sales/schemas/saleType.schema";

/**
 * Maps which products are available for which visa type (sale type) and optionally
 * which destination country.
 *
 * Examples:
 *   IELTS_ENROLLMENT  → saleTypeId: <Student Visa id>   countryId: <Canada id>
 *   SPONSOR_CHARGES   → saleTypeId: <Visitor Visa id>   countryId: null (any country)
 *   AIR_TICKET        → saleTypeId: <Spouse Visa id>    countryId: <UK id>
 */
export const productSaleTypes = pgTable(
  "product_sale_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),

    saleTypeId: uuid("sale_type_id")
      .references(() => saleTypes.saleTypeId)
      .notNull(),

    /**
     * Optional country scope. Null means the product applies to ALL countries
     * for that sale type. When set, this row only applies to that specific
     * destination country.
     */
    countryId: uuid("country_id").references(() => countries.id),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    productIdIdx:    index("idx_product_sale_types_product_id").on(table.productId),
    saleTypeIdIdx:   index("idx_product_sale_types_sale_type_id").on(table.saleTypeId),
    countryIdIdx:    index("idx_product_sale_types_country_id").on(table.countryId),
    isActiveIdx:     index("idx_product_sale_types_is_active").on(table.isActive),
    createdAtIdx:    index("idx_product_sale_types_created_at").on(table.createdAt),

    /**
     * A product can only be mapped once per sale-type + country combination.
     * For the "all countries" case (countryId IS NULL) uniqueness is handled
     * by a partial unique index at the database level if needed; this covers
     * the non-null country case.
     */
    uniqProductSaleTypeCountry: uniqueIndex(
      "uniq_product_sale_types_product_saletype_country"
    ).on(table.productId, table.saleTypeId, table.countryId),
  })
);
