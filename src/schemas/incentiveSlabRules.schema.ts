import {
  pgTable,
  uuid,
  integer,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const slabRuleGroupEnum = pgEnum("incentive_slab_rule_group", [
  "core_spouse",
  "finance_spouse",
  "canada_student",
  "student",
  "all_finance",
]);

export const incentiveSlabRules = pgTable(
  "incentive_slab_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rule_group: slabRuleGroupEnum("rule_group").notNull(),
    min_count: integer("min_count").notNull(),
    max_count: integer("max_count").notNull(),
    incentive_amount: integer("incentive_amount").notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_incentive_slab_rules_group").on(table.rule_group),
    index("idx_incentive_slab_rules_group_sort").on(table.rule_group, table.sort_order),
  ]
);
