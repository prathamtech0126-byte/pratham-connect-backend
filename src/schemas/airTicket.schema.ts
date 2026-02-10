import {
  pgTable,
  varchar,
  decimal,
  date,
  text,
  timestamp,
  bigserial,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const airTicket = pgTable(
  "air_ticket",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    isTicketBooked: boolean("is_ticket_booked").default(false).notNull(),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    airTicketNumber: varchar("air_ticket_number", { length: 50 }).unique(),

    ticketDate: date("date").notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    isTicketBookedIdx: index("idx_air_ticket_booked").on(
      table.isTicketBooked
    ),

    ticketDateIdx: index("idx_air_ticket_date").on(table.ticketDate),

    createdAtIdx: index("idx_air_ticket_created_at").on(table.createdAt),
  })
);

