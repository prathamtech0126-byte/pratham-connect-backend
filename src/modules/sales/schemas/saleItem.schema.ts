import { index, integer, numeric, pgTable, uuid } from "drizzle-orm/pg-core";
import { products } from "../../products/schemas/product.schema";
import { sales } from "./sale.schema";
import { clients } from "../../clients/schemas/client_convert.schema";

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    saleId: uuid("sale_id")
      .references(() => sales.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    quantity: integer("quantity").default(1).notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => ({
    saleIdIdx: index("idx_sale_items_sale_id").on(table.saleId),
    productIdIdx: index("idx_sale_items_product_id").on(table.productId),
  })
);
