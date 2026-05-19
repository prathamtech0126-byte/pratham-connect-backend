import { db } from "../config/databaseConnection";
import { incentiveSlabRules } from "../schemas/incentiveSlabRules.schema";
import { incentiveCategoryRules } from "../schemas/incentiveCategoryRules.schema";
import { ruleConfiguration } from "../schemas/ruleConfiguration.schema";
import { slabRules } from "../schemas/slabRules.schema";
import { budgetRules } from "../schemas/budgetRules.schema";
import { ruleConfigurationSaleTypes } from "../schemas/ruleConfigurationSaleTypes.schema";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { otherProducts } from "../schemas/otherProducts.schema";
import { eq, inArray, asc, and, lte, gte, isNull, isNotNull, or } from "drizzle-orm";

export interface RangeRuleItem {
  id: string;
  minCount: number;
  maxCount: number;
  incentiveAmount: number;
}

export interface CategoryRuleItem {
  id: string;
  label: string;
  incentiveAmount: number;
}

export interface IncentiveRulesPayload {
  coreSpouseRules: RangeRuleItem[];
  financeSpouseRules: RangeRuleItem[];
  coreVisitorRules: CategoryRuleItem[];
  visitorProductRules: CategoryRuleItem[];
  canadaStudentRules: RangeRuleItem[];
  studentRules: RangeRuleItem[];
  allFinanceRules: RangeRuleItem[];
  // Budget-wise per-client all-finance rules (≥ threshold → incentive per client)
  allFinanceBudgetRules: CategoryRuleItem[];
}

const toRangeItem = (row: typeof incentiveSlabRules.$inferSelect): RangeRuleItem => ({
  id: row.id,
  minCount: row.min_count,
  maxCount: row.max_count,
  incentiveAmount: row.incentive_amount,
});

const toCategoryItem = (row: typeof incentiveCategoryRules.$inferSelect): CategoryRuleItem => ({
  id: row.id,
  label: row.label,
  incentiveAmount: row.incentive_amount,
});

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  return 0;
}

function toRangeRule(
  id: string,
  minValue: unknown,
  maxValue: unknown,
  incentiveValue: unknown
): RangeRuleItem {
  return {
    id,
    minCount: toNumber(minValue),
    maxCount: maxValue === null ? -1 : toNumber(maxValue),
    incentiveAmount: toNumber(incentiveValue),
  };
}

function toCategoryRule(id: string, label: string, incentiveValue: unknown): CategoryRuleItem {
  return {
    id,
    label,
    incentiveAmount: toNumber(incentiveValue),
  };
}

function budgetTierLabel(row: { budget_amount: unknown; label?: string | null }): string {
  if (row.label != null && String(row.label).trim() !== "") return String(row.label);
  return String(toNumber(row.budget_amount));
}

function emptyPayload(): IncentiveRulesPayload {
  return {
    coreSpouseRules: [],
    financeSpouseRules: [],
    coreVisitorRules: [],
    visitorProductRules: [],
    canadaStudentRules: [],
    studentRules: [],
    allFinanceRules: [],
    allFinanceBudgetRules: [],
  };
}

export interface RuleConfigEntry {
  configId: number;
  name: string;
  ruleType: "slab" | "budget" | "budget_threshold_slab";
  /** When ruleType is budget_threshold_slab: minimum amount before slab tiers apply. */
  minBudgetThreshold?: number | null;
  /**
   * Optional scope for All Finance line rules: which sale-type categories this config targets
   * (`visitor` | `spouse` | `student`, case-insensitive). When empty/null, name-based inference is used.
   */
  allFinanceSaleTypeCategories?: string[] | null;
  slabRules: RangeRuleItem[];
  budgetRules: CategoryRuleItem[];
}

export type SaleTypeRuleMap = Map<number, RuleConfigEntry>;

/** Rule configs keyed by `op_<id>` from `rule_configuration_sale_types.other_product_id`. */
export type OtherProductRuleMap = Map<string, RuleConfigEntry>;

/** Name match for "All Finance & Employment" (and similar) product-line rules. */
export function matchesAllFinanceLineRuleName(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("all finance")) return true;
  if (n.includes("finance") && n.includes("employment")) return true;
  return false;
}

