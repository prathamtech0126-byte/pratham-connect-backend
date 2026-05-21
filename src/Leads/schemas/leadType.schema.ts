import {
  boolean,
  pgTable,
  varchar,
  timestamp,
  bigserial,
} from "drizzle-orm/pg-core";

export const leadTypes = pgTable("lead_type", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  leadType: varchar("lead_type", { length: 100 }).notNull().unique(),

  /** User-facing label shown in UI (e.g. "Walk In"); `leadType` stores the slug. */
  displayAlias: varchar("display_alias", { length: 100 }),

  /**
   * When `true`, the row is hidden from active dropdowns / lead-source pickers
   * but still kept around for history (existing leads keep their stored slug).
   * Lead types that are referenced by any `leads.lead_source` row cannot be archived.
   */
  isArchived: boolean("is_archived").notNull().default(false),

  createdAt: timestamp("created_at").defaultNow(),
});
