import {
  pgTable,
  serial,
  varchar,
  timestamp,
  bigint,
  boolean,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const teams = pgTable("teams", {
  teamId: serial("team_id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true),
  /** Admin / superadmin who created the row (`users.id`). */
  createdBy: bigint("created_by", { mode: "number" }).references(
    (): AnyPgColumn => users.id
  ),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});