/**
 * All Finance product line: separate from core sale / visitor.
 * Supports legacy budget tiers (`budget`) and Budget + Slab (`budget_threshold_slab`).
 */
export function isAllFinanceLineBudgetConfig(entry: RuleConfigEntry): boolean {
  if (entry.ruleType !== "budget" && entry.ruleType !== "budget_threshold_slab") return false;
  return matchesAllFinanceLineRuleName(entry.name);
}

/** First matching All Finance line config in the sale-type map (deduped by configId). Prefers Budget+Slab over budget-only. */
export function findAllFinanceBudgetRuleEntry(saleTypeRuleMap: SaleTypeRuleMap): RuleConfigEntry | undefined {
  const seen = new Set<number>();
  let budgetThresholdSlab: RuleConfigEntry | undefined;
  let budgetOnly: RuleConfigEntry | undefined;
  for (const entry of saleTypeRuleMap.values()) {
    if (seen.has(entry.configId)) continue;
    seen.add(entry.configId);
    if (!isAllFinanceLineBudgetConfig(entry)) continue;
    if (entry.ruleType === "budget_threshold_slab") budgetThresholdSlab = entry;
    else budgetOnly = entry;
  }
  return budgetThresholdSlab ?? budgetOnly;
}

/** All distinct All Finance product-line configs referenced by the sale-type map. */
export function collectAllFinanceRuleEntriesFromSaleTypeMap(saleTypeRuleMap: SaleTypeRuleMap): RuleConfigEntry[] {
  const seen = new Set<number>();
  const out: RuleConfigEntry[] = [];
  for (const entry of saleTypeRuleMap.values()) {
    if (seen.has(entry.configId)) continue;
    if (!isAllFinanceLineBudgetConfig(entry)) continue;
    seen.add(entry.configId);
    out.push(entry);
  }
  return out;
}

function inferCategoriesFromAllFinanceRuleName(name: string): Set<string> | null {
  const n = name.toLowerCase();
  const tags = new Set<string>();
  if (/\bvisitor\b/.test(n)) tags.add("visitor");
  if (/\bspouse\b/.test(n)) tags.add("spouse");
  if (/\bstudent\b/.test(n)) tags.add("student");
  return tags.size > 0 ? tags : null;
}

/** Whether this All Finance rule should apply to a client in the given sale-type category. */
export function allFinanceRuleAppliesToClientCategory(
  entry: RuleConfigEntry,
  clientSaleTypeCategoryLower: string
): boolean {
  const cat = clientSaleTypeCategoryLower.toLowerCase().trim();
  const explicit = entry.allFinanceSaleTypeCategories?.filter((c) => String(c).trim() !== "") ?? [];
  if (explicit.length > 0) {
    return explicit.some((c) => String(c).toLowerCase().trim() === cat);
  }
  const inferred = inferCategoriesFromAllFinanceRuleName(entry.name);
  if (inferred) return inferred.has(cat);
  return true;
}

/**
 * Picks the All Finance rule for this client among candidates (same period).
 * Prefers the config linked to {@link clientSaleTypeId}, then explicit category match,
 * then `budget` over `budget_threshold_slab`, then highest config id.
 */
export function pickAllFinanceRuleForClient(
  candidates: RuleConfigEntry[],
  clientSaleTypeCategoryLower: string,
  clientSaleTypeId: number,
  saleTypeRuleMap: SaleTypeRuleMap
): RuleConfigEntry | undefined {
  const filtered = candidates.filter((e) => allFinanceRuleAppliesToClientCategory(e, clientSaleTypeCategoryLower));
  if (filtered.length === 0) return undefined;

  const linked = saleTypeRuleMap.get(clientSaleTypeId);
  if (linked && isAllFinanceLineBudgetConfig(linked) && filtered.some((e) => e.configId === linked.configId)) {
    return filtered.find((e) => e.configId === linked.configId);
  }

  const explicitCat = (e: RuleConfigEntry) => (e.allFinanceSaleTypeCategories?.length ?? 0) > 0;
  const withExplicit = filtered.filter(explicitCat);
  const pool = withExplicit.length > 0 ? withExplicit : filtered;

  const sorted = [...pool].sort((a, b) => {
    const pri = (x: RuleConfigEntry) => (x.ruleType === "budget" ? 0 : x.ruleType === "budget_threshold_slab" ? 1 : 2);
    const p = pri(a) - pri(b);
    if (p !== 0) return p;
    return b.configId - a.configId;
  });
  return sorted[0];
}

