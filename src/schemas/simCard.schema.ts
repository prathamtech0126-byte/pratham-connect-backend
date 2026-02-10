import {
  pgTable,
  varchar,
  date,
  text,
  timestamp,
  bigserial,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const simCard = pgTable(
  "sim_card",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    activatedStatus: boolean("activated_status").default(false),

    simcardPlan: varchar("simcard_plan", { length: 100 }),

    simCardGivingDate: date("sim_card_giving_date"),

    simActivationDate: date("sim_activation_date"),

    remarks: text("remarks"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    activatedStatusIdx: index("idx_sim_card_activated_status").on(
      table.activatedStatus
    ),

    simCardGivingDateIdx: index("idx_sim_card_giving_date").on(
      table.simCardGivingDate
    ),

    createdAtIdx: index("idx_sim_card_created_at").on(table.createdAt),
  })
);

