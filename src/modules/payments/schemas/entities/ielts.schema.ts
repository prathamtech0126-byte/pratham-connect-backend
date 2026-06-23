import {
  pgTable,
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

export const paymentIelts = pgTable(
  "ielts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    enrolledStatus: boolean("enrolled_status").default(false),

    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    enrollmentDate: date("date"),

    remarks: text("remarks"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_ielts_client_id").on(table.clientId),
    enrolledStatusIdx: index("idx_payment_ielts_enrolled_status").on(
      table.enrolledStatus
    ),
    enrollmentDateIdx: index("idx_payment_ielts_date").on(table.enrollmentDate),
    createdAtIdx: index("idx_payment_ielts_created_at").on(table.createdAt),
  })
);