export function mergeAllFinanceRuleEntriesByConfigId(
  fromDb: RuleConfigEntry[],
  fromMap: RuleConfigEntry[]
): RuleConfigEntry[] {
  const byId = new Map<number, RuleConfigEntry>();
  for (const e of fromDb) byId.set(e.configId, e);
  for (const e of fromMap) {
    const db = byId.get(e.configId);
    if (!db) {
      byId.set(e.configId, e);
      continue;
    }
    byId.set(e.configId, {
      ...db,
      ...e,
      allFinanceSaleTypeCategories:
        e.allFinanceSaleTypeCategories?.length ? e.allFinanceSaleTypeCategories : db.allFinanceSaleTypeCategories,
    });
  }
  return [...byId.values()];
}

function normalizeAllFinanceCategoryList(raw: string[] | null | undefined): string[] | null {
  if (!raw || raw.length === 0) return null;
  const out = raw.map((x) => String(x).trim()).filter((s) => s.length > 0);
  return out.length ? out : null;
}

/**
 * Loads every active All Finance line rule in the date window (for per–sale-type-category matching).
 */
export async function listAllFinanceRuleEntriesFromDb(
  startDate?: string,
  endDate?: string
): Promise<RuleConfigEntry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = startDate ?? today;
  const toDate = endDate ?? today;

  const configs = await db
    .select({
      id: ruleConfiguration.id,
      name: ruleConfiguration.name,
      ruleType: ruleConfiguration.rule_type,
      minBudgetThreshold: ruleConfiguration.min_budget_threshold,
      startDate: ruleConfiguration.start_date,
      allFinanceSaleTypeCategories: ruleConfiguration.all_finance_sale_type_categories,
    })
    .from(ruleConfiguration)
    .where(
      and(
        eq(ruleConfiguration.is_active, true),
        or(eq(ruleConfiguration.rule_type, "budget"), eq(ruleConfiguration.rule_type, "budget_threshold_slab")),
        lte(ruleConfiguration.start_date, toDate),
        or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, fromDate))
      )
    );

  const candidates = configs.filter((c) =>
    isAllFinanceLineBudgetConfig({
      configId: c.id,
      name: c.name,
      ruleType: c.ruleType,
      slabRules: [],
      budgetRules: [],
    })
  );
  if (candidates.length === 0) return [];

  const ordered = [...candidates].sort((a, b) => {
    const pri = (x: (typeof candidates)[0]) => (x.ruleType === "budget_threshold_slab" ? 0 : 1);
    const p = pri(a) - pri(b);
    if (p !== 0) return p;
    const byDate = String(b.startDate).localeCompare(String(a.startDate));
    if (byDate !== 0) return byDate;
    return b.id - a.id;
  });

  const configIds = ordered.map((c) => c.id);
  const [budgetRows, slabRows] =
    configIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(budgetRules).where(inArray(budgetRules.rule_configuration_id, configIds)),
          db.select().from(slabRules).where(inArray(slabRules.rule_configuration_id, configIds)),
        ]);

  const results: RuleConfigEntry[] = [];
  for (const cfg of ordered) {
    const cfgBudgetRules = budgetRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount))
      .map((r) => toCategoryRule(String(r.id), budgetTierLabel(r), r.incentive_amount));

    const cfgSlabRules = slabRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.min_slab) - toNumber(b.min_slab))
      .map((r) => toRangeRule(String(r.id), r.min_slab, r.max_slab, r.incentive_amount));

    const minTh =
      cfg.minBudgetThreshold != null && String(cfg.minBudgetThreshold).trim() !== ""
        ? toNumber(cfg.minBudgetThreshold)
        : null;

    const cats = normalizeAllFinanceCategoryList(cfg.allFinanceSaleTypeCategories ?? undefined);

    if (cfg.ruleType === "budget_threshold_slab") {
      if (cfgSlabRules.length === 0) continue;
      results.push({
        configId: cfg.id,
        name: cfg.name,
        ruleType: "budget_threshold_slab",
        minBudgetThreshold: minTh,
        allFinanceSaleTypeCategories: cats,
        slabRules: cfgSlabRules,
        budgetRules: cfgBudgetRules,
      });
      continue;
    }

    if (cfgBudgetRules.length === 0) continue;
    results.push({
      configId: cfg.id,
      name: cfg.name,
      ruleType: "budget",
      minBudgetThreshold: minTh,
      allFinanceSaleTypeCategories: cats,
      slabRules: cfgSlabRules,
      budgetRules: cfgBudgetRules,
    });
  }
  return results;
}

