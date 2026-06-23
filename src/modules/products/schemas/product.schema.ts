import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  index,
  bigint,
} from "drizzle-orm/pg-core";
import { countries } from "../../../schemas/checklist.schema";
import { productCategories } from "./productCategories.schema";

export const products = pgTable(
  "products",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Main CRM other_products.id — for cross-reference after migration */
    legacyOtherProductId: bigint("legacy_other_product_id", {
      mode: "number",
    }).unique(),
    productCategoryId: uuid("product_category_id").references(() => productCategories.id),
    productId: varchar("product_id", { length: 100 }).notNull().unique(),
    countryId: uuid("country_id").references(() => countries.id),
    name: varchar("name", { length: 255 }).notNull(),
    productName: varchar("product_name", { length: 100 }).notNull().unique(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    legacyIdIdx: index("idx_products_legacy_other_product_id").on(
      table.legacyOtherProductId
    ),
    productIdIdx: index("idx_products_product_id").on(table.productId),
    productNameIdx: index("idx_products_product_name").on(table.productName),
    productCategoryIdIdx: index("idx_products_product_category_id").on(table.productCategoryId),
    displayOrderIdx: index("idx_products_display_order").on(table.displayOrder),
    isActiveIdx: index("idx_products_is_active").on(table.isActive),
    createdAtIdx: index("idx_products_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_products_updated_at").on(table.updatedAt),
  })
);
