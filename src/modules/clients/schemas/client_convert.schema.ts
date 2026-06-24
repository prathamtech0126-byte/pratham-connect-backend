import {
  pgTable,
  uuid,
  timestamp,
  index,
  varchar,
  boolean,
  date,
  bigint,
  numeric,
} from "drizzle-orm/pg-core";
import { personModule } from "./person.schema";
import { sql } from "drizzle-orm";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Main CRM client_information.id — for migration idempotency */
    legacyClientId: bigint("legacy_client_id", { mode: "number" }).unique(),
    personId: uuid("person_id")
      .references(() => personModule.id)
      .notNull(),
    /** Main CRM `leads.id` (bigint) — no FK; different database */
    leadId: bigint("lead_id", { mode: "number" }),
    /** Branch segment in client code, e.g. VAD in PRA-VAD-CLI-2026-000001 */
    branchCode: varchar("branch_code", { length: 10 }).notNull().default("VAD"),
    clientCode: varchar("client_code", { length: 50 }).notNull().unique(),
    enrollmentDate: date("enrollment_date").notNull(),
    transferStatus: boolean("transfer_status").default(false),
    /** Main CRM `users.id` (bigint) — no FK; different database */
    transferedId: bigint("transfered_id", { mode: "number" }),
    /** Denormalized rollup: sum of all payment_balances for this client */
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    pendingAmount: numeric("pending_amount", { precision: 12, scale: 2 })
      .generatedAlwaysAs(sql`total_amount - paid_amount`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    idIdx: index("idx_client_id").on(table.id),
    legacyClientIdIdx: index("idx_client_legacy_client_id").on(
      table.legacyClientId
    ),
    personIdIdx: index("idx_client_person_id").on(table.personId),
    branchCodeIdx: index("idx_client_branch_code").on(table.branchCode),
    clientCodeIdx: index("idx_client_client_code").on(table.clientCode),
    leadIdIdx: index("idx_client_lead_id").on(table.leadId),
    transferStatusIdx: index("idx_client_transfer_status").on(
      table.transferStatus
    ),
    transferedIdIdx: index("idx_client_transfered_id").on(table.transferedId),
    createdAtIdx: index("idx_client_created_at").on(table.createdAt),
    updatedAtIdx: index("idx_client_updated_at").on(table.updatedAt),
  })
);
