import {
    pgTable,
    varchar,
    timestamp,
    bigserial,
  } from "drizzle-orm/pg-core";

  export const leadTypes = pgTable(
    "lead_type",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),

      leadType: varchar("lead_type", { length: 100 }).notNull().unique(),

      createdAt: timestamp("created_at").defaultNow(),
    });
