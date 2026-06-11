import { pgTable, varchar, text, uuid, timestamp, pgEnum, bigserial, bigint, date, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./client_convert.schema";
import { personModule } from "./person.schema";
import { countries } from "../../countries/schemas/countries.schema";

export const passportTypeEnum = pgEnum("passport_type", [
  "passport",
  "other",
]);

export const clientPassport = pgTable("passports", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  personId: uuid("person_id").references(() => personModule.id).notNull(),  
  countryId: uuid("country_id").references(() => countries.id).notNull(),
  passportNumber: varchar("passport_number", { length: 100 }).notNull().unique(),
  passportType: passportTypeEnum("passport_type").notNull(),
  passportExpiryDate: date("passport_expiry_date").notNull(),
  passportIssuingCountry: varchar("passport_issuing_country", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_client_passport_id").on(table.id),
  personIdIdx: index("idx_client_passport_person_id").on(table.personId),
  countryIdIdx: index("idx_client_passport_country_id").on(table.countryId),
  passportTypeIdx: index("idx_client_passport_passport_type").on(table.passportType),
  passportNumberIdx: index("idx_client_passport_passport_number").on(table.passportNumber),
  passportExpiryDateIdx: index("idx_client_passport_passport_expiry_date").on(table.passportExpiryDate),
  passportIssuingCountryIdx: index("idx_client_passport_passport_issuing_country").on(table.passportIssuingCountry),
  createdAtIdx: index("idx_client_passport_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_client_passport_updated_at").on(table.updatedAt),
}));