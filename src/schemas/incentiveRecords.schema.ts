import {
  pgEnum,
  pgTable,
  bigserial,
  bigint,
  integer,
  numeric,
  timestamp,
  varchar,
  index,
  jsonb,
  uniqueIndex,
  text,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { periods } from "./periods.schema";
import { ruleConfiguration } from "./ruleConfiguration.schema";
import { ruleConfigurationSaleTypes } from "./ruleConfigurationSaleTypes.schema";
import { saleTypes } from "./saleType.schema";
import { clientInformation } from "./clientInformation.schema";
import { saleTypeCategories } from "./saleTypeCategory.schema";

export const incentiveRecordStatusEnum = pgEnum("incentive_record_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const incentiveRecords = pgTable(
  "incentive_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    counsellor_id: bigint("counsellor_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),
    client_id: bigint("client_id", { mode: "number" }).references(() => clientInformation.clientId, {
      onDelete: "set null",
    }),
    period_id: bigint("period_id", { mode: "number" })
      .references(() => periods.id, { onDelete: "set null" }),
    rule_id: bigint("rule_id", { mode: "number" })
      .references(() => ruleConfiguration.id, { onDelete: "set null" }),
    rule_sale_type_id: bigint("rule_sale_type_id", { mode: "number" })
      .references(() => ruleConfigurationSaleTypes.id)
      .notNull(),
    sale_type_category_id: bigint("sale_type_category_id", { mode: "number" }).references(
      () => saleTypeCategories.id,
      { onDelete: "set null" }
    ),
    sale_type_id: bigint("sale_type_id", { mode: "number" })
      .references(() => saleTypes.saleTypeId, { onDelete: "set null" }),
    other_product_id: varchar("other_product_id", { length: 100 }),
    achieved_target_value: integer("achieved_target_value").default(0).notNull(),
    achieved_budget_value: numeric("achieved_budget_value", {
      precision: 14,
      scale: 2,
    })
      .default("0")
      .notNull(),
    calculated_incentive: numeric("calculated_incentive", {
      precision: 14,
      scale: 2,
    })
      .default("0")
      .notNull(),
    core_incentive_amount: numeric("core_incentive_amount", { precision: 10, scale: 2 }),
    finance_incentive_amount: numeric("finance_incentive_amount", { precision: 10, scale: 2 }),
    other_product_incentive_amount: numeric("other_product_incentive_amount", {
      precision: 10,
      scale: 2,
    }),
    total_incentive_amount: numeric("total_incentive_amount", { precision: 10, scale: 2 }),
    override_amount: numeric("override_amount", { precision: 10, scale: 2 }),
    override_core_sale: numeric("override_core_sale", { precision: 10, scale: 2 }),
    override_all_finance: numeric("override_all_finance", { precision: 10, scale: 2 }),
    override_other_products: numeric("override_other_products", { precision: 10, scale: 2 }),
    remark: text("remark"),
    approval_batch_id: varchar("approval_batch_id", { length: 100 }),
    final_incentive: numeric("final_incentive", { precision: 14, scale: 2 }),
    rule_snapshot: jsonb("rule_snapshot"),
    calculation_snapshot: jsonb("calculation_snapshot"),
    status: incentiveRecordStatusEnum("status").default("PENDING").notNull(),
    calculated_at: timestamp("calculated_at").defaultNow().notNull(),
    approved_at: timestamp("approved_at"),
    approved_by: bigint("approved_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_incentive_records_counsellor").on(table.counsellor_id),
    index("idx_incentive_records_client").on(table.client_id),
    index("idx_incentive_records_period").on(table.period_id),
    index("idx_incentive_records_rule").on(table.rule_id),
    index("idx_incentive_records_rule_sale_type").on(table.rule_sale_type_id),
    index("idx_incentive_records_client_period").on(table.client_id, table.period_id),
    index("idx_incentive_records_sale_type").on(table.sale_type_id),
    index("idx_incentive_records_status").on(table.status),
    index("idx_incentive_records_batch").on(table.approval_batch_id),
    index("idx_incentive_records_approved_by").on(table.approved_by),
    uniqueIndex("uniq_incentive_records_client_period").on(table.client_id, table.period_id),
  ]
);
