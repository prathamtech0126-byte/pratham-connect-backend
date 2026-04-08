import { pgTable, serial, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  teamId: serial("team_id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});