import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  date,
  timestamp,
  boolean,
  index,
  pgEnum,
  text,
  jsonb,
  decimal,
} from "drizzle-orm/pg-core";
import { saleTypeCategories } from "./saleTypeCategory.schema";
import { users } from "./users.schema";
import { periods } from "./periods.schema";

export const ruleTypeEnum = pgEnum("rule_type", ["budget", "slab", "budget_threshold_slab"]);

export const ruleConfiguration = pgTable(
  "rule_configuration",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** Optional link to {@link periods}; dates remain on this row for backward compatibility. */
    period_id: bigint("period_id", { mode: "number" }).references(() => periods.id, {
      onDelete: "set null",
    }),

    name: varchar("name", { length: 150 }).notNull(),

    description: text("description"),

    rule_type: ruleTypeEnum("rule_type").notNull(),

    start_date: date("start_date").notNull(),

    end_date: date("end_date"),

    /** Minimum aggregate/payment amount before slab tiers apply (API: budget_threshold_slab). */
    min_budget_threshold: decimal("min_budget_threshold", { precision: 18, scale: 2 }),

    /**
     * Subset of all-finance targets: spouse | visitor | student (JSON string array).
     * Used by product rules; incentive engine may consume later.
     */
    all_finance_sale_type_categories: jsonb("all_finance_sale_type_categories").$type<string[] | null>(),

    sale_type_category_id: bigint("sale_type_category_id", { mode: "number" })
      .references(() => saleTypeCategories.id),

    is_active: boolean("is_active").default(true).notNull(),

    added_by: bigint("added_by", { mode: "number" })
      .references(() => users.id),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_rule_config_rule_type").on(table.rule_type),
    index("idx_rule_config_category").on(table.sale_type_category_id),
    index("idx_rule_config_active").on(table.is_active),
    index("idx_rule_config_dates").on(table.start_date, table.end_date),
    index("idx_rule_config_added_by").on(table.added_by),
    index("idx_rule_config_period").on(table.period_id),
  ]
);