/**
 * Loads the first All Finance line from DB (legacy helper). Prefer {@link listAllFinanceRuleEntriesFromDb} + {@link pickAllFinanceRuleForClient} for reports.
 */
export async function resolveAllFinanceBudgetRuleEntryFromDb(
  startDate?: string,
  endDate?: string
): Promise<RuleConfigEntry | undefined> {
  const list = await listAllFinanceRuleEntriesFromDb(startDate, endDate);
  return list[0];
}

type RuleBucket =
  | "coreSpouseRules"
  | "financeSpouseRules"
  | "canadaStudentRules"
  | "studentRules"
  | "allFinanceRules"
  | "coreVisitorRules"
  | "visitorProductRules"
  | "allFinanceBudgetRules";

function resolveSlabBucket(name: string, categoryName: string | null): RuleBucket | null {
  const normalizedName = normalizeText(name);
  const normalizedCategory = normalizeText(categoryName);

  if (normalizedName.includes("all finance") || normalizedName.includes("finance bonus")) {
    return "allFinanceRules";
  }
  if (normalizedName.includes("canada")) {
    return "canadaStudentRules";
  }
  if (normalizedName.includes("finance spouse")) {
    return "financeSpouseRules";
  }
  if (normalizedCategory.includes("student") || normalizedName.includes("student")) {
    return "studentRules";
  }
  if (normalizedCategory.includes("spouse") || normalizedName.includes("spouse")) {
    return "coreSpouseRules";
  }
  return null;
}

function resolveBudgetBucket(
  name: string,
  categoryName: string | null,
  hasOtherProducts: boolean
): RuleBucket | null {
  if (hasOtherProducts) return "visitorProductRules";
  const normalizedName     = normalizeText(name);
  const normalizedCategory = normalizeText(categoryName);
  if (normalizedCategory.includes("visitor") || normalizedName.includes("visitor")) {
    return "coreVisitorRules";
  }
  if (normalizedName.includes("all finance") || normalizedCategory.includes("finance")) {
    return "allFinanceBudgetRules";
  }
  return null;
}

