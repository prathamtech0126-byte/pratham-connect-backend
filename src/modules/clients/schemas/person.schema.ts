import { sql } from "drizzle-orm";
import { date, index, pgEnum, varchar } from "drizzle-orm/pg-core";
import { bigint, boolean, integer, pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { countries } from "../../countries/schemas/countries.schema";
export const statusEnum = pgEnum("status", [
    "active",
    "inactive",
  ]);

export const personModule = pgTable("persons", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Main CRM client_information.id — for migration idempotency */
  legacyClientId: bigint("legacy_client_id", { mode: "number" }).unique(),
  fullName: text("full_name").notNull(),
  dob: date("date_of_birth").notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  whatsappNumber: varchar("whatsapp_number", { length: 20 }),
  alternatePhone: varchar("alternate_phone", { length: 20 }),
  nationalityId: uuid("nationality_id").references(() => countries.id).notNull(),
  status: statusEnum("status").default("active"),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_client_information_id").on(table.id),
  legacyClientIdIdx: index("idx_person_legacy_client_id").on(table.legacyClientId),
  emailIdx: index("idx_client_information_email").on(table.email),
  phoneIdx: index("idx_client_information_phone").on(table.phone),
  statusIdx: index("idx_client_information_status").on(table.status),
}));

