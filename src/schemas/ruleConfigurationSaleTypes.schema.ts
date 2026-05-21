import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ruleConfiguration } from "./ruleConfiguration.schema";
import { saleTypes } from "./saleType.schema";

export const ruleConfigurationSaleTypes = pgTable(
  "rule_configuration_sale_types",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rule_configuration_id: bigint("rule_configuration_id", { mode: "number" })
      .references(() => ruleConfiguration.id, { onDelete: "cascade" })
      .notNull(),
    // Exactly one of these two columns is non-null per row (enforced by CHECK constraint in DB).
    sale_type_id: bigint("sale_type_id", { mode: "number" })
      .references(() => saleTypes.saleTypeId, { onDelete: "cascade" }),
    other_product_id: varchar("other_product_id", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // Unique: one sale_type per config (NULLs are distinct in PG, so only non-null rows are constrained)
    uniqueIndex("uniq_rule_config_sale_type").on(
      table.rule_configuration_id,
      table.sale_type_id
    ),
    // Unique: one other_product per config
    uniqueIndex("uniq_rule_config_other_product").on(
      table.rule_configuration_id,
      table.other_product_id
    ),
    index("idx_rule_config_sale_types_config").on(table.rule_configuration_id),
    index("idx_rule_config_sale_types_sale_type").on(table.sale_type_id),
  ]
);
