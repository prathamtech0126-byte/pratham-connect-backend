import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { clients } from "./client_convert.schema";
import { saleTypes } from "../../sales/schemas/saleType.schema";
import { sql } from "drizzle-orm";

export const clientSale = pgTable(
  "client_sale_modules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    saleTypeId: uuid("sale_type_id")
      .references(() => saleTypes.saleTypeId)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_client_sale_id").on(table.id),
    clientIdIdx: index("idx_client_sale_client_id").on(table.clientId),
    saleTypeIdIdx: index("idx_client_sale_sale_type_id").on(table.saleTypeId),
    createdAtIdx: index("idx_client_sale_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_client_sale_updated_at").on(table.updatedAt),
  })
);
