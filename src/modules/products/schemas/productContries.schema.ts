import { index, pgTable, uuid } from "drizzle-orm/pg-core";
import { countries } from "../../countries/schemas/countries.schema";
import { products } from "./product.schema";

export const productCountries = pgTable(
  "product_countries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    countryId: uuid("country_id")
      .references(() => countries.id)
      .notNull(),
  },
  (table) => ({
    productIdIdx: index("idx_product_countries_product_id").on(table.productId),
    countryIdIdx: index("idx_product_countries_country_id").on(table.countryId),
  })
);
