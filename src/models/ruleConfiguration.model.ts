import { db } from "../config/databaseConnection";
import { ruleConfiguration } from "../schemas/ruleConfiguration.schema";
import { budgetRules } from "../schemas/budgetRules.schema";
import { slabRules } from "../schemas/slabRules.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { ruleConfigurationSaleTypes } from "../schemas/ruleConfigurationSaleTypes.schema";
import { otherProducts, type OtherProduct } from "../schemas/otherProducts.schema";
import { periods } from "../schemas/periods.schema";
import { eq, desc, and, ne, lte, gte, or, isNull, inArray } from "drizzle-orm";
import {
  serializeRuleConfigurationResponse,
  serializeSlabRulesForApi,
  serializeBudgetRulesForApi,
  normalizeAllFinanceSaleTypeCategories,
  type DbRuleType,
} from "../services/ruleConfiguration.serializer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BudgetRuleInput {
  budget_amount: number;
  incentive_amount: number;
  label?: string | null;
}

export interface SlabRuleInput {
  min_slab: number;
  max_slab: number | null;
  incentive_amount: number;
}

interface SlabRuleInputCountKeys {
  min_count: number;
  max_count: number | null;
  incentive_amount: number;
}

interface SlabRuleInputCamelKeys {
  minCount: number;
  maxCount: number | null;
  incentive_amount: number;
}

export interface CreateRuleConfigurationInput {
  name: string;
  rule_type: DbRuleType;
  start_date: string;
  end_date?: string | null;
  description?: string | null;
  min_budget_threshold?: number | null;
  all_finance_sale_type_categories?: string[] | null;
  sale_type_category_id?: number | null;
  sale_type_ids?: Array<number | string>;
  added_by: number;
  rules: unknown[];
}

export interface UpdateRuleConfigurationInput {
  name?: string;
  start_date?: string;
  end_date?: string | null;
  description?: string | null;
  min_budget_threshold?: number | null;
  all_finance_sale_type_categories?: string[] | null;
  sale_type_category_id?: number | null;
  sale_type_ids?: Array<number | string>;
  is_active?: boolean;
  rules?: unknown[];
}

export type RuleConfigurationWithRelations = NonNullable<Awaited<ReturnType<typeof fetchWithRules>>>;

// ── Validation ────────────────────────────────────────────────────────────────

function normalizeBudgetRulesFromPayload(rules: unknown[]): BudgetRuleInput[] {
  if (!Array.isArray(rules)) throw new Error("rules must be an array");
  return rules.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const incentive = Number(r.incentive_amount ?? r.incentiveAmount);
    if (!Number.isFinite(incentive)) {
      throw new Error(`Rule ${i + 1}: incentive_amount is required and must be a number`);
    }
    let budget_amount = r.budget_amount as number | string | null | undefined;
    if (budget_amount === "" || budget_amount === undefined || budget_amount === null) {
      const label = String(r.label ?? "");
      const parsed = parseFloat(label.replace(/[^0-9.]/g, ""));
      if (Number.isNaN(parsed)) {
        throw new Error(`Rule ${i + 1}: provide budget_amount or a label containing a numeric threshold`);
      }
      budget_amount = parsed;
    } else {
      budget_amount = Number(budget_amount);
      if (!Number.isFinite(budget_amount)) {
        throw new Error(`Rule ${i + 1}: budget_amount must be a number`);
      }
    }
    const label = r.label != null && String(r.label).trim() !== "" ? String(r.label) : null;
    return {
      budget_amount: budget_amount as number,
      incentive_amount: incentive,
      label,
    };
  });
}

function validateBudgetRules(rules: BudgetRuleInput[]) {
  if (rules.length === 0) return;

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (typeof r.incentive_amount !== "number" || Number.isNaN(r.incentive_amount)) {
      throw new Error(`Rule ${i + 1}: incentive_amount is required and must be a number`);
    }
  }

  const amounts = rules.map((r) => r.budget_amount);
  const unique = new Set(amounts);
  if (unique.size !== amounts.length) {
    throw new Error("budget_amount values must be unique — duplicates found");
  }

  for (let i = 1; i < amounts.length; i++) {
    if (amounts[i] <= amounts[i - 1]) {
      throw new Error(
        `budget_amount must be in strictly ascending order — ${amounts[i]} is not greater than ${amounts[i - 1]}`
      );
    }
  }
}

