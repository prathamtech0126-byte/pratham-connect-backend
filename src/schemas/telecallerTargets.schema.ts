import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const telecallerTargets = pgTable("telecaller_targets", {
  id: serial("id").primaryKey(),
  telecallerId: integer("telecaller_id")
    .references(() => users.id)
    .notNull(),
  monthYear: varchar("month_year", { length: 7 }).notNull(), // Format: "YYYY-MM"
  transferTargetAssigned: integer("transfer_target_assigned").default(0).notNull(),
  transferTargetAchieved: integer("transfer_target_achieved").default(0).notNull(),
  conversionTargetAssigned: integer("conversion_target_assigned").default(0).notNull(),
  conversionTargetAchieved: integer("conversion_target_achieved").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Prevents duplicate targets for same telecaller in the same month
    uniqueTelecallerMonth: uniqueIndex("unique_telecaller_month").on(table.telecallerId, table.monthYear),
  };
});