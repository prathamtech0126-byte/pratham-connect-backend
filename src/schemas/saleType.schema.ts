// // saleTypes.schema.ts
// import {
//   pgTable,
//   varchar,
//   boolean,
//   timestamp,
//   bigserial,
//   decimal,
// } from "drizzle-orm/pg-core";

// export const saleTypes = pgTable("sale_type", {
//   saleTypeId: bigserial("id", { mode: "number" }).primaryKey(),
//   saleType: varchar("sale_type", { length: 100 }).notNull().unique(),
//   amount: decimal("amount", { precision: 12, scale: 2 }),
//   isCoreProduct: boolean("is_core_product").default(false),
//   createdAt: timestamp("created_at").defaultNow(),
// });
import {
  pgTable,
  varchar,
  boolean,
  timestamp,
  bigserial,
  decimal,
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { saleTypeCategories } from "./saleTypeCategory.schema";

export const saleTypes = pgTable(
  "sale_type",
  {
    saleTypeId: bigserial("id", { mode: "number" }).primaryKey(),

    saleType: varchar("sale_type", { length: 100 }).notNull().unique(),

    amount: decimal("amount", { precision: 12, scale: 2 }),

    categoryId: bigint("category_id", { mode: "number" })
      .references(() => saleTypeCategories.id, { onDelete: "set null" }),

    isCoreProduct: boolean("is_core_product").default(false),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    coreIdx: index("idx_sale_type_core").on(table.isCoreProduct),
    categoryIdx: index("idx_sale_type_category").on(table.categoryId),
    createdAtIdx: index("idx_sale_type_created_at").on(table.createdAt),
    coreCreatedIdx: index("idx_sale_type_core_created").on(
      table.isCoreProduct,
      table.createdAt
    ),
  })
);
