import {
  pgTable,
  date,
  text,
  timestamp,
  pgEnum,
  index,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { clients } from "../../../clients/schemas/client_convert.schema";

export const paymentTutionFeesStatusEnum = pgEnum("tution_fees_status_enum", [
  "paid",
  "pending",
]);

export const paymentTutionFees = pgTable(
  "tution_fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),

    legacyEntityId: bigint("legacy_entity_id", { mode: "number" }).unique(),

    tutionFeesStatus: paymentTutionFeesStatusEnum("tution_fees_status").notNull(),

    feeDate: date("date"),

    remarks: text("remark"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    clientIdIdx: index("idx_payment_tution_fees_client_id").on(table.clientId),
    tutionFeesStatusIdx: index("idx_payment_tution_fees_status").on(
      table.tutionFeesStatus
    ),
    feeDateIdx: index("idx_payment_tution_fees_date").on(table.feeDate),
    createdAtIdx: index("idx_payment_tution_fees_created_at").on(
      table.createdAt
    ),
  })
);
