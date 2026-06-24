import {
  pgTable,
  varchar,
  date,
  text,
  timestamp,
  boolean,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentSimCard = pgTable(
  "sim_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    activatedStatus: boolean("activated_status").default(false),

    simcardPlan: varchar("simcard_plan", { length: 100 }),

    simCardGivingDate: date("sim_card_giving_date"),

    simActivationDate: date("sim_activation_date"),

    remarks: text("remarks"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_sim_card_client_id").on(table.clientId),
    activatedStatusIdx: index("idx_payment_sim_card_activated_status").on(
      table.activatedStatus
    ),
    simCardGivingDateIdx: index("idx_payment_sim_card_giving_date").on(
      table.simCardGivingDate
    ),
    createdAtIdx: index("idx_payment_sim_card_created_at").on(table.createdAt),
  })
);
