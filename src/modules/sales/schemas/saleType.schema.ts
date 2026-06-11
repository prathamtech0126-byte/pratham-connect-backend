import {
  bigint,
  boolean,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { countries } from "../../countries/schemas/countries.schema";
import { visaCategories } from "./visaCategories.schema";

/**
 * Sale types in the modules / payment database.
 * Each row is a country + visa-category combination (e.g. "Canada Student").
 */
export const saleTypes = pgTable(
  "sale_type",
  {
    saleTypeId: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Main CRM sale_type.id — used when migrating client_payment / payments */
    legacySaleTypeId: bigint("legacy_sale_type_id", { mode: "number" }).unique(),
    saleType: varchar("sale_type", { length: 100 }).notNull().unique(),
    countryId: uuid("country_id").references(() => countries.id),
    visaCategoryId: uuid("visa_category_id").references(() => visaCategories.id),
    isCoreProduct: boolean("is_core_product").default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    legacySaleTypeIdIdx: index("idx_modules_sale_type_legacy_id").on(
      table.legacySaleTypeId
    ),
    countryIdIdx: index("idx_modules_sale_type_country_id").on(table.countryId),
    visaCategoryIdIdx: index("idx_modules_sale_type_visa_category_id").on(
      table.visaCategoryId
    ),
    coreIdx: index("idx_modules_sale_type_core").on(table.isCoreProduct),
    createdAtIdx: index("idx_modules_sale_type_created_at").on(table.createdAt),
  })
);
