import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const visaCategories = pgTable("visa_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const countries = pgTable("countries", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    visaCategoryId: uuid("visa_category_id")
      .notNull()
      .references(() => visaCategories.id),
    countryId: uuid("country_id").references(() => countries.id),
    title: varchar("title", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    subType: varchar("sub_type", { length: 100 }),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    visaCategoryIdx: index("idx_checklists_visa_category").on(table.visaCategoryId),
    countryIdx: index("idx_checklists_country").on(table.countryId),
    isActiveIdx: index("idx_checklists_is_active").on(table.isActive),
    activeVisaCategoryIdx: index("idx_checklists_active_visa_category").on(
      table.isActive,
      table.visaCategoryId
    ),
  })
);

export const documentSections = pgTable(
  "document_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    displayOrder: integer("display_order").default(0),
    isConditional: boolean("is_conditional").default(false),
    conditionText: text("condition_text"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    checklistIdx: index("idx_document_sections_checklist").on(table.checklistId),
  })
);

export const documentItems = pgTable(
  "document_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => documentSections.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    notes: text("notes"),
    isMandatory: boolean("is_mandatory").default(true),
    isConditional: boolean("is_conditional").default(false),
    conditionText: varchar("condition_text", { length: 255 }),
    quantityNote: varchar("quantity_note", { length: 100 }),
    displayOrder: integer("display_order").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    sectionIdx: index("idx_document_items_section").on(table.sectionId),
  })
);
