import { pgTable, varchar, text, uuid, timestamp, pgEnum, bigserial, bigint, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { personModule } from "./person.schema";
import { countries } from "../../countries/schemas/countries.schema";


export const addressTypeEnum = pgEnum("address_type", [
    "permanent",
    "current",
    "other",
  ]);

export const clientAddresses = pgTable("addresses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: uuid("person_id").references(() => personModule.id).notNull(),
  countryId: uuid("country_id").references(() => countries.id).notNull(),
  addressType: addressTypeEnum("address_type").notNull(),
  addressLine1: text("address_line_1").notNull(),
  addressLine2: text("address_line_2"),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 100 }).notNull(),
  postalCode: varchar("postal_code", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_addresses_id").on(table.id),
  personIdIdx: index("idx_addresses_person_id").on(table.personId),
  addressTypeIdx: index("idx_addresses_address_type").on(table.addressType),
  countryIdIdx: index("idx_addresses_country_id").on(table.countryId),
  cityIdx: index("idx_addresses_city").on(table.city),
  stateIdx: index("idx_addresses_state").on(table.state),
  postalCodeIdx: index("idx_addresses_postal_code").on(table.postalCode),
  createdAtIdx: index("idx_addresses_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_addresses_updated_at").on(table.updatedAt),
}));