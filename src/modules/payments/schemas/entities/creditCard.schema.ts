import {
  pgTable,
  date,
  text,
  timestamp,
  boolean,
  varchar,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentCreditCard = pgTable(
  "credit_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    activatedStatus: boolean("activated_status").default(false),

    cardPlan: varchar("card_plan", { length: 100 }),

    cardGivingDate: date("card_giving_date"),

    cardActivationDate: date("card_activation_date"),

    cardDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_credit_card_client_id").on(table.clientId),
    activatedStatusIdx: index("idx_payment_credit_card_activated_status").on(
      table.activatedStatus
    ),
    cardGivingDateIdx: index("idx_payment_credit_card_giving_date").on(
      table.cardGivingDate
    ),
    cardDateIdx: index("idx_payment_credit_card_date").on(table.cardDate),
    createdAtIdx: index("idx_payment_credit_card_created_at").on(
      table.createdAt
    ),
  })
);
