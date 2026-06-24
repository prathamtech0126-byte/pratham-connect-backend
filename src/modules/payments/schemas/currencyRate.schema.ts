import {
  bigint,
  date,
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { countries } from "../../countries/schemas/countries.schema";
import { remarks } from "./remark.schema";
import { clients } from "../../clients/schemas/client_convert.schema";

export const currencyRates = pgTable("currency_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => clients.id).notNull(),
  countryId: uuid("country_id").references(() => countries.id).notNull(),
  currencyCode: varchar("currency_code", { length: 100 }).notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  rateDate: date("rate_date").notNull(),
  remarkId: uuid("remark_id").references(() => remarks.id).notNull(),
  actionBy: bigint("action_by", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow().notNull(),
}, (table) => ({
  clientIdIdx: index("idx_currency_rates_client_id").on(table.clientId),
  countryIdIdx: index("idx_currency_rates_country_id").on(table.countryId),
  remarkIdIdx: index("idx_currency_rates_remark_id").on(table.remarkId),
  currencyCodeIdx: index("idx_currency_rates_currency_code").on(table.currencyCode),
  rateIdx: index("idx_currency_rates_rate").on(table.rate),
  actionByIdx: index("idx_currency_rates_action_by").on(table.actionBy),
  createdAtIdx: index("idx_currency_rates_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_currency_rates_updated_at").on(table.updatedAt),
}));