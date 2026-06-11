import {
  pgTable,
  uuid,
  timestamp,
  index,
  varchar,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { saleTypes } from "./saleType.schema";

/**
 * One row per client + sale-type engagement (e.g. Canada Student case).
 * A client may have many sales over time; amounts link via sale_id.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: varchar("sale_id", { length: 100 }).notNull().unique(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    saleTypeId: uuid("sale_type_id")
      .references(() => saleTypes.saleTypeId)
      .notNull(),
    saleDate: date("sale_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idIdx: index("idx_sales_id").on(table.id),
    saleIdIdx: index("idx_sales_sale_id").on(table.saleId),
    clientIdIdx: index("idx_sales_client_id").on(table.clientId),
    saleTypeIdIdx: index("idx_sales_sale_type_id").on(table.saleTypeId),
    saleDateIdx: index("idx_sales_sale_date").on(table.saleDate),
    clientSaleTypeUnique: uniqueIndex("uniq_sales_client_sale_type").on(
      table.clientId,
      table.saleTypeId
    ),
  })
);
