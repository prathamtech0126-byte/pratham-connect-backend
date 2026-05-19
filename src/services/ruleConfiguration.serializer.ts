/**
 * Rule configuration API ↔ persistence
 *
 * ## Enum mapping (DB `rule_type` = API `rule_type`)
 * - `slab` — count slabs only (`slab_rules`: min_slab, max_slab, incentive_amount; null max = open-ended).
 * - `budget` — amount tiers (`budget_rules`: budget_amount + incentive_amount; optional `label` for display).
 * - `budget_threshold_slab` — requires `min_budget_threshold` plus slab rows in `slab_rules` (budget gate, then team/count slabs).
 *
 * Aliases accepted on **input** only (normalized to DB values):
 * - `budget_threshold+slab`, `budget_threshold slab`, `BUDGET_SLAB` → `budget_threshold_slab`
 *
 * ## `sale_type_ids` mixed array
 * - Integer or numeric string → core `sale_type.id`.
 * - String `^op_(\\d+)$` → other product catalog id (stored as `op_<id>` in `rule_configuration_sale_types.other_product_id`).
 *
 * ## Manual smoke checklist (POST → GET)
 * 1. **slab-only**: `rule_type: "slab"`, `sale_type_ids: [1]`, `rules: [{ min_slab: 1, max_slab: 5, incentive_amount: 100 }]`
 * 2. **budget-only**: `rule_type: "budget"`, `rules: [{ label: "50000+", budget_amount: null, incentive_amount: 200 }]` — server derives `budget_amount` from label if omitted.
 * 3. **budget_threshold_slab**: `min_budget_threshold: 50000`, `all_finance_sale_type_categories: ["visitor","spouse"]`, slab `rules[]`.
 * 4. **Mixed ids**: `sale_type_ids: [1, 2, "op_15"]` — GET returns same mixed array plus `sale_type_names` / `other_products`.
 */

import type { OtherProduct } from "../schemas/otherProducts.schema";

export type DbRuleType = "budget" | "slab" | "budget_threshold_slab";
export type ApiRuleType = "slab" | "budget" | "budget_threshold_slab";

const ALLOWED_FINANCE_CATEGORIES = new Set(["spouse", "visitor", "student"]);

export function parseIncomingRuleType(raw: unknown): DbRuleType {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/\+/g, "_");
  if (s === "slab") return "slab";
  if (s === "budget") return "budget";
  if (s === "budget_threshold_slab") return "budget_threshold_slab";
  if (s.includes("budget_threshold") && s.includes("slab")) return "budget_threshold_slab";
  throw new Error(`Invalid rule_type: ${String(raw)}`);
}

/** Normalize finance category array (lowercase, unique, allowed set only). */
export function normalizeAllFinanceSaleTypeCategories(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new Error("all_finance_sale_type_categories must be an array or null");
  if (raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    const v = String(item).trim().toLowerCase();
    if (!ALLOWED_FINANCE_CATEGORIES.has(v)) {
      throw new Error(`Invalid all_finance_sale_type_categories entry "${item}" — allowed: spouse, visitor, student`);
    }
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : null;
}

export function toApiRuleType(db: DbRuleType): ApiRuleType {
  return db;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

export interface SlabRuleApiRow {
  min_slab: number;
  max_slab: number | null;
  label?: string | null;
  budget_amount?: number | null;
  incentive_amount: number;
}

export interface BudgetRuleApiRow {
  min_slab?: number | null;
  max_slab?: number | null;
  label?: string | null;
  budget_amount?: number | null;
  incentive_amount: number;
}

export function serializeSlabRulesForApi(
  rows: Array<{
    min_slab: unknown;
    max_slab: unknown | null;
    incentive_amount: unknown;
  }>
): SlabRuleApiRow[] {
  return rows.map((r) => ({
    min_slab: num(r.min_slab),
    max_slab: r.max_slab === null || r.max_slab === undefined ? null : num(r.max_slab),
    label: null,
    budget_amount: null,
    incentive_amount: num(r.incentive_amount),
  }));
}

export function serializeBudgetRulesForApi(
  rows: Array<{
    budget_amount: unknown;
    incentive_amount: unknown;
    label?: string | null;
  }>
): BudgetRuleApiRow[] {
  return rows.map((r) => {
    const amount = num(r.budget_amount);
    return {
      min_slab: null,
      max_slab: null,
      label: r.label != null && String(r.label).trim() !== "" ? String(r.label) : String(amount),
      budget_amount: amount,
      incentive_amount: num(r.incentive_amount),
    };
  });
}

export type RuleConfigurationRow = {
  id: number;
  period_id?: number | null;
  name: string;
  description?: string | null;
  rule_type: DbRuleType;
  start_date: string;
  end_date: string | null;
  min_budget_threshold?: string | null;
  all_finance_sale_type_categories?: string[] | null;
  sale_type_category_id?: number | null;
  is_active: boolean;
  added_by?: number | null;
  createdAt?: Date | null;
};

export function serializeRuleConfigurationResponse(args: {
  config: RuleConfigurationRow;
  saleTypeIds: number[];
  otherProductIds: string[];
  otherProducts: OtherProduct[];
  saleTypeNames: string[];
  rules: SlabRuleApiRow[] | BudgetRuleApiRow[];
}) {
  const { config, saleTypeIds, otherProductIds, otherProducts, saleTypeNames, rules } = args;

  const mixedSaleTypeIds: Array<number | string> = [
    ...[...saleTypeIds].sort((a, b) => a - b),
    ...[...otherProductIds].sort(),
  ];

  const apiRuleType = toApiRuleType(config.rule_type);
  const minTh = config.min_budget_threshold != null ? num(config.min_budget_threshold) : null;

  const description = config.description ?? null;

  return {
    id: config.id,
    period_id: config.period_id ?? null,
    name: config.name,
    description,
    rule_description: description,
    start_date: config.start_date,
    startDate: config.start_date,
    end_date: config.end_date,
    endDate: config.end_date,
    rule_type: apiRuleType,
    ruleType: apiRuleType,
    min_budget_threshold: minTh,
    minBudgetThreshold: minTh,
    all_finance_sale_type_categories: config.all_finance_sale_type_categories ?? null,
    allFinanceSaleTypeCategories: config.all_finance_sale_type_categories ?? null,
    all_finance_target_categories: config.all_finance_sale_type_categories ?? null,
    sale_type_ids: mixedSaleTypeIds,
    saleTypeIds: mixedSaleTypeIds,
    sale_type_names: saleTypeNames,
    saleTypeNames: saleTypeNames,
    other_products: otherProducts,
    otherProducts,
    rules,
    is_active: config.is_active,
    isActive: config.is_active,
    created_at: config.createdAt ?? null,
    createdAt: config.createdAt ?? null,
    sale_type_category_id: config.sale_type_category_id ?? null,
  };
}
