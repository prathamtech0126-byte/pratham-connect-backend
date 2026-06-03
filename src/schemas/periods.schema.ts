import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  date,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

/** Date window + label shared by rule configurations (first-class periods). */
export const periods = pgTable(
  "periods",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    start_date: date("start_date").notNull(),
    end_date: date("end_date"),
    is_active: boolean("is_active").default(true).notNull(),
    created_by: bigint("created_by", { mode: "number" }).references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_periods_dates").on(table.start_date, table.end_date),
    index("idx_periods_active").on(table.is_active),
  ]
);