async function getRulesFromNewTables(
  startDate?: string,
  endDate?: string
): Promise<IncentiveRulesPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = startDate ?? today;
  const toDate = endDate ?? today;

  const configs = await db
    .select({
      id: ruleConfiguration.id,
      name: ruleConfiguration.name,
      ruleType: ruleConfiguration.rule_type,
      categoryName: saleTypeCategories.name,
      startDate: ruleConfiguration.start_date,
      createdAt: ruleConfiguration.createdAt,
    })
    .from(ruleConfiguration)
    .leftJoin(
      saleTypeCategories,
      eq(ruleConfiguration.sale_type_category_id, saleTypeCategories.id)
    )
    .where(
      and(
        eq(ruleConfiguration.is_active, true),
        lte(ruleConfiguration.start_date, toDate),
        or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, fromDate))
      )
    );

  if (configs.length === 0) return emptyPayload();

  const configIds = configs.map((c) => c.id);
  const [slabRows, budgetRows, mappingRows] = await Promise.all([
    db.select().from(slabRules).where(inArray(slabRules.rule_configuration_id, configIds)),
    db.select().from(budgetRules).where(inArray(budgetRules.rule_configuration_id, configIds)),
    db
      .select({
        ruleConfigurationId: ruleConfigurationSaleTypes.rule_configuration_id,
        otherProductId: ruleConfigurationSaleTypes.other_product_id,
      })
      .from(ruleConfigurationSaleTypes)
      .where(inArray(ruleConfigurationSaleTypes.rule_configuration_id, configIds)),
  ]);

  const otherProductIds = mappingRows
    .map((row) => row.otherProductId)
    .filter((id): id is string => !!id);

  const numericOtherProductIds = otherProductIds
    .map((id) => Number(id.replace(/^op_/, "")))
    .filter((id) => Number.isFinite(id));

  const otherProductRows =
    numericOtherProductIds.length > 0
      ? await db
          .select({ id: otherProducts.id, name: otherProducts.name })
          .from(otherProducts)
          .where(inArray(otherProducts.id, numericOtherProductIds))
      : [];

  const otherProductNameByMappingId = new Map<string, string>();
  for (const row of otherProductRows) {
    otherProductNameByMappingId.set(`op_${row.id}`, row.name);
  }

  const configOrder = [...configs].sort((a, b) => {
    const byDate = String(b.startDate).localeCompare(String(a.startDate));
    if (byDate !== 0) return byDate;
    return b.id - a.id;
  });

  const chosenByBucket = new Map<RuleBucket, number>();
  for (const cfg of configOrder) {
    const hasOtherProducts = mappingRows.some(
      (m) => m.ruleConfigurationId === cfg.id && m.otherProductId !== null
    );
    const bucket =
      cfg.ruleType === "slab" || cfg.ruleType === "budget_threshold_slab"
        ? resolveSlabBucket(cfg.name, cfg.categoryName)
        : resolveBudgetBucket(cfg.name, cfg.categoryName, hasOtherProducts);
    if (!bucket) continue;
    if (!chosenByBucket.has(bucket)) {
      chosenByBucket.set(bucket, cfg.id);
    }
  }

  const payload = emptyPayload();

  for (const [bucket, cfgId] of chosenByBucket.entries()) {
    if (
      bucket === "coreSpouseRules" ||
      bucket === "financeSpouseRules" ||
      bucket === "canadaStudentRules" ||
      bucket === "studentRules" ||
      bucket === "allFinanceRules"
    ) {
      const rows = slabRows
        .filter((r) => r.rule_configuration_id === cfgId && r.is_active)
        .sort((a, b) => toNumber(a.min_slab) - toNumber(b.min_slab));
      payload[bucket] = rows.map((r) =>
        toRangeRule(String(r.id), r.min_slab, r.max_slab, r.incentive_amount)
      );
      continue;
    }

    if (bucket === "coreVisitorRules") {
      const rows = budgetRows
        .filter((r) => r.rule_configuration_id === cfgId && r.is_active)
        .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount));
      payload.coreVisitorRules = rows.map((r) =>
        toCategoryRule(String(r.id), budgetTierLabel(r), r.incentive_amount)
      );
      continue;
    }

    if (bucket === "allFinanceBudgetRules") {
      const rows = budgetRows
        .filter((r) => r.rule_configuration_id === cfgId && r.is_active)
        .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount));
      payload.allFinanceBudgetRules = rows.map((r) =>
        toCategoryRule(String(r.id), budgetTierLabel(r), r.incentive_amount)
      );
      continue;
    }

    const configOtherProducts = mappingRows
      .filter((m) => m.ruleConfigurationId === cfgId && m.otherProductId !== null)
      .map((m) => m.otherProductId as string)
      .sort();
    const rows = budgetRows
      .filter((r) => r.rule_configuration_id === cfgId && r.is_active)
      .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount));

    payload.visitorProductRules = rows.map((r, idx) => {
      const mappingId = configOtherProducts[idx];
      const label = mappingId
        ? otherProductNameByMappingId.get(mappingId) ?? mappingId
        : `Product ${idx + 1}`;
      return toCategoryRule(String(r.id), label, r.incentive_amount);
    });
  }

  return payload;
}

