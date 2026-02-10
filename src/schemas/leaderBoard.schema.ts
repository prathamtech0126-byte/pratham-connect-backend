import {
    pgTable,
    timestamp,
    bigserial,
    bigint,
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

    createdAt: timestamp("created_at").defaultNow(),
  }
);
