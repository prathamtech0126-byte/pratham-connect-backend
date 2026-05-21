import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  numeric,
  integer,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { incentiveRecords } from "./incentiveRecords.schema";

export const incentiveRecordBreakdowns = pgTable(
  "incentive_record_breakdowns",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    incentive_record_id: bigint("incentive_record_id", { mode: "number" })
      .references(() => incentiveRecords.id, { onDelete: "cascade" })
      .notNull(),
    type: varchar("type", { length: 50 }),
    sub_type: varchar("sub_type", { length: 100 }),
    rule_type: varchar("rule_type", { length: 50 }),
    status: varchar("status", { length: 50 }),
    reference_id: bigint("reference_id", { mode: "number" }),
    reference_type: varchar("reference_type", { length: 50 }),
    achieved_value: numeric("achieved_value", { precision: 10, scale: 2 }),
    slab_min: integer("slab_min"),
    slab_max: integer("slab_max"),
    applied_rate: numeric("applied_rate", { precision: 10, scale: 2 }),
    calculated_amount: numeric("calculated_amount", { precision: 10, scale: 2 }),
    meta: jsonb("meta"),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_incentive_record_breakdowns_record").on(table.incentive_record_id),
    index("idx_incentive_record_breakdowns_type").on(table.type),
    index("idx_incentive_record_breakdowns_rule_type").on(table.rule_type),
    check(
      "chk_incentive_record_breakdowns_type",
      sql`${table.type} IN ('CORE', 'ALL_FINANCE', 'OTHER_PRODUCT')`
    ),
    check(
      "chk_incentive_record_breakdowns_rule_type",
      sql`${table.rule_type} IN ('slab', 'budget', 'budget_threshold_slab')`
    ),
  ]
);
