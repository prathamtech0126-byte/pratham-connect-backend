import {
  pgTable,
  bigserial,
  bigint,
  decimal,
  timestamp,
  boolean,
  index,
  varchar,
} from "drizzle-orm/pg-core";
import { ruleConfiguration } from "./ruleConfiguration.schema";

export const budgetRules = pgTable(
  "budget_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    rule_configuration_id: bigint("rule_configuration_id", { mode: "number" })
      .references(() => ruleConfiguration.id, { onDelete: "cascade" })
      .notNull(),

    /** Display / round-trip label when tier is defined from text (e.g. "₹50,000+"). */
    label: varchar("label", { length: 255 }),

    budget_amount: decimal("budget_amount", { precision: 14, scale: 2 }).notNull(),

    incentive_amount: decimal("incentive_amount", { precision: 14, scale: 2 }).notNull(),

    is_active: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_budget_rules_config").on(table.rule_configuration_id),
    index("idx_budget_rules_active").on(table.is_active),
    index("idx_budget_rules_config_active").on(
      table.rule_configuration_id,
      table.is_active
    ),
  ]
);
