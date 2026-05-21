import {
  pgTable,
  bigserial,
  bigint,
  pgEnum,
  jsonb,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { incentiveRecords } from "./incentiveRecords.schema";
import { users } from "./users.schema";

export const incentiveAuditActionTypeEnum = pgEnum("incentive_audit_action_type", [
  "CALCULATED",
  "EDITED",
  "APPROVED",
  "REJECTED",
]);

export const incentiveAuditLogs = pgTable(
  "incentive_audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    incentive_record_id: bigint("incentive_record_id", { mode: "number" })
      .references(() => incentiveRecords.id, { onDelete: "cascade" })
      .notNull(),
    action_type: incentiveAuditActionTypeEnum("action_type").notNull(),
    old_value: jsonb("old_value"),
    new_value: jsonb("new_value"),
    remark: text("remark"),
    action_by: bigint("action_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    action_at: timestamp("action_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_incentive_audit_logs_record").on(table.incentive_record_id),
    index("idx_incentive_audit_logs_action").on(table.action_type),
    index("idx_incentive_audit_logs_action_by").on(table.action_by),
    index("idx_incentive_audit_logs_action_at").on(table.action_at),
  ]
);