// Returns a map from sale_type_id → the rule configuration that applies to that sale type.
// Each rule config entry carries its own slab or budget rules so the service can apply
// the correct rules per client without falling back to category-level buckets.
export async function getSaleTypeRuleMap(
  startDate?: string,
  endDate?: string
): Promise<SaleTypeRuleMap> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = startDate ?? today;
  const toDate = endDate ?? today;

  const configs = await db
    .select({
      id: ruleConfiguration.id,
      name: ruleConfiguration.name,
      ruleType: ruleConfiguration.rule_type,
      minBudgetThreshold: ruleConfiguration.min_budget_threshold,
      allFinanceSaleTypeCategories: ruleConfiguration.all_finance_sale_type_categories,
    })
    .from(ruleConfiguration)
    .where(
      and(
        eq(ruleConfiguration.is_active, true),
        lte(ruleConfiguration.start_date, toDate),
        or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, fromDate))
      )
    );

  if (configs.length === 0) return new Map();

  const configIds = configs.map((c) => c.id);

  const [slabRows, budgetRows, saleTypeMappings] = await Promise.all([
    db.select().from(slabRules).where(inArray(slabRules.rule_configuration_id, configIds)),
    db.select().from(budgetRules).where(inArray(budgetRules.rule_configuration_id, configIds)),
    db
      .select({
        ruleConfigurationId: ruleConfigurationSaleTypes.rule_configuration_id,
        saleTypeId: ruleConfigurationSaleTypes.sale_type_id,
      })
      .from(ruleConfigurationSaleTypes)
      .where(
        and(
          inArray(ruleConfigurationSaleTypes.rule_configuration_id, configIds),
          isNotNull(ruleConfigurationSaleTypes.sale_type_id)
        )
      ),
  ]);

  const map: SaleTypeRuleMap = new Map();

  for (const cfg of configs) {
    const cfgSlabRules = slabRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.min_slab) - toNumber(b.min_slab))
      .map((r) => toRangeRule(String(r.id), r.min_slab, r.max_slab, r.incentive_amount));

    const cfgBudgetRules = budgetRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount))
      .map((r) => toCategoryRule(String(r.id), budgetTierLabel(r), r.incentive_amount));

    const entry: RuleConfigEntry = {
      configId: cfg.id,
      name: cfg.name,
      ruleType: cfg.ruleType,
      minBudgetThreshold:
        cfg.minBudgetThreshold != null && String(cfg.minBudgetThreshold).trim() !== ""
          ? toNumber(cfg.minBudgetThreshold)
          : null,
      allFinanceSaleTypeCategories: normalizeAllFinanceCategoryList(
        cfg.allFinanceSaleTypeCategories ?? undefined
      ),
      slabRules: cfgSlabRules,
      budgetRules: cfgBudgetRules,
    };

    for (const m of saleTypeMappings) {
      if (m.ruleConfigurationId === cfg.id && m.saleTypeId !== null) {
        map.set(m.saleTypeId, entry);
      }
    }
  }

  return map;
}

