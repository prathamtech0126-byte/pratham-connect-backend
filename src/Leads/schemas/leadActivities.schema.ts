import {
  AnyPgColumn,
  bigint,
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { leads } from "./leads.schema";
import { users } from "../../schemas/users.schema";

export const leadActivityTypeEnum = pgEnum("lead_activity_type_enum", [
  "note",
  "followup",
  "call_log",
  "assignment_change",
  "counselor_assign",
  "lead_update",
  "lead_created",
]);

export const leadActivityStatusEnum = pgEnum("lead_activity_status_enum", [
  "pending",
  "completed",
  "cancelled",
]);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadId: bigint("lead_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" }).references(
      (): AnyPgColumn => users.id
    ),
    activityType: leadActivityTypeEnum("activity_type").notNull(),
    message: text("message"),
    followupAt: timestamp("followup_at"),
    status: leadActivityStatusEnum("status").default("pending").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdIdx: index("idx_lead_activities_lead_id").on(table.leadId),
    userIdIdx: index("idx_lead_activities_user_id").on(table.userId),
    activityTypeIdx: index("idx_lead_activities_activity_type").on(table.activityType),
    followupAtIdx: index("idx_lead_activities_followup_at").on(table.followupAt),
    createdAtDescIdx: index("idx_lead_activities_created_at_desc").on(table.createdAt.desc()),
  })
);
