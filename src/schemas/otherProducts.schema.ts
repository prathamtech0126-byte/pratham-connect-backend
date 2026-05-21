import { pgTable, serial, varchar, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const otherProducts = pgTable("other_products", {
  id: serial("id").primaryKey(),
  productId: varchar("product_id", { length: 100 }).notNull().unique(), // e.g., "financeAndEmployment"
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // Finance, Student, Spouse, Visitor, Common, Other
  productName: varchar("product_name", { length: 100 }).notNull().unique(), // e.g., "ALL_FINANCE_EMPLOYEMENT"
  formType: varchar("form_type", { length: 100 }).notNull(), // financialEntry, ieltsEnrollment, etc.
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  displayOrder: integer("display_order").default(0),
  metadata: text("metadata"), // JSON string for additional data
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Define relations if needed
export const otherProductsRelations = relations(otherProducts, ({}) => ({}));

// Type inference
export type OtherProduct = typeof otherProducts.$inferSelect;
export type NewOtherProduct = typeof otherProducts.$inferInsert;