function validateSlabRules(rules: SlabRuleInput[]) {
  if (rules.length === 0) return;

  const aboveCount = rules.filter((r) => r.max_slab === null).length;
  if (aboveCount > 1) {
    throw new Error('Only one slab can have "& Above" (null max_slab)');
  }

  for (const r of rules) {
    if (r.max_slab !== null && r.min_slab >= r.max_slab) {
      throw new Error(`min_slab (${r.min_slab}) must be less than max_slab (${r.max_slab})`);
    }
    if (r.min_slab < 0) {
      throw new Error(`min_slab cannot be negative (got ${r.min_slab})`);
    }
  }

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      const aOverlapsB =
        a.min_slab <= (b.max_slab ?? Infinity) && b.min_slab <= (a.max_slab ?? Infinity);
      if (aOverlapsB) {
        throw new Error(
          `Slab ranges overlap: [${a.min_slab}, ${a.max_slab ?? "∞"}] and [${b.min_slab}, ${b.max_slab ?? "∞"}]`
        );
      }
    }
  }
}

function normalizeSlabRules(
  rules: SlabRuleInput[] | SlabRuleInputCountKeys[] | SlabRuleInputCamelKeys[]
) {
  const toNullableNumber = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid slab value: ${String(value)}`);
    }
    return parsed;
  };

  return rules.map((rule) => {
    const r = rule as SlabRuleInput & SlabRuleInputCountKeys & SlabRuleInputCamelKeys;
    const rawMin = r.min_slab ?? r.min_count ?? r.minCount;
    const rawMax = r.max_slab ?? r.max_count ?? r.maxCount ?? null;
    const min_slab = toNullableNumber(rawMin);
    const max_slab = toNullableNumber(rawMax);
    if (min_slab === undefined || min_slab === null) {
      throw new Error("Each slab rule must include min_slab or min_count");
    }
    return {
      min_slab,
      max_slab,
      incentive_amount: r.incentive_amount,
    };
  });
}

function toDbDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

async function validateDateOverlap(
  name: string,
  rule_type: DbRuleType,
  sale_type_category_id: number | null | undefined,
  start_date: string,
  end_date: string | null | undefined,
  excludeId?: number
) {
  if (!sale_type_category_id) return;

  const existing = await db
    .select({ id: ruleConfiguration.id, start_date: ruleConfiguration.start_date, end_date: ruleConfiguration.end_date })
    .from(ruleConfiguration)
    .where(
      and(
        eq(ruleConfiguration.name, name),
        eq(ruleConfiguration.rule_type, rule_type),
        eq(ruleConfiguration.sale_type_category_id, sale_type_category_id),
        eq(ruleConfiguration.is_active, true),
        excludeId ? ne(ruleConfiguration.id, excludeId) : undefined,
        end_date ? lte(ruleConfiguration.start_date, end_date) : undefined,
        or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, start_date))
      )
    );

  if (existing.length > 0) {
    throw new Error(
      `A rule configuration named "${name}" already exists for this category and overlaps the selected date range`
    );
  }
}

async function validateIdDateOverlap(
  start_date: string,
  end_date: string | null | undefined,
  saleTypeIds: number[],
  excludeId?: number,
  /** When set, only treat mappings on other rules in the same sale-type category as conflicts. */
  sale_type_category_id?: number | null
) {
  if (saleTypeIds.length === 0) return;

  const categoryScope =
    typeof sale_type_category_id === "number"
      ? eq(ruleConfiguration.sale_type_category_id, sale_type_category_id)
      : undefined;

  const dateWhere = () =>
    and(
      eq(ruleConfiguration.is_active, true),
      excludeId ? ne(ruleConfiguration.id, excludeId) : undefined,
      end_date ? lte(ruleConfiguration.start_date, end_date) : undefined,
      or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, start_date)),
      categoryScope
    );

  const conflicts = await db
    .select({
      sale_type_id: ruleConfigurationSaleTypes.sale_type_id,
      config_name: ruleConfiguration.name,
    })
    .from(ruleConfigurationSaleTypes)
    .innerJoin(
      ruleConfiguration,
      eq(ruleConfigurationSaleTypes.rule_configuration_id, ruleConfiguration.id)
    )
    .where(and(inArray(ruleConfigurationSaleTypes.sale_type_id, saleTypeIds), dateWhere()));

  if (conflicts.length > 0) {
    const ids = [...new Set(conflicts.map((c) => c.sale_type_id))].join(", ");
    const names = [...new Set(conflicts.map((c) => c.config_name))].join('", "');
    throw new Error(
      `Sale type ID(s) [${ids}] are already assigned to rule "${names}" in the overlapping date range`
    );
  }
}

async function assertOtherProductsExist(opIds: string[]) {
  if (opIds.length === 0) return;
  const nums = [...new Set(opIds.map((s) => Number(String(s).replace(/^op_/, ""))).filter((n) => Number.isFinite(n) && n > 0))];
  if (nums.length === 0) return;
  const rows = await db.select({ id: otherProducts.id }).from(otherProducts).where(inArray(otherProducts.id, nums));
  if (rows.length !== nums.length) {
    throw new Error("One or more other product ids (op_*) do not exist in other_products");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchOtherProductsByOpIds(opIds: string[]): Promise<OtherProduct[]> {
  if (opIds.length === 0) return [];
  const numericIds = opIds
    .map((s) => Number(s.replace(/^op_/, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numericIds.length === 0) return [];
  return db.select().from(otherProducts).where(inArray(otherProducts.id, numericIds));
}

async function fetchWithRules(configId: number) {
  const [config] = await db
    .select()
    .from(ruleConfiguration)
    .where(eq(ruleConfiguration.id, configId));

  if (!config) return null;

  let sale_type_ids: number[] = [];
  let other_product_ids: string[] = [];
  const mappedRows = await db
    .select({
      sale_type_id: ruleConfigurationSaleTypes.sale_type_id,
      other_product_id: ruleConfigurationSaleTypes.other_product_id,
    })
    .from(ruleConfigurationSaleTypes)
    .where(eq(ruleConfigurationSaleTypes.rule_configuration_id, configId));

  if (mappedRows.length > 0) {
    sale_type_ids = mappedRows.map((r) => r.sale_type_id).filter((id): id is number => id !== null);
    other_product_ids = mappedRows.map((r) => r.other_product_id).filter((id): id is string => id !== null);
  } else if (config.sale_type_category_id) {
    const saleTypeRows = await db
      .select({ id: saleTypes.saleTypeId })
      .from(saleTypes)
      .where(eq(saleTypes.categoryId, config.sale_type_category_id));
    sale_type_ids = saleTypeRows.map((row) => row.id);
  }

  const other_products = await fetchOtherProductsByOpIds(other_product_ids);

  if (config.rule_type === "budget") {
    const rules = await db
      .select()
      .from(budgetRules)
      .where(eq(budgetRules.rule_configuration_id, configId));
    return { ...config, sale_type_ids, other_product_ids, other_products, rules };
  }

  const rules = await db
    .select()
    .from(slabRules)
    .where(eq(slabRules.rule_configuration_id, configId));
  return { ...config, sale_type_ids, other_product_ids, other_products, rules };
}

async function resolveSaleTypeCategoryId(
  sale_type_category_id?: number | null,
  sale_type_ids?: Array<number | string>
) {
  if (sale_type_category_id !== undefined) return sale_type_category_id ?? null;
  if (!sale_type_ids || sale_type_ids.length === 0) return null;

  const { saleTypeIds: normalizedSaleTypeIds } = splitIdsFromMixed(sale_type_ids);
  if (normalizedSaleTypeIds.length === 0) return null;

  const rows = await db
    .select({ id: saleTypes.saleTypeId, categoryId: saleTypes.categoryId })
    .from(saleTypes)
    .where(inArray(saleTypes.saleTypeId, normalizedSaleTypeIds));

  if (rows.length !== normalizedSaleTypeIds.length) {
    throw new Error("Some sale_type_ids are invalid");
  }

  const categoryIds = new Set(rows.map((row) => row.categoryId).filter((id): id is number => id !== null));
  if (categoryIds.size === 1) return [...categoryIds][0];
  return null;
}

async function syncRuleConfigurationSaleTypes(
  tx: { delete: any; insert: any },
  ruleConfigurationId: number,
  ids: Array<number | string>
) {
  const { saleTypeIds, otherProductIds } = splitIdsFromMixed(ids);

  await tx
    .delete(ruleConfigurationSaleTypes)
    .where(eq(ruleConfigurationSaleTypes.rule_configuration_id, ruleConfigurationId));

  const rows: Array<{ rule_configuration_id: number; sale_type_id: number | null; other_product_id: string | null }> = [
    ...saleTypeIds.map((id) => ({ rule_configuration_id: ruleConfigurationId, sale_type_id: id, other_product_id: null })),
    ...otherProductIds.map((id) => ({ rule_configuration_id: ruleConfigurationId, sale_type_id: null, other_product_id: id })),
  ];

  if (rows.length > 0) {
    await tx.insert(ruleConfigurationSaleTypes).values(rows);
  }
}

function splitIdsFromMixed(ids: Array<number | string>): { saleTypeIds: number[]; otherProductIds: string[] } {
  const saleTypeIds: number[] = [];
  const otherProductIds: string[] = [];

  for (const raw of ids) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      saleTypeIds.push(raw);
      continue;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^\d+$/.test(trimmed)) {
        saleTypeIds.push(Number(trimmed));
        continue;
      }
      const opMatch = trimmed.match(/^op_(\d+)$/i);
      if (opMatch) {
        otherProductIds.push(`op_${opMatch[1]}`);
        continue;
      }
    }
    throw new Error(`Invalid sale_type_id: ${String(raw)}`);
  }

  return {
    saleTypeIds: [...new Set(saleTypeIds)],
    otherProductIds: [...new Set(otherProductIds)],
  };
}

async function saleTypeDisplayNames(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ saleTypeId: saleTypes.saleTypeId, saleType: saleTypes.saleType })
    .from(saleTypes)
    .where(inArray(saleTypes.saleTypeId, ids));
  const byId = new Map(rows.map((r) => [r.saleTypeId, r.saleType]));
  return ids.map((id) => byId.get(id) ?? `sale_type:${id}`);
}

export async function formatRuleConfigForApi(row: RuleConfigurationWithRelations) {
  const rulesOut =
    row.rule_type === "budget"
      ? serializeBudgetRulesForApi(row.rules as Parameters<typeof serializeBudgetRulesForApi>[0])
      : serializeSlabRulesForApi(row.rules as Parameters<typeof serializeSlabRulesForApi>[0]);

  const saleTypeNames = await saleTypeDisplayNames(row.sale_type_ids);

  return serializeRuleConfigurationResponse({
    config: {
      id: row.id,
      period_id: (row as { period_id?: number | null }).period_id ?? null,
      name: row.name,
      description: (row as { description?: string | null }).description ?? null,
      rule_type: row.rule_type as DbRuleType,
      start_date: String(row.start_date),
      end_date: row.end_date ? String(row.end_date) : null,
      min_budget_threshold: (row as { min_budget_threshold?: string | null }).min_budget_threshold ?? null,
      all_finance_sale_type_categories:
        (row as { all_finance_sale_type_categories?: string[] | null }).all_finance_sale_type_categories ?? null,
      sale_type_category_id: row.sale_type_category_id,
      is_active: row.is_active,
      added_by: row.added_by,
      createdAt: row.createdAt ?? null,
    },
    saleTypeIds: row.sale_type_ids,
    otherProductIds: row.other_product_ids,
    otherProducts: row.other_products,
    saleTypeNames,
    rules: rulesOut,
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

export const getAllRuleConfigurations = async () => {
  const configs = await db
    .select()
    .from(ruleConfiguration)
    .orderBy(desc(ruleConfiguration.createdAt));

  const rows = await Promise.all(
    configs.map(async (config) => {
      let sale_type_ids: number[] = [];
      let other_product_ids: string[] = [];
      const mappedRows = await db
        .select({
          sale_type_id: ruleConfigurationSaleTypes.sale_type_id,
          other_product_id: ruleConfigurationSaleTypes.other_product_id,
        })
        .from(ruleConfigurationSaleTypes)
        .where(eq(ruleConfigurationSaleTypes.rule_configuration_id, config.id));

      if (mappedRows.length > 0) {
        sale_type_ids = mappedRows.map((r) => r.sale_type_id).filter((id): id is number => id !== null);
        other_product_ids = mappedRows.map((r) => r.other_product_id).filter((id): id is string => id !== null);
      } else if (config.sale_type_category_id) {
        const saleTypeRows = await db
          .select({ id: saleTypes.saleTypeId })
          .from(saleTypes)
          .where(eq(saleTypes.categoryId, config.sale_type_category_id));
        sale_type_ids = saleTypeRows.map((row) => row.id);
      }

      const other_products = await fetchOtherProductsByOpIds(other_product_ids);

      if (config.rule_type === "budget") {
        const rules = await db
          .select()
          .from(budgetRules)
          .where(eq(budgetRules.rule_configuration_id, config.id));
        return { ...config, sale_type_ids, other_product_ids, other_products, rules };
      }
      const rules = await db
        .select()
        .from(slabRules)
        .where(eq(slabRules.rule_configuration_id, config.id));
      return { ...config, sale_type_ids, other_product_ids, other_products, rules };
    })
  );

  return Promise.all(rows.map((r) => formatRuleConfigForApi(r as RuleConfigurationWithRelations)));
};

export const getRuleConfigurationById = async (id: number) => {
  const row = await fetchWithRules(id);
  if (!row) return null;
  return formatRuleConfigForApi(row as RuleConfigurationWithRelations);
};

export const createRuleConfiguration = async (input: CreateRuleConfigurationInput) => {
  const {
    name,
    rule_type,
    start_date,
    end_date,
    sale_type_category_id,
    sale_type_ids,
    added_by,
    rules,
    description,
    min_budget_threshold,
    all_finance_sale_type_categories,
  } = input;

  const financeCats = normalizeAllFinanceSaleTypeCategories(all_finance_sale_type_categories);

  if (rule_type === "budget_threshold_slab") {
    if (min_budget_threshold === undefined || min_budget_threshold === null || Number.isNaN(Number(min_budget_threshold))) {
      throw new Error("min_budget_threshold is required for budget_threshold_slab");
    }
    if (Number(min_budget_threshold) < 0) {
      throw new Error("min_budget_threshold must be non-negative");
    }
  }

  const resolvedSaleTypeCategoryId = await resolveSaleTypeCategoryId(sale_type_category_id, sale_type_ids);

  let normalizedBudget: BudgetRuleInput[] | undefined;
  let normalizedSlab: SlabRuleInput[] | undefined;

  if (rule_type === "budget") {
    normalizedBudget = normalizeBudgetRulesFromPayload(rules);
    validateBudgetRules(normalizedBudget);
  } else {
    normalizedSlab = normalizeSlabRules(
      rules as SlabRuleInput[] | SlabRuleInputCountKeys[] | SlabRuleInputCamelKeys[]
    );
    validateSlabRules(normalizedSlab);
  }

  await validateDateOverlap(name, rule_type, resolvedSaleTypeCategoryId, start_date, end_date);

  if (sale_type_ids && sale_type_ids.length > 0) {
    const { saleTypeIds, otherProductIds } = splitIdsFromMixed(sale_type_ids);
    await assertOtherProductsExist(otherProductIds);
    await validateIdDateOverlap(start_date, end_date, saleTypeIds, undefined, resolvedSaleTypeCategoryId);
  }

  const configId = await db.transaction(async (tx) => {
    const [period] = await tx
      .insert(periods)
      .values({
        name,
        start_date,
        end_date: end_date ?? null,
        is_active: true,
        created_by: added_by,
      })
      .returning({ id: periods.id });

    const [inserted] = await tx
      .insert(ruleConfiguration)
      .values({
        period_id: period.id,
        name,
        description: description ?? null,
        rule_type,
        start_date,
        end_date: end_date ?? null,
        min_budget_threshold:
          rule_type === "budget_threshold_slab" && min_budget_threshold != null
            ? String(min_budget_threshold)
            : null,
        all_finance_sale_type_categories: financeCats,
        sale_type_category_id: resolvedSaleTypeCategoryId,
        added_by,
        is_active: true,
      })
      .returning({ id: ruleConfiguration.id });

    if (rule_type === "budget" && normalizedBudget && normalizedBudget.length > 0) {
      await tx.insert(budgetRules).values(
        normalizedBudget.map((r) => ({
          rule_configuration_id: inserted.id,
          budget_amount: String(r.budget_amount),
          incentive_amount: String(r.incentive_amount),
          label: r.label ?? null,
          is_active: true,
        }))
      );
    } else if (normalizedSlab && normalizedSlab.length > 0) {
      await tx.insert(slabRules).values(
        normalizedSlab.map((r) => ({
          rule_configuration_id: inserted.id,
          min_slab: String(r.min_slab),
          max_slab: toDbDecimal(r.max_slab),
          incentive_amount: String(r.incentive_amount),
          is_active: true,
        }))
      );
    }

    if (sale_type_ids !== undefined) {
      await syncRuleConfigurationSaleTypes(tx, inserted.id, sale_type_ids);
    }

    return inserted.id;
  });

  const row = await fetchWithRules(configId);
  if (!row) throw new Error("Failed to load created rule configuration");
  return formatRuleConfigForApi(row as RuleConfigurationWithRelations);
};

export const updateRuleConfiguration = async (
  id: number,
  input: UpdateRuleConfigurationInput,
  rule_type: DbRuleType,
  currentConfig: {
    name: string;
    start_date: string;
    end_date: string | null;
    sale_type_category_id: number | null;
    period_id?: number | null;
  }
) => {
  const { rules, sale_type_ids, ...rest } = input;
  const configFields = { ...rest } as Record<string, unknown>;

  const resolvedSaleTypeCategoryId = await resolveSaleTypeCategoryId(
    configFields.sale_type_category_id as number | null | undefined,
    sale_type_ids
  );
  if (sale_type_ids !== undefined || configFields.sale_type_category_id !== undefined) {
    configFields.sale_type_category_id = resolvedSaleTypeCategoryId;
  }

  if (configFields.all_finance_sale_type_categories !== undefined) {
    configFields.all_finance_sale_type_categories = normalizeAllFinanceSaleTypeCategories(
      configFields.all_finance_sale_type_categories
    );
  }

  if (rule_type === "budget_threshold_slab" && configFields.min_budget_threshold === null) {
    throw new Error("min_budget_threshold cannot be null for budget_threshold_slab");
  }
  if (configFields.min_budget_threshold !== undefined && configFields.min_budget_threshold !== null) {
    configFields.min_budget_threshold = String(configFields.min_budget_threshold);
  } else if (configFields.min_budget_threshold === null) {
    configFields.min_budget_threshold = null;
  }

  let normalizedBudget: BudgetRuleInput[] | undefined;
  let normalizedSlab: SlabRuleInput[] | undefined;
  if (rules !== undefined) {
    if (rule_type === "budget") {
      normalizedBudget = normalizeBudgetRulesFromPayload(rules);
      validateBudgetRules(normalizedBudget);
    } else {
      normalizedSlab = normalizeSlabRules(
        rules as SlabRuleInput[] | SlabRuleInputCountKeys[] | SlabRuleInputCamelKeys[]
      );
      validateSlabRules(normalizedSlab);
    }
  }

  if (rule_type === "budget_threshold_slab") {
    const eff =
      configFields.min_budget_threshold !== undefined
        ? Number(configFields.min_budget_threshold)
        : await db
            .select({ v: ruleConfiguration.min_budget_threshold })
            .from(ruleConfiguration)
            .where(eq(ruleConfiguration.id, id))
            .then((r) => (r[0]?.v != null ? Number(r[0].v) : NaN));
    if (!Number.isFinite(eff) || eff < 0) {
      throw new Error("min_budget_threshold is required for budget_threshold_slab");
    }
  }

  const effectiveName = (configFields.name as string | undefined) ?? currentConfig.name;
  const effectiveStart = (configFields.start_date as string | undefined) ?? currentConfig.start_date;
  const effectiveEnd =
    "end_date" in configFields ? (configFields.end_date as string | null | undefined) : currentConfig.end_date;
  const effectiveCategory =
    "sale_type_category_id" in configFields
      ? (configFields.sale_type_category_id as number | null)
      : currentConfig.sale_type_category_id;

  await validateDateOverlap(effectiveName, rule_type, effectiveCategory, effectiveStart, effectiveEnd, id);

  {
    let idsToValidate: Array<number | string> = [];
    if (sale_type_ids !== undefined) {
      idsToValidate = sale_type_ids;
    } else if (configFields.start_date !== undefined || "end_date" in configFields) {
      const currentRows = await db
        .select({
          sale_type_id: ruleConfigurationSaleTypes.sale_type_id,
          other_product_id: ruleConfigurationSaleTypes.other_product_id,
        })
        .from(ruleConfigurationSaleTypes)
        .where(eq(ruleConfigurationSaleTypes.rule_configuration_id, id));
      idsToValidate = [
        ...currentRows.map((r) => r.sale_type_id).filter((x): x is number => x !== null),
        ...currentRows.map((r) => r.other_product_id).filter((x): x is string => x !== null),
      ];
    }
    if (idsToValidate.length > 0) {
      const { saleTypeIds, otherProductIds } = splitIdsFromMixed(idsToValidate);
      await assertOtherProductsExist(otherProductIds);
      await validateIdDateOverlap(effectiveStart, effectiveEnd, saleTypeIds, id, effectiveCategory);
    }
  }

  await db.transaction(async (tx) => {
    const periodId = currentConfig.period_id;
    if (periodId) {
      const pUp: {
        name?: string;
        start_date?: string;
        end_date?: string | null;
        is_active?: boolean;
      } = {};
      if (configFields.name !== undefined) pUp.name = configFields.name as string;
      if (configFields.start_date !== undefined) pUp.start_date = configFields.start_date as string;
      if ("end_date" in configFields) pUp.end_date = (configFields.end_date as string | null) ?? null;
      if (configFields.is_active !== undefined) pUp.is_active = Boolean(configFields.is_active);
      if (Object.keys(pUp).length > 0) {
        await tx.update(periods).set(pUp).where(eq(periods.id, periodId));
      }
    }

    const drizzleTx = tx as any;

    const updatePayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(configFields)) {
      if (v !== undefined) updatePayload[k] = v;
    }
    if (Object.keys(updatePayload).length > 0) {
      await drizzleTx.update(ruleConfiguration).set(updatePayload as any).where(eq(ruleConfiguration.id, id));
    }

    if (sale_type_ids !== undefined) {
      await syncRuleConfigurationSaleTypes(drizzleTx, id, sale_type_ids);
    }

    if (normalizedBudget !== undefined || normalizedSlab !== undefined) {
      if (rule_type === "budget") {
        await tx.delete(slabRules).where(eq(slabRules.rule_configuration_id, id));
        await tx.delete(budgetRules).where(eq(budgetRules.rule_configuration_id, id));
        if (normalizedBudget && normalizedBudget.length > 0) {
          await tx.insert(budgetRules).values(
            normalizedBudget.map((r) => ({
              rule_configuration_id: id,
              budget_amount: String(r.budget_amount),
              incentive_amount: String(r.incentive_amount),
              label: r.label ?? null,
              is_active: true,
            }))
          );
        }
      } else {
        await tx.delete(budgetRules).where(eq(budgetRules.rule_configuration_id, id));
        await tx.delete(slabRules).where(eq(slabRules.rule_configuration_id, id));
        if (normalizedSlab && normalizedSlab.length > 0) {
          await tx.insert(slabRules).values(
            normalizedSlab.map((r) => ({
              rule_configuration_id: id,
              min_slab: String(r.min_slab),
              max_slab: toDbDecimal(r.max_slab),
              incentive_amount: String(r.incentive_amount),
              is_active: true,
            }))
          );
        }
      }
    }
  });

  const row = await fetchWithRules(id);
  if (!row) throw new Error("Rule configuration not found after update");
  return formatRuleConfigForApi(row as RuleConfigurationWithRelations);
};
