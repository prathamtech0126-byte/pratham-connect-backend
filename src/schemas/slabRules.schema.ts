import {
  pgTable,
  bigserial,
  bigint,
  decimal,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { ruleConfiguration } from "./ruleConfiguration.schema";

export const slabRules = pgTable(
  "slab_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    rule_configuration_id: bigint("rule_configuration_id", { mode: "number" })
      .references(() => ruleConfiguration.id, { onDelete: "cascade" })
      .notNull(),

    min_slab: decimal("min_slab", { precision: 14, scale: 2 }).notNull(),

    max_slab: decimal("max_slab", { precision: 14, scale: 2 }),  // NULL = "& Above" (no upper limit)

    incentive_amount: decimal("incentive_amount", { precision: 14, scale: 2 }).notNull(),

    is_active: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_slab_rules_config").on(table.rule_configuration_id),
    index("idx_slab_rules_active").on(table.is_active),
    index("idx_slab_rules_config_active").on(
      table.rule_configuration_id,
      table.is_active
    ),
  ]
);
