import {
  pgTable,
  varchar,
  text,
  timestamp,
  bigserial,
  index,
} from "drizzle-orm/pg-core";

export const saleTypeCategories = pgTable(
  "sale_type_category",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    name: varchar("name", { length: 100 }).notNull().unique(),

    description: text("description"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    nameIdx: index("idx_sale_type_category_name").on(table.name),
  })
);
