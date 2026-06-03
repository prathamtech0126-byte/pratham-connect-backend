/**
 * Imports incentive/rule configuration data from rule-data-export.json into the LIVE database.
 *
 * Usage (after running migrateIncentiveTables.ts, while DATABASE_URL points to LIVE db):
 *   ts-node src/scripts/importRuleData.ts
 *
 * Reads: rule-data-export.json from the project root.
 * Safe to re-run — uses ON CONFLICT DO NOTHING / UPDATE for idempotency.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

interface ExportData {
  exportedAt: string;
  incentive_slab_rules: any[];
  incentive_category_rules: any[];
  other_products: any[];
  periods: any[];
  rule_configuration: any[];
  rule_configuration_sale_types: any[];
  budget_rules: any[];
  slab_rules: any[];
}

function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  // Escape single quotes in strings
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function run() {
  const exportPath = path.join(process.cwd(), "rule-data-export.json");
  if (!fs.existsSync(exportPath)) {
    console.error(`Export file not found: ${exportPath}`);
    console.error("Run exportRuleData.ts against the local DB first.");
    process.exit(1);
  }

  const data: ExportData = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
  console.log(`Importing rule data exported at: ${data.exportedAt}\n`);

  // ── incentive_slab_rules (uuid PK) ──────────────────────────────────────
  let count = 0;
  for (const row of data.incentive_slab_rules) {
    await db.execute(sql.raw(`
      INSERT INTO incentive_slab_rules (id, rule_group, min_count, max_count, incentive_amount, sort_order, created_at, updated_at)
      VALUES (${esc(row.id)}, ${esc(row.rule_group)}, ${esc(row.min_count)}, ${esc(row.max_count)}, ${esc(row.incentive_amount)}, ${esc(row.sort_order)}, ${esc(row.created_at)}, ${esc(row.updated_at)})
      ON CONFLICT (id) DO UPDATE SET
        rule_group = EXCLUDED.rule_group,
        min_count = EXCLUDED.min_count,
        max_count = EXCLUDED.max_count,
        incentive_amount = EXCLUDED.incentive_amount,
        sort_order = EXCLUDED.sort_order,
        updated_at = EXCLUDED.updated_at
    `));
    count++;
  }
  console.log(`✓ incentive_slab_rules       : ${count} rows`);

  // ── incentive_category_rules (uuid PK) ──────────────────────────────────
  count = 0;
  for (const row of data.incentive_category_rules) {
    await db.execute(sql.raw(`
      INSERT INTO incentive_category_rules (id, rule_group, label, incentive_amount, sort_order, created_at, updated_at)
      VALUES (${esc(row.id)}, ${esc(row.rule_group)}, ${esc(row.label)}, ${esc(row.incentive_amount)}, ${esc(row.sort_order)}, ${esc(row.created_at)}, ${esc(row.updated_at)})
      ON CONFLICT (id) DO UPDATE SET
        rule_group = EXCLUDED.rule_group,
        label = EXCLUDED.label,
        incentive_amount = EXCLUDED.incentive_amount,
        sort_order = EXCLUDED.sort_order,
        updated_at = EXCLUDED.updated_at
    `));
    count++;
  }
  console.log(`✓ incentive_category_rules   : ${count} rows`);

  // ── other_products (serial PK) ──────────────────────────────────────────
  count = 0;
  for (const row of data.other_products) {
    await db.execute(sql.raw(`
      INSERT INTO other_products (id, product_id, name, category, product_name, form_type, description, is_active, display_order, metadata, created_at, updated_at)
      VALUES (${esc(row.id)}, ${esc(row.product_id)}, ${esc(row.name)}, ${esc(row.category)}, ${esc(row.product_name)}, ${esc(row.form_type)}, ${esc(row.description)}, ${esc(row.is_active)}, ${esc(row.display_order)}, ${esc(row.metadata)}, ${esc(row.created_at)}, ${esc(row.updated_at)})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        product_name = EXCLUDED.product_name,
        form_type = EXCLUDED.form_type,
        description = EXCLUDED.description,
        is_active = EXCLUDED.is_active,
        display_order = EXCLUDED.display_order,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `));
    count++;
  }
  // Reset serial sequence to avoid PK conflicts on future inserts
  if (data.other_products.length > 0) {
    const maxId = Math.max(...data.other_products.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('other_products_id_seq', ${maxId})`));
  }
  console.log(`✓ other_products             : ${count} rows`);

  // ── periods (bigserial PK) ──────────────────────────────────────────────
  count = 0;
  for (const row of data.periods) {
    await db.execute(sql.raw(`
      INSERT INTO periods (id, name, start_date, end_date, is_active, created_by, created_at)
      VALUES (${esc(row.id)}, ${esc(row.name)}, ${esc(row.start_date)}, ${esc(row.end_date)}, ${esc(row.is_active)}, ${esc(row.created_by)}, ${esc(row.created_at)})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        is_active = EXCLUDED.is_active
    `));
    count++;
  }
  if (data.periods.length > 0) {
    const maxId = Math.max(...data.periods.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('periods_id_seq', ${maxId})`));
  }
  console.log(`✓ periods                    : ${count} rows`);

  // ── rule_configuration (bigserial PK) ───────────────────────────────────
  count = 0;
  for (const row of data.rule_configuration) {
    const allFinanceJson = row.all_finance_sale_type_categories
      ? esc(JSON.stringify(row.all_finance_sale_type_categories))
      : "NULL";
    await db.execute(sql.raw(`
      INSERT INTO rule_configuration (id, name, rule_type, start_date, end_date, sale_type_category_id, is_active, added_by, created_at, period_id, description, min_budget_threshold, all_finance_sale_type_categories)
      VALUES (${esc(row.id)}, ${esc(row.name)}, ${esc(row.rule_type)}, ${esc(row.start_date)}, ${esc(row.end_date)}, ${esc(row.sale_type_category_id)}, ${esc(row.is_active)}, ${esc(row.added_by)}, ${esc(row.created_at)}, ${esc(row.period_id)}, ${esc(row.description)}, ${esc(row.min_budget_threshold)}, ${allFinanceJson})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        rule_type = EXCLUDED.rule_type,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        sale_type_category_id = EXCLUDED.sale_type_category_id,
        is_active = EXCLUDED.is_active,
        period_id = EXCLUDED.period_id,
        description = EXCLUDED.description,
        min_budget_threshold = EXCLUDED.min_budget_threshold,
        all_finance_sale_type_categories = EXCLUDED.all_finance_sale_type_categories
    `));
    count++;
  }
  if (data.rule_configuration.length > 0) {
    const maxId = Math.max(...data.rule_configuration.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('rule_configuration_id_seq', ${maxId})`));
  }
  console.log(`✓ rule_configuration         : ${count} rows`);

  // ── rule_configuration_sale_types (bigserial PK) ────────────────────────
  count = 0;
  for (const row of data.rule_configuration_sale_types) {
    await db.execute(sql.raw(`
      INSERT INTO rule_configuration_sale_types (id, rule_configuration_id, sale_type_id, other_product_id, created_at)
      VALUES (${esc(row.id)}, ${esc(row.rule_configuration_id)}, ${esc(row.sale_type_id)}, ${esc(row.other_product_id)}, ${esc(row.created_at)})
      ON CONFLICT (id) DO UPDATE SET
        rule_configuration_id = EXCLUDED.rule_configuration_id,
        sale_type_id = EXCLUDED.sale_type_id,
        other_product_id = EXCLUDED.other_product_id
    `));
    count++;
  }
  if (data.rule_configuration_sale_types.length > 0) {
    const maxId = Math.max(...data.rule_configuration_sale_types.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('rule_configuration_sale_types_id_seq', ${maxId})`));
  }
  console.log(`✓ rule_configuration_sale_types: ${count} rows`);

  // ── budget_rules (bigserial PK) ─────────────────────────────────────────
  count = 0;
  for (const row of data.budget_rules) {
    await db.execute(sql.raw(`
      INSERT INTO budget_rules (id, rule_configuration_id, budget_amount, incentive_amount, is_active, created_at, label)
      VALUES (${esc(row.id)}, ${esc(row.rule_configuration_id)}, ${esc(row.budget_amount)}, ${esc(row.incentive_amount)}, ${esc(row.is_active)}, ${esc(row.created_at)}, ${esc(row.label)})
      ON CONFLICT (id) DO UPDATE SET
        budget_amount = EXCLUDED.budget_amount,
        incentive_amount = EXCLUDED.incentive_amount,
        is_active = EXCLUDED.is_active,
        label = EXCLUDED.label
    `));
    count++;
  }
  if (data.budget_rules.length > 0) {
    const maxId = Math.max(...data.budget_rules.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('budget_rules_id_seq', ${maxId})`));
  }
  console.log(`✓ budget_rules               : ${count} rows`);

  // ── slab_rules (bigserial PK) ────────────────────────────────────────────
  count = 0;
  for (const row of data.slab_rules) {
    await db.execute(sql.raw(`
      INSERT INTO slab_rules (id, rule_configuration_id, min_slab, max_slab, incentive_amount, is_active, created_at)
      VALUES (${esc(row.id)}, ${esc(row.rule_configuration_id)}, ${esc(row.min_slab)}, ${esc(row.max_slab)}, ${esc(row.incentive_amount)}, ${esc(row.is_active)}, ${esc(row.created_at)})
      ON CONFLICT (id) DO UPDATE SET
        min_slab = EXCLUDED.min_slab,
        max_slab = EXCLUDED.max_slab,
        incentive_amount = EXCLUDED.incentive_amount,
        is_active = EXCLUDED.is_active
    `));
    count++;
  }
  if (data.slab_rules.length > 0) {
    const maxId = Math.max(...data.slab_rules.map((r) => Number(r.id)));
    await db.execute(sql.raw(`SELECT setval('slab_rules_id_seq', ${maxId})`));
  }
  console.log(`✓ slab_rules                 : ${count} rows`);

  console.log("\n=== Import complete ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("Import failed:", err?.message ?? err);
  process.exit(1);
});
