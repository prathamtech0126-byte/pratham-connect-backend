import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Modules DB — client document checklist templates (independent from legacy checklist API). */
export const clientDocumentChecklists = pgTable(
  "client_portal_checklists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    visaType: varchar("visa_type", { length: 50 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index("idx_client_portal_checklists_slug").on(table.slug),
    visaTypeIdx: index("idx_client_portal_checklists_visa_type").on(table.visaType),
    countryIdx: index("idx_client_portal_checklists_country").on(table.country),
    activeIdx: index("idx_client_portal_checklists_is_active").on(table.isActive),
  })
);

export const clientDocumentChecklistSections = pgTable(
  "client_portal_checklist_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checklistId: uuid("checklist_id")
      .references(() => clientDocumentChecklists.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    isConditional: boolean("is_conditional").default(false).notNull(),
    conditionText: text("condition_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    checklistIdx: index("idx_client_portal_checklist_sections_checklist").on(table.checklistId),
    orderIdx: index("idx_client_portal_checklist_sections_order").on(table.displayOrder),
  })
);

export const clientDocumentChecklistItems = pgTable(
  "client_portal_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionId: uuid("section_id")
      .references(() => clientDocumentChecklistSections.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    notes: text("notes"),
    isMandatory: boolean("is_mandatory").default(true).notNull(),
    isConditional: boolean("is_conditional").default(false).notNull(),
    conditionText: varchar("condition_text", { length: 255 }),
    quantityNote: varchar("quantity_note", { length: 100 }),
    displayOrder: integer("display_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sectionIdx: index("idx_client_portal_checklist_items_section").on(table.sectionId),
    orderIdx: index("idx_client_portal_checklist_items_order").on(table.displayOrder),
  })
);
