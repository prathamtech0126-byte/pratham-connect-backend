import {
    pgTable,
    timestamp,
    bigserial,
    bigint,
    varchar,
  } from "drizzle-orm/pg-core";
import { users } from "./users.schema";

  export const leaderBoard = pgTable(
    "leader_board",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),

    manager_id: bigint("manager_id", { mode: "number" })
        .references(() => users.id),

        counsellor_id: bigint("counsellor_id", { mode: "number" })
        .references(() => users.id)
        .notNull(),

    target: bigint("target", { mode: "number" }).notNull(),

    achieved_target: bigint("achieved_target", { mode: "number" }).notNull(),

    rank: bigint("rank", { mode: "number" }).notNull(),

    /** Category: "general" | sale type category name (visitor, spouse, student, …) */
    category_name: varchar("category_name", { length: 100 }).notNull().default("general"),

    /** For student category: application-count target (required). For other categories: unused (null). */
    application_target: bigint("application_target", { mode: "number" }),

    /** For student category: final student target (optional, requires paid TD). */
    final_student_target: bigint("final_student_target", { mode: "number" }),

    createdAt: timestamp("created_at").defaultNow(),
  }
);
