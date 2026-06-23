import { pgTable, varchar, uuid, timestamp, pgEnum, index, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { personModule } from "./person.schema";
import { clients } from "./client_convert.schema";


export const relationEnum = pgEnum("relation", [
  "father",
  "mother",
  "son",
  "daughter",
  "husband",
  "wife",
  "brother",
  "sister",
  "grandfather",
  "grandmother",
  "grandfather's brother",
  "grandfather's sister",
  "grandmother's brother",
  "grandmother's sister",
  "uncle's brother",
  "uncle's sister",
  "aunt's brother",
  "aunt's sister",
  "cousin's brother",
  "cousin's sister",
  "other",
]);

export const clientFamilyMembers = pgTable("client_family_members_modules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: uuid("client_id").references(() => clients.id).notNull(),
  personId: uuid("person_id").references(() => personModule.id).notNull(),
  occupation: varchar("occupation", { length: 100 }).notNull(),
  relation: relationEnum("relation").notNull(),
  createdAt: timestamp("created_at", {withTimezone: true}).defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).defaultNow(),
}, (table) => ({
  idIdx: index("idx_client_family_members_id").on(table.id),
  personIdIdx: index("idx_client_family_members_person_id").on(table.personId),
  relationIdx: index("idx_client_family_members_relation").on(table.relation),
  createdAtIdx: index("idx_client_family_members_created_at").on(table.createdAt),
  updatedAtIdx: index("idx_client_family_members_updated_at").on(table.updatedAt),
}));