import {
  pgTable,
  varchar,
  decimal,
  date,
  text,
  timestamp,
  boolean,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentAirTicket = pgTable(
  "air_ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    /** Main CRM air_ticket.id — migration idempotency */
    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    isTicketBooked: boolean("is_ticket_booked").default(false).notNull(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    airTicketNumber: varchar("air_ticket_number", { length: 50 }).unique(),

    ticketDate: date("date").notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_air_ticket_client_id").on(table.clientId),
    isTicketBookedIdx: index("idx_payment_air_ticket_booked").on(
      table.isTicketBooked
    ),
    ticketDateIdx: index("idx_payment_air_ticket_date").on(table.ticketDate),
    createdAtIdx: index("idx_payment_air_ticket_created_at").on(
      table.createdAt
    ),
  })
);
