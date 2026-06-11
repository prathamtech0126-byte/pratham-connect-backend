import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Visa categories in the modules DB (Spouse, Visitor, Student, …).
 * Migrated from main CRM `sale_type_category`.
 */
export const visaCategories = pgTable(
  "visa_categories",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull().unique(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    description: text("description"),
    /** Main CRM sale_type_category.id — used during migration */
    legacyCategoryId: bigint("legacy_category_id", { mode: "number" }).unique(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    slugIdx: index("idx_visa_categories_slug").on(table.slug),
    legacyCategoryIdIdx: index("idx_visa_categories_legacy_category_id").on(
      table.legacyCategoryId
    ),
    displayOrderIdx: index("idx_visa_categories_display_order").on(
      table.displayOrder
    ),
  })
);
