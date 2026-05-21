import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";

export const leadFamilyMembers = pgTable(
  "lead_family_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    leadId: bigint("lead_id", { mode: "number" })
      .references(() => leads.id, { onDelete: "cascade" })
      .notNull(),

    memberName: varchar("member_name", { length: 100 }),
    phoneNumber: varchar("phone_number", { length: 30 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdx: index("idx_family_members_lead").on(table.leadId),
  })
);
