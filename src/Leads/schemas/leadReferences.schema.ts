import {
  bigint,
  bigserial,
  boolean,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "../../schemas/users.schema";

export const leadReferenceKindEnum = pgEnum("lead_reference_kind_enum", [
  "client",
  "internal",
  "self",
]);

/** Reference details for client / internal / self referrals (not stored on leads row). */
export const leadReferences = pgTable("lead_references", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  referenceKind: leadReferenceKindEnum("reference_kind").notNull(),
  entityId: bigint("entity_id", { mode: "number" }),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  memberRole: varchar("member_role", { length: 50 }),
  isManual: boolean("is_manual").default(false).notNull(),
  manualCounsellorId: bigint("manual_counsellor_id", { mode: "number" }).references(
    () => users.id
  ),
  manualCounsellorName: varchar("manual_counsellor_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
