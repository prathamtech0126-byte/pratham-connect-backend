import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

export const categoryRuleGroupEnum = pgEnum("incentive_category_rule_group", [
  "core_visitor",
  "visitor_product",
]);

export const incentiveCategoryRules = pgTable(
  "incentive_category_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rule_group: categoryRuleGroupEnum("rule_group").notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    incentive_amount: integer("incentive_amount").notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_incentive_category_rules_group").on(table.rule_group),
    index("idx_incentive_category_rules_group_sort").on(table.rule_group, table.sort_order),
  ]
);
