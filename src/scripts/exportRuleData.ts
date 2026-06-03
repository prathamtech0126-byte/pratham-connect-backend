/**
 * Exports all incentive/rule configuration data from the LOCAL database to a JSON file.
 *
 * Usage (while DATABASE_URL points to LOCAL db):
 *   ts-node src/scripts/exportRuleData.ts
 *
 * Output: rule-data-export.json  (in the project root)
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Exporting rule/incentive data from local database...\n");

  const [
    slabRules,
    categoryRules,
    otherProducts,
    periods,
    ruleConfigurations,
    ruleConfigSaleTypes,
    budgetRules,
    slabRulesConfig,
  ] = await Promise.all([
    db.execute(sql`SELECT * FROM incentive_slab_rules ORDER BY rule_group, sort_order`),
    db.execute(sql`SELECT * FROM incentive_category_rules ORDER BY rule_group, sort_order`),
    db.execute(sql`SELECT * FROM other_products ORDER BY id`),
    db.execute(sql`SELECT * FROM periods ORDER BY id`),
    db.execute(sql`SELECT * FROM rule_configuration ORDER BY id`),
    db.execute(sql`SELECT * FROM rule_configuration_sale_types ORDER BY id`),
    db.execute(sql`SELECT * FROM budget_rules ORDER BY id`),
    db.execute(sql`SELECT * FROM slab_rules ORDER BY id`),
  ]);

  const data = {
    exportedAt: new Date().toISOString(),
    incentive_slab_rules: slabRules.rows,
    incentive_category_rules: categoryRules.rows,
    other_products: otherProducts.rows,
    periods: periods.rows,
    rule_configuration: ruleConfigurations.rows,
    rule_configuration_sale_types: ruleConfigSaleTypes.rows,
    budget_rules: budgetRules.rows,
    slab_rules: slabRulesConfig.rows,
  };

  const outPath = path.join(process.cwd(), "rule-data-export.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`✓ incentive_slab_rules       : ${slabRules.rows.length} rows`);
  console.log(`✓ incentive_category_rules   : ${categoryRules.rows.length} rows`);
  console.log(`✓ other_products             : ${otherProducts.rows.length} rows`);
  console.log(`✓ periods                    : ${periods.rows.length} rows`);
  console.log(`✓ rule_configuration         : ${ruleConfigurations.rows.length} rows`);
  console.log(`✓ rule_configuration_sale_types: ${ruleConfigSaleTypes.rows.length} rows`);
  console.log(`✓ budget_rules               : ${budgetRules.rows.length} rows`);
  console.log(`✓ slab_rules                 : ${slabRulesConfig.rows.length} rows`);
  console.log(`\nExport written to: ${outPath}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Export failed:", err?.message ?? err);
  process.exit(1);
});