// Same date window and rule rows as getSaleTypeRuleMap, but maps other_product_id → config.
export async function getOtherProductRuleMap(
  startDate?: string,
  endDate?: string
): Promise<OtherProductRuleMap> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = startDate ?? today;
  const toDate = endDate ?? today;

  const configs = await db
    .select({
      id: ruleConfiguration.id,
      name: ruleConfiguration.name,
      ruleType: ruleConfiguration.rule_type,
      minBudgetThreshold: ruleConfiguration.min_budget_threshold,
      allFinanceSaleTypeCategories: ruleConfiguration.all_finance_sale_type_categories,
    })
    .from(ruleConfiguration)
    .where(
      and(
        eq(ruleConfiguration.is_active, true),
        lte(ruleConfiguration.start_date, toDate),
        or(isNull(ruleConfiguration.end_date), gte(ruleConfiguration.end_date, fromDate))
      )
    );

  if (configs.length === 0) return new Map();

  const configIds = configs.map((c) => c.id);

  const [slabRows, budgetRows, saleTypeMappings] = await Promise.all([
    db.select().from(slabRules).where(inArray(slabRules.rule_configuration_id, configIds)),
    db.select().from(budgetRules).where(inArray(budgetRules.rule_configuration_id, configIds)),
    db
      .select({
        ruleConfigurationId: ruleConfigurationSaleTypes.rule_configuration_id,
        otherProductId: ruleConfigurationSaleTypes.other_product_id,
      })
      .from(ruleConfigurationSaleTypes)
      .where(
        and(
          inArray(ruleConfigurationSaleTypes.rule_configuration_id, configIds),
          isNotNull(ruleConfigurationSaleTypes.other_product_id)
        )
      ),
  ]);

  const map: OtherProductRuleMap = new Map();

  for (const cfg of configs) {
    const cfgSlabRules = slabRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.min_slab) - toNumber(b.min_slab))
      .map((r) => toRangeRule(String(r.id), r.min_slab, r.max_slab, r.incentive_amount));

    const cfgBudgetRules = budgetRows
      .filter((r) => r.rule_configuration_id === cfg.id && r.is_active)
      .sort((a, b) => toNumber(a.budget_amount) - toNumber(b.budget_amount))
      .map((r) => toCategoryRule(String(r.id), budgetTierLabel(r), r.incentive_amount));

    const entry: RuleConfigEntry = {
      configId: cfg.id,
      name: cfg.name,
      ruleType: cfg.ruleType,
      minBudgetThreshold:
        cfg.minBudgetThreshold != null && String(cfg.minBudgetThreshold).trim() !== ""
          ? toNumber(cfg.minBudgetThreshold)
          : null,
      allFinanceSaleTypeCategories: normalizeAllFinanceCategoryList(
        cfg.allFinanceSaleTypeCategories ?? undefined
      ),
      slabRules: cfgSlabRules,
      budgetRules: cfgBudgetRules,
    };

    for (const m of saleTypeMappings) {
      if (m.ruleConfigurationId === cfg.id && m.otherProductId !== null) {
        map.set(m.otherProductId, entry);
      }
    }
  }

  return map;
}

async function getRulesFromLegacyTables(): Promise<IncentiveRulesPayload> {
  const [slabRows, categoryRows] = await Promise.all([
    db.select().from(incentiveSlabRules).orderBy(asc(incentiveSlabRules.sort_order)),
    db.select().from(incentiveCategoryRules).orderBy(asc(incentiveCategoryRules.sort_order)),
  ]);

  return {
    coreSpouseRules: slabRows.filter((r) => r.rule_group === "core_spouse").map(toRangeItem),
    financeSpouseRules: slabRows.filter((r) => r.rule_group === "finance_spouse").map(toRangeItem),
    canadaStudentRules: slabRows.filter((r) => r.rule_group === "canada_student").map(toRangeItem),
    studentRules: slabRows.filter((r) => r.rule_group === "student").map(toRangeItem),
    allFinanceRules: slabRows.filter((r) => r.rule_group === "all_finance").map(toRangeItem),
    coreVisitorRules: categoryRows.filter((r) => r.rule_group === "core_visitor").map(toCategoryItem),
    visitorProductRules: categoryRows.filter((r) => r.rule_group === "visitor_product").map(toCategoryItem),
    allFinanceBudgetRules: [],
  };
}

export const getRules = async (
  startDate?: string,
  endDate?: string
): Promise<IncentiveRulesPayload> => {
  const fromNewTables = await getRulesFromNewTables(startDate, endDate);
  const hasAnyRule =
    fromNewTables.coreSpouseRules.length > 0 ||
    fromNewTables.financeSpouseRules.length > 0 ||
    fromNewTables.coreVisitorRules.length > 0 ||
    fromNewTables.visitorProductRules.length > 0 ||
    fromNewTables.canadaStudentRules.length > 0 ||
    fromNewTables.studentRules.length > 0 ||
    fromNewTables.allFinanceRules.length > 0 ||
    fromNewTables.allFinanceBudgetRules.length > 0;
  if (hasAnyRule) return fromNewTables;

  return getRulesFromLegacyTables();
};

