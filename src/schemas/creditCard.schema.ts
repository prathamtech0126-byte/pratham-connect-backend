import {
  pgTable,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  boolean,
  varchar,
  index,
} from "drizzle-orm/pg-core";

export const creditCard = pgTable(
  "credit_card",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    activatedStatus: boolean("activated_status").default(false),

    cardPlan: varchar("card_plan", { length: 100 }),

    cardGivingDate: date("card_giving_date"),

    cardActivationDate: date("card_activation_date"),

    cardDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    activatedStatusIdx: index("idx_credit_card_activated_status").on(
      table.activatedStatus
    ),

    cardGivingDateIdx: index("idx_credit_card_giving_date").on(
      table.cardGivingDate
    ),

    cardDateIdx: index("idx_credit_card_date").on(table.cardDate),

    createdAtIdx: index("idx_credit_card_created_at").on(table.createdAt),
  })
);