export const getSpouseRules = async () => {
  const rows = await db
    .select()
    .from(incentiveSlabRules)
    .where(inArray(incentiveSlabRules.rule_group, ["core_spouse", "finance_spouse"]))
    .orderBy(asc(incentiveSlabRules.sort_order));
  return {
    coreSpouseRules: rows.filter((r) => r.rule_group === "core_spouse").map(toRangeItem),
    financeSpouseRules: rows.filter((r) => r.rule_group === "finance_spouse").map(toRangeItem),
  };
};

export const getVisitorRules = async () => {
  const rows = await db
    .select()
    .from(incentiveCategoryRules)
    .where(inArray(incentiveCategoryRules.rule_group, ["core_visitor", "visitor_product"]))
    .orderBy(asc(incentiveCategoryRules.sort_order));
  return {
    coreVisitorRules: rows.filter((r) => r.rule_group === "core_visitor").map(toCategoryItem),
    visitorProductRules: rows.filter((r) => r.rule_group === "visitor_product").map(toCategoryItem),
  };
};

export const getCanadaStudentRules = async (): Promise<RangeRuleItem[]> => {
  const rows = await db
    .select()
    .from(incentiveSlabRules)
    .where(eq(incentiveSlabRules.rule_group, "canada_student"))
    .orderBy(asc(incentiveSlabRules.sort_order));
  return rows.map(toRangeItem);
};

export const getStudentRules = async (): Promise<RangeRuleItem[]> => {
  const rows = await db
    .select()
    .from(incentiveSlabRules)
    .where(eq(incentiveSlabRules.rule_group, "student"))
    .orderBy(asc(incentiveSlabRules.sort_order));
  return rows.map(toRangeItem);
};

export const getAllFinanceRules = async (): Promise<RangeRuleItem[]> => {
  const rows = await db
    .select()
    .from(incentiveSlabRules)
    .where(eq(incentiveSlabRules.rule_group, "all_finance"))
    .orderBy(asc(incentiveSlabRules.sort_order));
  return rows.map(toRangeItem);
};

// Only replaces groups that are explicitly present in the payload.
// A missing key is skipped — existing rows for that group are preserved.
// An explicit empty array wipes that group's rows.
export const upsertRules = async (payload: Partial<IncentiveRulesPayload>): Promise<IncentiveRulesPayload> => {
  await db.transaction(async (tx) => {
    const slabGroupMap = {
      core_spouse: payload.coreSpouseRules,
      finance_spouse: payload.financeSpouseRules,
      canada_student: payload.canadaStudentRules,
      student: payload.studentRules,
      all_finance: payload.allFinanceRules,
    } as const;

    for (const [group, items] of Object.entries(slabGroupMap) as Array<[
      "core_spouse" | "finance_spouse" | "canada_student" | "student" | "all_finance",
      RangeRuleItem[] | undefined
    ]>) {
      if (items === undefined) continue;
      await tx.delete(incentiveSlabRules).where(eq(incentiveSlabRules.rule_group, group));
      if (items.length > 0) {
        await tx.insert(incentiveSlabRules).values(
          items.map((item, idx) => ({
            rule_group: group,
            min_count: item.minCount,
            max_count: item.maxCount,
            incentive_amount: item.incentiveAmount,
            sort_order: idx,
            updatedAt: new Date(),
          }))
        );
      }
    }

    const categoryGroupMap = {
      core_visitor: payload.coreVisitorRules,
      visitor_product: payload.visitorProductRules,
    } as const;

    for (const [group, items] of Object.entries(categoryGroupMap) as Array<[
      "core_visitor" | "visitor_product",
      CategoryRuleItem[] | undefined
    ]>) {
      if (items === undefined) continue;
      await tx.delete(incentiveCategoryRules).where(eq(incentiveCategoryRules.rule_group, group));
      if (items.length > 0) {
        await tx.insert(incentiveCategoryRules).values(
          items.map((item, idx) => ({
            rule_group: group,
            label: item.label,
            incentive_amount: item.incentiveAmount,
            sort_order: idx,
            updatedAt: new Date(),
          }))
        );
      }
    }
  });

  return getRules();
};
