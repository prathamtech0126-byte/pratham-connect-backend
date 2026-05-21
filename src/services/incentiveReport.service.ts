import {
  getRules,
  getSaleTypeRuleMap,
  getOtherProductRuleMap,
  collectAllFinanceRuleEntriesFromSaleTypeMap,
  listAllFinanceRuleEntriesFromDb,
  mergeAllFinanceRuleEntriesByConfigId,
  pickAllFinanceRuleForClient,
  isAllFinanceLineBudgetConfig,
} from "../models/incentiveRules.model";
import {
  getCounsellorStats,
  getCounsellorSaleTypeCounts,
  getCompanyWideSpouseCount,
  getPaginatedClients,
  getTotalClientCount,
  getClientPaymentStages,
  getClientAllFinanceAmounts,
  getProductDisplayNameMap,
  getProductNameToOpRuleKeyMap,
  runIncentiveDiagnostics,
  getPeriodRangeById,
  getIncentiveRecordByClientPeriod,
  getApprovedBreakdownTotals,
  getOrCreatePeriodByDateRange,
  getIncentiveActionStateForClientsInRange,
  persistIncentiveAction,
  type CounsellorStat,
  type PaymentStage,
} from "../models/incentiveReport.model";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";
import {
  getOtherProductPaymentsDetailsByClientIds,
  getAllFinancePaymentsDetailsByClientIds,
  type ProductPaymentWithEntity,
} from "../models/clientProductPayments.model";

/** Re-export for consumers typing `ReportItem.otherProducts.payments`. */
export type { ProductPaymentWithEntity };
import {
  findSlab,
  getSpouseIncentive,
  getVisitorIncentive,
  getStudentIncentive,
  getCanadaStudentBonus,
  getFinanceBonus,
} from "../utils/incentiveCalculator";
import { redisGetJson, redisSetJson } from "../config/redis";
import type {
  CategoryRuleItem,
  IncentiveRulesPayload,
  OtherProductRuleMap,
  RangeRuleItem,
  RuleConfigEntry,
  SaleTypeRuleMap,
} from "../models/incentiveRules.model";

export interface ReportParams {
  page: number;
  pageSize: number;
  startDate: string;
  endDate: string;
  clientId?: number;
}

export interface CoreSaleItem {
  label: "Initial" | "Before Visa" | "After Visa";
  amount: number;
  paymentDate: string | null;
}

export interface CoreSaleRuleDetail {
  ruleName: string;
  ruleType: "slab" | "budget" | "budget_threshold_slab";
  // Slab: company-wide team count drove the tier
  teamCount?: number;
  slabRange?: string;           // e.g. "50 – 69" or "70+"
  // Budget: amount compared to thresholds (visitor/spouse = Initial, else Before Visa; other types = counsellor aggregate where applicable)
  counsellorTotal?: number;
  thresholdMet?: number;        // the threshold value that was matched
  ratePerClient: number;
  reason: string;
}

export interface CoreSale {
  items: CoreSaleItem[];
  eligible: boolean;
  incentive: number;
  ruleDetail: CoreSaleRuleDetail | null;
}

export interface AllFinanceRuleDetail {
  /** Rule configuration display name (new-table rules); helps the UI when ruleType is budget. */
  ruleName?: string;
  ruleType: "slab" | "budget" | "budget_threshold_slab";
  // Slab / Budget+Slab: counsellor's distinct all-finance clients in the period (slab tiers).
  counsellorAllFinanceCount?: number;
  /** Exact count used for slab lookup (same value as counsellorAllFinanceCount when slab-based). */
  slabCountChecked?: number;
  /** Human-readable basis for the slab count field. */
  slabCountBasis?: string;
  slabRange?: string;
  // Budget fields (ruleType === "budget"): per-client amount check
  clientAmount?: number;
  thresholdMet?: number;
  // Budget+Slab: counsellor total all-finance INR received in period vs min gate
  counsellorAllFinanceAmountTotal?: number;
  minBudgetThreshold?: number;
  ratePerClient: number;
  reason: string;
  /**
   * When All Finance incentive is ₹0, identifies the blocking condition for UI.
   * `budget_gate` = counsellor period total below min; `slab_no_match` = gate passed (or none) but client count fits no slab.
   */
  incentiveBlocker?:
    | "none"
    | "budget_gate"
    | "slab_no_match"
    | "budget_no_tier"
    | "no_rule"
    | "no_client_all_finance_amount"
    | "core_sale_below_min_budget";
  /** When min budget uses core-sale received on the client (Spouse/Student Budget+Slab). */
  coreSaleReceivedAmount?: number;
  /** For Budget + Slab rules: short description of configured count slabs (for messages when none match). */
  configuredSlabRangesSummary?: string;
}

export interface AllFinanceBreakdown {
  amount: number;
  eligible: boolean;
  incentive: number;
  ruleDetail: AllFinanceRuleDetail | null;
  /** All-finance payment rows (same shape as client complete API's `productPayments`). */
  payments: ProductPaymentWithEntity[];
}

export interface OtherProductItem {
  name: string;
  /** Gross amount received for this product line on the client (always shown). */
  amountReceived: number;
  paymentDate: string | null;
  eligible: boolean;
  incentive: number;
}

export interface OtherProductsBreakdown {
  items: OtherProductItem[];
  /** Sum of {@link OtherProductItem.amountReceived} for the client. */
  totalAmountReceived: number;
  incentive: number;
  /**
   * Every other-product `client_product_payment` row for this client (excluding All Finance),
   * same shape as `GET /api/client/:id/complete` → `data.productPayments` (includes `entity`).
   */
  payments: ProductPaymentWithEntity[];
}

export interface ReportItem {
  clientId: number;
  counsellorId: number;
  clientName: string;
  counsellor: string;
  enrollmentDate: string;
  paymentDate: string | null;
  /** Broad group from `sale_type_category`. Null for product-only clients with no core sale. */
  saleType: "Spouse" | "Visitor" | "Student" | null;
  /** Specific line from `sale_type.sale_type` (e.g. Canada Spouse, UK Student). Null for product-only clients. */
  saleTypeName: string | null;
  /** `sale_type_category.id` for this client's sale type. */
  saleTypeCategoryId: number | null;
  eligible: boolean;
  receivedAmount: number;
  originalIncentiveAmount: number;
  incentiveAmount: number;
  isOverridden: boolean;
  overrideAmount?: number | null;
  overrideCoreSale?: number | null;
  overrideAllFinance?: number | null;
  overrideOtherProducts?: number | null;
  overrideByUserId?: number | null;
  remark?: string | null;
  status: "Pending" | "Approved" | "Rejected";
  coreSale: CoreSale;
  allFinance: AllFinanceBreakdown;
  otherProducts: OtherProductsBreakdown;
  /**
   * True when this row is generated for a counsellor who handled one or more product payments
   * for this client but is not the client's original counsellor. Core sale and all-finance
   * incentives are always 0 for these rows; only the specific products they handled appear.
   */
  isHandledByRow: boolean;
  /**
   * True when the client is shared to this counsellor — either via product-payment handling
   * (isHandledByRow) or via an explicit transfer (ci.transfer_status = true).
   * Use this flag to show a "Shared Client" badge in the UI.
   */
  isSharedClient: boolean;
  /** For handled-by rows: the client's original counsellor id. Null for primary rows. */
  originalCounsellorId: number | null;
}

export interface SlabInfo {
  minCount: number;
  maxCount: number | "unlimited";
  incentiveAmount: number;
  label: string;
}

export interface TierInfo {
  minAmount: number;
  incentiveAmount: number;
  label: string;
}

export interface IncentiveInfo {
  spouse: {
    basis: string;
    description: string;
    slabs: SlabInfo[];
  };
  visitor: {
    basis: string;
    description: string;
    tiers: TierInfo[];
  };
  student: {
    basis: string;
    description: string;
    slabs: SlabInfo[];
    canadaBonus: {
      basis: string;
      description: string;
      slabs: SlabInfo[];
    };
  };
  financeBonus: {
    basis: string;
    description: string;
    slabs: SlabInfo[];
  };
}

export interface ReportResponse {
  warning?: string;
  info: IncentiveInfo;
  data: ReportItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
    totalIncentiveAmount: number;
  };
}

function buildSlabLabel(min: number, max: number): string {
  if (max === -1) return `${min}+`;
  if (min === max) return `${min}`;
  return `${min} – ${max}`;
}

function buildIncentiveInfo(rules: IncentiveRulesPayload): IncentiveInfo {
  return {
    spouse: {
      basis: "Company-wide spouse count",
      description:
        "All counsellors receive the same incentive based on the total number of spouse clients enrolled across the company in the selected period.",
      slabs: rules.coreSpouseRules.map((r) => ({
        minCount: r.minCount,
        maxCount: r.maxCount === -1 ? "unlimited" : r.maxCount,
        incentiveAmount: r.incentiveAmount,
        label: `${buildSlabLabel(r.minCount, r.maxCount)} spouse clients → ₹${r.incentiveAmount} per client`,
      })),
    },
    visitor: {
      basis: "Visitor client: Initial payment amount, or Before Visa if Initial has no amount",
      description:
        "For each visitor client, the budget tier uses the Initial stage amount only; if Initial is not paid, Before Visa amount is used (not the sum of all stages). Legacy rules use the same basis.",
      tiers: rules.coreVisitorRules.map((r) => {
        const threshold = parseFloat(r.label.replace(/[^0-9.]/g, ""));
        return {
          minAmount: isNaN(threshold) ? 0 : threshold,
          incentiveAmount: r.incentiveAmount,
          label: `Received ≥ ₹${isNaN(threshold) ? r.label : threshold.toLocaleString("en-IN")} → ₹${r.incentiveAmount} per client`,
        };
      }),
    },
    student: {
      basis: "Counsellor's student count",
      description:
        "Each counsellor earns an incentive based on the number of student clients they have enrolled in the selected period.",
      slabs: rules.studentRules.map((r) => ({
        minCount: r.minCount,
        maxCount: r.maxCount === -1 ? "unlimited" : r.maxCount,
        incentiveAmount: r.incentiveAmount,
        label: `${buildSlabLabel(r.minCount, r.maxCount)} student clients → ₹${r.incentiveAmount} per client`,
      })),
      canadaBonus: {
        basis: "Counsellor's Canada-program student count",
        description:
          "Additional bonus on top of the base student incentive for clients who have a tuition-fees payment (Canada program).",
        slabs: rules.canadaStudentRules.map((r) => ({
          minCount: r.minCount,
          maxCount: r.maxCount === -1 ? "unlimited" : r.maxCount,
          incentiveAmount: r.incentiveAmount,
          label: `${buildSlabLabel(r.minCount, r.maxCount)} Canada-program clients → +₹${r.incentiveAmount} per client`,
        })),
      },
    },
    financeBonus: {
      basis: "Counsellor's total all-finance client count",
      description:
        "A bonus added on top of every sale type's base incentive, determined by how many all-finance clients the counsellor has in the selected period.",
      slabs: rules.allFinanceRules.map((r) => ({
        minCount: r.minCount,
        maxCount: r.maxCount === -1 ? "unlimited" : r.maxCount,
        incentiveAmount: r.incentiveAmount,
        label: `${buildSlabLabel(r.minCount, r.maxCount)} finance clients → +₹${r.incentiveAmount} per client`,
      })),
    },
  };
}

function computeReceivedAmount(stage: PaymentStage | undefined): number {
  if (!stage) return 0;
  return stage.initialAmount + stage.beforeVisaAmount + stage.afterVisaAmount;
}

function resolveProductPaymentDate(row: ProductPaymentWithEntity): string | null {
  const rowDate = row.paymentDate ? String(row.paymentDate).slice(0, 10) : null;
  if (rowDate) return rowDate;
  const e = (row.entity ?? {}) as Record<string, unknown>;
  const d = (name: string) => {
    const v = e[name];
    return v ? String(v).slice(0, 10) : null;
  };
  return (
    // generic payment date fields
    d("paymentDate") ??
    d("payment_date") ??
    d("anotherPaymentDate") ??
    d("anotherPaymentDate2") ??
    d("anotherPaymentDate3") ??
    // insurance entity
    d("insuranceDate") ??
    // beacon account
    d("fundingDate") ??
    d("openingDate") ??
    // visa extension / new sell
    d("extensionDate") ??
    d("sellDate") ??
    // air ticket
    d("ticketDate") ??
    // ielts
    d("enrollmentDate") ??
    // loan
    d("disbursmentDate") ??
    // forex card / credit card
    d("cardDate") ??
    d("cardGivingDate") ??
    d("cardActivationDate") ??
    // forex fees / tution fees
    d("feeDate") ??
    // sim card
    d("simCardGivingDate") ??
    d("simActivationDate")
  );
}

/**
 * Visitor / spouse budget rules: compare thresholds to Initial only; if Initial has no amount,
 * use Before Visa (not total received across stages).
 */
function visitorSpouseBudgetBasis(stage: PaymentStage | undefined): { amount: number; basisLabel: string } {
  if (!stage) return { amount: 0, basisLabel: "Initial / Before Visa" };
  if (stage.initialAmount > 0) return { amount: stage.initialAmount, basisLabel: "Initial" };
  return { amount: stage.beforeVisaAmount, basisLabel: "Before Visa" };
}

function emptyStat(counsellorId: number): CounsellorStat {
  return {
    counsellorId,
    totalReceivedAmount: 0,
    studentCount: 0,
    canadaStudentCount: 0,
    allFinanceCount: 0,
  };
}

async function getCachedRules(startDate: string, endDate: string): Promise<IncentiveRulesPayload> {
  const cacheKey = `incentive-rules:${startDate}:${endDate}`;
  const cached = await redisGetJson<IncentiveRulesPayload>(cacheKey);
  if (cached) return cached;
  const fresh = await getRules(startDate, endDate);
  await redisSetJson(cacheKey, fresh, 600);
  return fresh;
}

// Maps are not JSON-serialisable; store as [key, value][] pairs and reconstruct on read.
async function getCachedSaleTypeRuleMap(startDate: string, endDate: string): Promise<SaleTypeRuleMap> {
  const cacheKey = `incentive-strmap:${startDate}:${endDate}`;
  const cached = await redisGetJson<[number, RuleConfigEntry][]>(cacheKey);
  if (cached) return new Map(cached);
  const fresh = await getSaleTypeRuleMap(startDate, endDate);
  await redisSetJson(cacheKey, [...fresh.entries()], 600);
  return fresh;
}

async function getCachedOtherProductRuleMap(
  startDate: string,
  endDate: string
): Promise<OtherProductRuleMap> {
  const cacheKey = `incentive-oprulemap:${startDate}:${endDate}`;
  const cached = await redisGetJson<[string, RuleConfigEntry][]>(cacheKey);
  if (cached) return new Map(cached);
  const fresh = await getOtherProductRuleMap(startDate, endDate);
  await redisSetJson(cacheKey, [...fresh.entries()], 600);
  return fresh;
}

/**
 * Filters product payment rows by the report period.
 *
 * BEACON_ACCOUNT always uses entity.fundingDate for gating.
 *
 * When `filterAll` is true (product-only clients — enrolled outside the period),
 * every other product is also filtered by its cpp.date (paymentDate), so only
 * payments whose date falls within [startDate, endDate] are counted.
 */
function filterProductRowsByPeriod(
  rows: ProductPaymentWithEntity[],
  startDate: string,
  endDate: string,
  filterAll = false
): ProductPaymentWithEntity[] {
  return rows.filter((row) => {
    if (row.productName === "BEACON_ACCOUNT") {
      const entity = (row.entity ?? {}) as { fundingDate?: string | Date | null };
      if (!entity.fundingDate) return false;
      const fd = String(entity.fundingDate).slice(0, 10);
      return fd >= startDate && fd <= endDate;
    }
    if (filterAll) {
      const effectiveDate = resolveProductPaymentDate(row);
      if (!effectiveDate) return false;
      return effectiveDate >= startDate && effectiveDate <= endDate;
    }
    return true;
  });
}

/** Other-product lines use their own rule configs; legacy visitor label match is a fallback only. */
function resolveOtherProductLineIncentive(
  productName: string,
  amount: number,
  displayName: string,
  saleTypeLower: string,
  productNameToOpKey: Map<string, string>,
  otherProductRuleMap: OtherProductRuleMap,
  rules: IncentiveRulesPayload,
  paymentStage?: PaymentStage
): number {
  // Refusal Charges: only eligible when the client has an after-visa core-sale payment
  if (productName === "REFUSAL_CHARGES") {
    if (!paymentStage || paymentStage.afterVisaAmount <= 0) return 0;
  }
  const opKey = productNameToOpKey.get(productName);
  const opEntry = opKey ? otherProductRuleMap.get(opKey) : undefined;
  if (opEntry && opEntry.ruleType === "budget" && opEntry.budgetRules.length > 0) {
    return getVisitorIncentive(amount, opEntry.budgetRules);
  }
  if (opEntry && opEntry.ruleType === "slab" && opEntry.slabRules.length > 0) {
    // count=1: the client has this product (flat per-client slab incentive)
    return findSlab(1, opEntry.slabRules);
  }
  if (saleTypeLower === "visitor") {
    for (const rule of rules.visitorProductRules) {
      if (rule.label.toLowerCase() === displayName.toLowerCase()) return rule.incentiveAmount;
    }
  }
  return 0;
}

interface CoreSaleResult {
  incentive: number;
  detail: CoreSaleRuleDetail | null;
}

function slabRangeLabel(minCount: number, maxCount: number): string {
  if (maxCount === -1) return `${minCount}+`;
  if (minCount === maxCount) return `${minCount}`;
  return `${minCount} – ${maxCount}`;
}

function findMatchedSlabRange(count: number, slabRules: import("../models/incentiveRules.model").RangeRuleItem[]): string | undefined {
  for (const r of slabRules) {
    const max = r.maxCount === -1 ? Infinity : r.maxCount;
    if (count >= r.minCount && count <= max) return slabRangeLabel(r.minCount, r.maxCount);
  }
  return undefined;
}

function findMatchedThreshold(amount: number, budgetRules: import("../models/incentiveRules.model").CategoryRuleItem[]): number | undefined {
  let matched: number | undefined;
  for (const r of budgetRules) {
    const threshold = parseFloat(r.label.replace(/[^0-9.]/g, ""));
    if (!isNaN(threshold) && amount >= threshold) matched = threshold;
  }
  return matched;
}

/** When true, other-product incentives are computed from active mapped rules. */
const APPLY_OTHER_PRODUCT_INCENTIVES_IN_REPORT = true;

function resolveEntityAmount(row: ProductPaymentWithEntity): number {
  if (row.entityType === "master_only" || !row.entityId) {
    return parseFloat(String(row.amount ?? "0")) || 0;
  }
  const entity = (row.entity ?? {}) as Record<string, unknown>;
  const raw = entity.amount ?? entity.totalAmount;
  return parseFloat(String(raw ?? "0")) || 0;
}


/** Context to align All Finance Budget+Slab (Spouse/Student) with core-sale team count + per-client core received. */
interface AllFinanceResolutionContext {
  saleTypeLower: string;
  saleTypeId: number;
  paymentStage: PaymentStage | undefined;
  saleTypeRuleMap: SaleTypeRuleMap;
  companyWideRuleConfigCounts: Map<number, number>;
  spouseCount: number;
  counsellorStat: CounsellorStat;
}

/**
 * Same count basis as core-sale slab rate for this client's sale type (company-wide team when mapped slab applies;
 * legacy spouse = company spouse count; legacy student = counsellor student count).
 */
function getCoreSaleSlabCountForAllFinance(ctx: AllFinanceResolutionContext): number | undefined {
  const { saleTypeLower, saleTypeId, saleTypeRuleMap, companyWideRuleConfigCounts, spouseCount, counsellorStat } =
    ctx;
  const rc = saleTypeRuleMap.get(saleTypeId);
  if (rc && !isAllFinanceLineBudgetConfig(rc) && (rc.ruleType === "slab" || rc.ruleType === "budget_threshold_slab")) {
    return companyWideRuleConfigCounts.get(rc.configId);
  }
  if (!rc && saleTypeLower === "spouse") {
    return spouseCount;
  }
  if (!rc && saleTypeLower === "student") {
    return counsellorStat.studentCount;
  }
  return undefined;
}

function formatConfiguredSlabRangesSummary(rules: RangeRuleItem[]): string {
  if (!rules.length) return "none configured";
  return rules
    .map((r) => {
      const hi = r.maxCount === -1 ? "above" : String(r.maxCount);
      return `${r.minCount}–${hi} clients → ₹${r.incentiveAmount.toLocaleString("en-IN")}`;
    })
    .join("; ");
}

function resolveAllFinancePerClientIncentive(
  ruleSource: RuleConfigEntry | undefined,
  clientAllFinanceAmount: number,
  counsellorAllFinanceCount: number,
  counsellorAllFinanceAmountTotal: number,
  legacyAllFinanceRules: RangeRuleItem[],
  resolutionContext: AllFinanceResolutionContext
): { incentive: number; detail: AllFinanceRuleDetail } {
  const ruleLabel = ruleSource?.name ? ` (${ruleSource.name})` : "";
  const saleTypeLower = resolutionContext.saleTypeLower.toLowerCase();
  const isSpouseOrStudent = saleTypeLower === "spouse" || saleTypeLower === "student";
  // Guard: all-finance incentive should only apply to clients with actual all-finance amount.
  if (clientAllFinanceAmount <= 0) {
    return {
      incentive: 0,
      detail: {
        ruleName: ruleSource?.name,
        ruleType: (ruleSource?.ruleType ?? "slab") as "slab" | "budget" | "budget_threshold_slab",
        clientAmount: clientAllFinanceAmount,
        ratePerClient: 0,
        incentiveBlocker: "no_client_all_finance_amount",
        reason:
          `This client has no All Finance amount received in the selected period (₹${clientAllFinanceAmount.toLocaleString("en-IN")}). ` +
          `All Finance incentive is applied only when the client has an All Finance payment.`,
      },
    };
  }

  if (ruleSource && isAllFinanceLineBudgetConfig(ruleSource)) {
    if (ruleSource.ruleType === "budget" && ruleSource.budgetRules.length > 0) {
      const incentive = getVisitorIncentive(clientAllFinanceAmount, ruleSource.budgetRules);
      const thresholdMet = findMatchedThreshold(clientAllFinanceAmount, ruleSource.budgetRules);
      return {
        incentive,
        detail: {
          ruleName: ruleSource.name,
          ruleType: "budget",
          clientAmount: clientAllFinanceAmount,
          thresholdMet,
          ratePerClient: incentive,
          incentiveBlocker: incentive > 0 ? "none" : "budget_no_tier",
          reason:
            incentive > 0
              ? `Client's all-finance payment is ₹${clientAllFinanceAmount.toLocaleString("en-IN")}${ruleLabel} (threshold ≥₹${thresholdMet?.toLocaleString("en-IN")}). Bonus: ₹${incentive.toLocaleString("en-IN")} per client.`
              : `Client's all-finance payment is ₹${clientAllFinanceAmount.toLocaleString("en-IN")}${ruleLabel}. No budget threshold reached — not eligible.`,
        },
      };
    }

    if (ruleSource.ruleType === "budget_threshold_slab" && ruleSource.slabRules.length > 0) {
      const minGate = ruleSource.minBudgetThreshold ?? 0;
      const slabSummary = formatConfiguredSlabRangesSummary(ruleSource.slabRules);

      const coreSaleSlabCount = isSpouseOrStudent
        ? getCoreSaleSlabCountForAllFinance(resolutionContext)
        : undefined;
      const slabInputCount =
        isSpouseOrStudent && coreSaleSlabCount != null ? coreSaleSlabCount : counsellorAllFinanceCount;
      const slabBasisText = isSpouseOrStudent
        ? coreSaleSlabCount != null
          ? "Company-wide team client count for this client's core-sale rule (same basis as core-sale slab)"
          : "Distinct clients of this counsellor with all-finance product payment (entity_type = allFinance_id) — fallback because core-sale team count is unavailable"
        : "Distinct clients of this counsellor with all-finance product payment (entity_type = allFinance_id) in selected period";

      if (minGate > 0) {
        if (isSpouseOrStudent) {
          if (clientAllFinanceAmount < minGate) {
            const slabRangePreview = findMatchedSlabRange(slabInputCount, ruleSource.slabRules);
            return {
              incentive: 0,
              detail: {
                ruleName: ruleSource.name,
                ruleType: "budget_threshold_slab",
                counsellorAllFinanceCount,
                slabCountChecked: slabInputCount,
                slabCountBasis: slabBasisText,
                counsellorAllFinanceAmountTotal,
                minBudgetThreshold: minGate,
                slabRange: slabRangePreview,
                clientAmount: clientAllFinanceAmount,
                ratePerClient: 0,
                incentiveBlocker: "budget_gate",
                configuredSlabRangesSummary: slabSummary,
                reason: `For Spouse/Student, minimum budget (₹${minGate.toLocaleString("en-IN")}) is checked against this client's All Finance amount received: ₹${clientAllFinanceAmount.toLocaleString("en-IN")}. Below minimum — All Finance incentive ₹0. (Team count for slab would be ${slabInputCount}${slabRangePreview ? ` → ${slabRangePreview}` : ""}.)`,
              },
            };
          }
        } else if (counsellorAllFinanceAmountTotal < minGate) {
          const slabRange = findMatchedSlabRange(slabInputCount, ruleSource.slabRules);
          return {
            incentive: 0,
            detail: {
              ruleName: ruleSource.name,
              ruleType: "budget_threshold_slab",
              counsellorAllFinanceCount,
              slabCountChecked: slabInputCount,
              slabCountBasis: slabBasisText,
              counsellorAllFinanceAmountTotal,
              minBudgetThreshold: minGate,
              slabRange,
              clientAmount: clientAllFinanceAmount,
              ratePerClient: 0,
              incentiveBlocker: "budget_gate",
              configuredSlabRangesSummary: slabSummary,
              reason: `All Finance minimum for "${ruleSource.name}" (Visitor path) uses the counsellor's total All Finance received in the period (₹${counsellorAllFinanceAmountTotal.toLocaleString("en-IN")}), which must be ≥ ₹${minGate.toLocaleString("en-IN")}. This counsellor is below that gate — incentive ₹0 (slabs are not evaluated). This client's All Finance amount is ₹${clientAllFinanceAmount.toLocaleString("en-IN")}.`,
            },
          };
        }
      }

      const incentive = findSlab(slabInputCount, ruleSource.slabRules);
      const slabRange = findMatchedSlabRange(slabInputCount, ruleSource.slabRules);
      return {
        incentive,
        detail: {
          ruleName: ruleSource.name,
          ruleType: "budget_threshold_slab",
          counsellorAllFinanceCount,
          slabCountChecked: slabInputCount,
          slabCountBasis: slabBasisText,
          counsellorAllFinanceAmountTotal,
          minBudgetThreshold: minGate > 0 ? minGate : undefined,
          slabRange,
          clientAmount: clientAllFinanceAmount,
          ratePerClient: incentive,
          configuredSlabRangesSummary: slabSummary,
          incentiveBlocker: incentive > 0 ? "none" : "slab_no_match",
          reason:
            incentive > 0
              ? isSpouseOrStudent
                ? `Slab uses **core-sale team count** (${slabInputCount})${ruleLabel} → ${slabRange}. Per-client rate: ₹${incentive.toLocaleString("en-IN")}. Min. budget (₹${minGate > 0 ? minGate.toLocaleString("en-IN") : "n/a"}) passed on this client's All Finance amount (₹${clientAllFinanceAmount.toLocaleString("en-IN")}).`
                : `Budget gate (counsellor total All Finance in period): ₹${counsellorAllFinanceAmountTotal.toLocaleString("en-IN")}${minGate > 0 ? ` — meets minimum ₹${minGate.toLocaleString("en-IN")}` : ""}${ruleLabel}. Slab uses counsellor's all-finance client count (${slabInputCount}) → ${slabRange}. Bonus: ₹${incentive.toLocaleString("en-IN")} per client. (This client's All Finance: ₹${clientAllFinanceAmount.toLocaleString("en-IN")}.)`
              : isSpouseOrStudent
                ? `Core-sale team count is ${slabInputCount}${ruleLabel} but it does not fall in any configured All Finance slab. Configured slabs: ${slabSummary}. This client's All Finance: ₹${clientAllFinanceAmount.toLocaleString("en-IN")}.`
                : `Budget gate (counsellor total All Finance in the period) is satisfied: ₹${counsellorAllFinanceAmountTotal.toLocaleString("en-IN")}${minGate > 0 ? ` (minimum required: ₹${minGate.toLocaleString("en-IN")})` : ""}${ruleLabel}. Incentive is ₹0 because the counsellor's all-finance client count (${slabInputCount}) does not fall in any configured slab. Slabs on this rule: ${slabSummary}. This client's All Finance amount: ₹${clientAllFinanceAmount.toLocaleString("en-IN")}.`,
        },
      };
    }
  }

  const incentive = getFinanceBonus(counsellorAllFinanceCount, legacyAllFinanceRules);
  const financeSlabRange = findMatchedSlabRange(counsellorAllFinanceCount, legacyAllFinanceRules);
  return {
    incentive,
    detail: {
      ruleName: legacyAllFinanceRules.length ? "All finance (legacy slab)" : undefined,
      ruleType: "slab",
      counsellorAllFinanceCount,
      slabCountChecked: counsellorAllFinanceCount,
      slabCountBasis:
        "Distinct clients of this counsellor with all-finance product payment (entity_type = allFinance_id) in selected period",
      slabRange: financeSlabRange,
      clientAmount: clientAllFinanceAmount,
      ratePerClient: incentive,
      incentiveBlocker:
        incentive > 0 ? "none" : legacyAllFinanceRules.length === 0 ? "no_rule" : "slab_no_match",
      reason:
        incentive > 0
          ? `Counsellor has ${counsellorAllFinanceCount} all-finance client${counsellorAllFinanceCount !== 1 ? "s" : ""} (slab ${financeSlabRange}). Bonus: ₹${incentive.toLocaleString("en-IN")} per client.`
          : legacyAllFinanceRules.length === 0
            ? "No All Finance bonus rules are configured for this period."
            : `Counsellor has ${counsellorAllFinanceCount} all-finance client${counsellorAllFinanceCount !== 1 ? "s" : ""} — does not meet any configured legacy slab threshold.`,
    },
  };
}

// Resolves the core-sale incentive and eligibility detail for a single client.
// Checks the sale-type-specific rule map first; falls back to legacy category rules.
//
// Slab rules  → TEAM-BASED: company-wide total count for that rule config determines the
//               slab tier; ALL counsellors' clients in that config earn the same per-client rate.
// Budget rules → default: counsellor cumulative amount per rule config vs thresholds.
// Visitor / spouse: per-client Initial amount, else Before Visa (never full total for tiering).
function resolveCoreSale(
  saleType: string,
  saleTypeId: number,
  counsellorId: number,
  saleTypeRuleMap: SaleTypeRuleMap,
  companyWideRuleConfigCounts: Map<number, number>,
  counsellorRuleConfigAmounts: Map<number, Map<number, number>>,
  spouseCount: number,
  stat: CounsellorStat,
  rules: IncentiveRulesPayload,
  stage: PaymentStage | undefined
): CoreSaleResult {
  const saleTypeLower = saleType.toLowerCase();
  const ruleConfig = saleTypeRuleMap.get(saleTypeId);

  // All Finance & Employment (budget) is its own card — never fold into core sale.
  if (ruleConfig && isAllFinanceLineBudgetConfig(ruleConfig)) {
    return { incentive: 0, detail: null };
  }

  if (ruleConfig) {
    if (ruleConfig.ruleType === "slab" || ruleConfig.ruleType === "budget_threshold_slab") {
      const minGate =
        ruleConfig.ruleType === "budget_threshold_slab" ? (ruleConfig.minBudgetThreshold ?? 0) : 0;
      if (minGate > 0) {
        const useVisitorSpouseStageBasis = saleTypeLower === "visitor" || saleTypeLower === "spouse";
        const gateAmount = useVisitorSpouseStageBasis
          ? visitorSpouseBudgetBasis(stage).amount
          : counsellorRuleConfigAmounts.get(counsellorId)?.get(ruleConfig.configId) ?? 0;
        if (gateAmount < minGate) {
          const detail: CoreSaleRuleDetail = {
            ruleName:        ruleConfig.name,
            ruleType:        "budget_threshold_slab",
            counsellorTotal: gateAmount,
            thresholdMet:    minGate,
            ratePerClient:  0,
            reason:
              `Budget gate for "${ruleConfig.name}" requires ≥ ₹${minGate.toLocaleString("en-IN")} on the payment basis; current amount is ₹${gateAmount.toLocaleString("en-IN")} — slabs do not apply.`,
          };
          return { incentive: 0, detail };
        }
      }

      const teamCount = companyWideRuleConfigCounts.get(ruleConfig.configId) ?? 0;
      const incentive = findSlab(teamCount, ruleConfig.slabRules);
      const slabRange = findMatchedSlabRange(teamCount, ruleConfig.slabRules);
      const detail: CoreSaleRuleDetail = {
        ruleName:     ruleConfig.name,
        ruleType:     ruleConfig.ruleType === "budget_threshold_slab" ? "budget_threshold_slab" : "slab",
        teamCount,
        slabRange,
        ratePerClient: incentive,
        reason: incentive > 0
          ? `Team total for "${ruleConfig.name}" is ${teamCount} client${teamCount !== 1 ? "s" : ""} (slab ${slabRange}). Rate: ₹${incentive.toLocaleString("en-IN")} per client.`
          : `Team total for "${ruleConfig.name}" is ${teamCount} client${teamCount !== 1 ? "s" : ""}. No slab threshold reached — not eligible.`,
      };
      return { incentive, detail };
    }

    // Budget-based
    const useVisitorSpouseStageBasis =
      saleTypeLower === "visitor" || saleTypeLower === "spouse";
    const { amount: budgetBasis, basisLabel } = useVisitorSpouseStageBasis
      ? visitorSpouseBudgetBasis(stage)
      : {
          amount: counsellorRuleConfigAmounts.get(counsellorId)?.get(ruleConfig.configId) ?? 0,
          basisLabel: "",
        };
    const incentive = getVisitorIncentive(budgetBasis, ruleConfig.budgetRules);
    const thresholdMet = findMatchedThreshold(budgetBasis, ruleConfig.budgetRules);
    const detail: CoreSaleRuleDetail = {
      ruleName:        ruleConfig.name,
      ruleType:        "budget",
      counsellorTotal: budgetBasis,
      thresholdMet,
      ratePerClient:   incentive,
      reason: useVisitorSpouseStageBasis
        ? incentive > 0
          ? `${basisLabel} amount for this client is ₹${budgetBasis.toLocaleString("en-IN")} under "${ruleConfig.name}" (threshold ≥₹${thresholdMet?.toLocaleString("en-IN")}). Rate: ₹${incentive.toLocaleString("en-IN")} per client.`
          : `${basisLabel} amount for this client is ₹${budgetBasis.toLocaleString("en-IN")} under "${ruleConfig.name}". No budget threshold reached — not eligible.`
        : incentive > 0
          ? `Total received for "${ruleConfig.name}" clients is ₹${budgetBasis.toLocaleString("en-IN")} (threshold ≥₹${thresholdMet?.toLocaleString("en-IN")}). Rate: ₹${incentive.toLocaleString("en-IN")} per client.`
          : `Total received for "${ruleConfig.name}" clients is ₹${budgetBasis.toLocaleString("en-IN")}. No budget threshold reached — not eligible.`,
    };
    return { incentive, detail };
  }

  // Legacy fallback when no sale-type-specific config is found
  if (saleTypeLower === "spouse") {
    const incentive = getSpouseIncentive(spouseCount, rules.coreSpouseRules);
    const slabRange = findMatchedSlabRange(spouseCount, rules.coreSpouseRules);
    const detail: CoreSaleRuleDetail = {
      ruleName:     "Spouse",
      ruleType:     "slab",
      teamCount:    spouseCount,
      slabRange,
      ratePerClient: incentive,
      reason: incentive > 0
        ? `Company-wide spouse count is ${spouseCount} (slab ${slabRange}). Rate: ₹${incentive.toLocaleString("en-IN")} per client.`
        : `Company-wide spouse count is ${spouseCount}. No slab threshold reached — not eligible.`,
    };
    return { incentive, detail };
  }

  if (saleTypeLower === "visitor") {
    const { amount: budgetBasis, basisLabel } = visitorSpouseBudgetBasis(stage);
    const incentive = getVisitorIncentive(budgetBasis, rules.coreVisitorRules);
    const thresholdMet = findMatchedThreshold(budgetBasis, rules.coreVisitorRules);
    const detail: CoreSaleRuleDetail = {
      ruleName:        "Visitor",
      ruleType:        "budget",
      counsellorTotal: budgetBasis,
      thresholdMet,
      ratePerClient:   incentive,
      reason: incentive > 0
        ? `${basisLabel} amount for this client is ₹${budgetBasis.toLocaleString("en-IN")} (threshold ≥₹${thresholdMet?.toLocaleString("en-IN")}). Rate: ₹${incentive.toLocaleString("en-IN")} per client.`
        : `${basisLabel} amount for this client is ₹${budgetBasis.toLocaleString("en-IN")}. No budget threshold reached — not eligible.`,
    };
    return { incentive, detail };
  }

  if (saleTypeLower === "student") {
    const studentIncentive = getStudentIncentive(stat.studentCount, rules.studentRules);
    const canadaBonus     = getCanadaStudentBonus(stat.canadaStudentCount, rules.canadaStudentRules);
    const incentive       = studentIncentive + canadaBonus;
    const slabRange       = findMatchedSlabRange(stat.studentCount, rules.studentRules);
    const detail: CoreSaleRuleDetail = {
      ruleName:     "Student",
      ruleType:     "slab",
      teamCount:    stat.studentCount,
      slabRange,
      ratePerClient: studentIncentive,
      reason: incentive > 0
        ? `Counsellor's student count is ${stat.studentCount} (slab ${slabRange}). Rate: ₹${studentIncentive.toLocaleString("en-IN")} per client${canadaBonus > 0 ? ` + ₹${canadaBonus.toLocaleString("en-IN")} Canada bonus` : ""}.`
        : `Counsellor's student count is ${stat.studentCount}. No slab threshold reached — not eligible.`,
    };
    return { incentive, detail };
  }

  return { incentive: 0, detail: null };
}

/** Map / DB All Finance line entry, or legacy payload-only budget tiers from `getRules`. */
function buildAllFinanceRuleEntryForReport(
  saleTypeOrDbEntry: RuleConfigEntry | undefined,
  payloadBudgetRules: CategoryRuleItem[]
): RuleConfigEntry | undefined {
  if (saleTypeOrDbEntry && isAllFinanceLineBudgetConfig(saleTypeOrDbEntry)) {
    return saleTypeOrDbEntry;
  }
  if (payloadBudgetRules.length > 0) {
    return {
      configId: 0,
      name: "All finance (configured tiers)",
      ruleType: "budget",
      slabRules: [],
      budgetRules: payloadBudgetRules,
    };
  }
  return undefined;
}

export async function getIncentiveReport(
  params: ReportParams
): Promise<ReportResponse> {
  const { page, pageSize, startDate, endDate, clientId } = params;
  const offset = (page - 1) * pageSize;

  // Run rules fetch + counsellor stats + spouse count + total count in parallel.
  const [
    rules,
    saleTypeRuleMap,
    otherProductRuleMap,
    productNameToOpKey,
    counsellorStats,
    saleTypeCounts,
    spouseCount,
    totalRecords,
  ] = await Promise.all([
    getCachedRules(startDate, endDate),
    getCachedSaleTypeRuleMap(startDate, endDate),
    getCachedOtherProductRuleMap(startDate, endDate),
    getProductNameToOpRuleKeyMap(),
    getCounsellorStats(startDate, endDate),
    getCounsellorSaleTypeCounts(startDate, endDate),
    getCompanyWideSpouseCount(startDate, endDate),
    getTotalClientCount(startDate, endDate, clientId),
  ]);

  const fromMapAllFinance = collectAllFinanceRuleEntriesFromSaleTypeMap(saleTypeRuleMap);
  const fromDbAllFinance = await listAllFinanceRuleEntriesFromDb(startDate, endDate);
  const allFinanceRuleCandidates = mergeAllFinanceRuleEntriesByConfigId(fromDbAllFinance, fromMapAllFinance);

  const hasNewAllFinanceBudgetRules =
    allFinanceRuleCandidates.some((e) => e.ruleType === "budget" && e.budgetRules.length > 0) ||
    rules.allFinanceBudgetRules.length > 0;
  const hasNewAllFinanceBudgetSlabRules = allFinanceRuleCandidates.some(
    (e) => e.ruleType === "budget_threshold_slab" && e.slabRules.length > 0
  );

  // Temporary: log diagnostics when no data is found to help identify root cause.
  if (totalRecords === 0) {
    await runIncentiveDiagnostics(startDate, endDate);
  }

  const noRulesConfigured =
    saleTypeRuleMap.size === 0 &&
    otherProductRuleMap.size === 0 &&
    rules.coreSpouseRules.length === 0 &&
    rules.financeSpouseRules.length === 0 &&
    rules.coreVisitorRules.length === 0 &&
    rules.visitorProductRules.length === 0 &&
    rules.canadaStudentRules.length === 0 &&
    rules.studentRules.length === 0 &&
    rules.allFinanceRules.length === 0 &&
    rules.allFinanceBudgetRules.length === 0 &&
    !hasNewAllFinanceBudgetRules &&
    !hasNewAllFinanceBudgetSlabRules;

  // Company-wide client count per slab rule config only (budget / All Finance use separate logic).
  const companyWideRuleConfigCounts = new Map<number, number>();
  for (const [, stCountMap] of saleTypeCounts) {
    for (const [stId, cnt] of stCountMap) {
      const rc = saleTypeRuleMap.get(stId);
      if (!rc || (rc.ruleType !== "slab" && rc.ruleType !== "budget_threshold_slab")) continue;
      companyWideRuleConfigCounts.set(rc.configId, (companyWideRuleConfigCounts.get(rc.configId) ?? 0) + cnt);
    }
  }

  // Compute totalIncentiveAmount across ALL clients.
  // Visitor now uses each client's own received amount (not counsellor aggregate),
  // so we evaluate per-client for correctness.
  const allClientsForTotals =
    totalRecords > 0 ? await getPaginatedClients(startDate, endDate, totalRecords, 0, clientId) : [];
  // Deduplicate client IDs — handled-by rows repeat the same clientId with a different counsellorId.
  const allClientIdsForTotals = [...new Set(allClientsForTotals.map((c) => c.clientId))];

  // Fetch product display names once — reused for both the period total and the page data.
  const productDisplayNames = await getProductDisplayNameMap();

  const [allPaymentStagesForTotals, allFinanceAmountsForTotals, allOtherProductPaymentDetailsForTotals, allFinancePaymentDetailsForTotals] = await Promise.all([
    getClientPaymentStages(allClientIdsForTotals),
    getClientAllFinanceAmounts(allClientIdsForTotals, startDate, endDate),
    getOtherProductPaymentsDetailsByClientIds(allClientIdsForTotals),
    getAllFinancePaymentsDetailsByClientIds(allClientIdsForTotals),
  ]);

  const counsellorAllFinanceAmountTotals = new Map<number, number>();
  for (const client of allClientsForTotals) {
    if (client.isHandledByRow) continue;
    const a = allFinanceAmountsForTotals.get(client.clientId) ?? 0;
    if (a === 0) continue;
    // For shared clients, attribute AF amount to whoever actually handled the payment.
    // Transferred-to row: only if this counsellor handled the AF payment.
    // Primary row: only if no transferred-to counsellor handled it.
    const isTransferredToRowT = client.originalCounsellorId != null;
    const afPaymentsT = allFinancePaymentDetailsForTotals.get(client.clientId) ?? [];
    if (isTransferredToRowT) {
      if (!afPaymentsT.some((p) => p.handledBy === client.counsellorId)) continue;
    } else {
      if (afPaymentsT.some((p) => p.handledBy != null && p.handledBy !== client.counsellorId)) continue;
    }
    counsellorAllFinanceAmountTotals.set(
      client.counsellorId,
      (counsellorAllFinanceAmountTotals.get(client.counsellorId) ?? 0) + a
    );
  }

  // Per-counsellor total received amount per rule config — drives budget tier eligibility.
  // Built from all clients in the period (not just the current page) so the threshold check
  // reflects the counsellor's full period total, not just what's visible on this page.
  const counsellorRuleConfigAmounts = new Map<number, Map<number, number>>();
  for (const client of allClientsForTotals) {
    // Skip handled-by/transferred-to rows and product-only clients — rule config amounts belong to
    // the original counsellor for clients enrolled in the period only.
    const isProductOnlyForRule = client.enrollmentDate < startDate || client.enrollmentDate > endDate;
    if (client.isHandledByRow || client.originalCounsellorId != null || isProductOnlyForRule) continue;
    if (client.saleTypeId == null) continue;
    const rc = saleTypeRuleMap.get(client.saleTypeId);
    if (!rc || isAllFinanceLineBudgetConfig(rc)) continue;
    const stLower = client.saleType!.toLowerCase();
    if (
      (rc.ruleType === "budget" || rc.ruleType === "budget_threshold_slab") &&
      (stLower === "visitor" || stLower === "spouse")
    ) {
      continue;
    }
    const stage = allPaymentStagesForTotals.get(client.clientId);
    const amt = computeReceivedAmount(stage);
    if (!counsellorRuleConfigAmounts.has(client.counsellorId)) {
      counsellorRuleConfigAmounts.set(client.counsellorId, new Map());
    }
    const perConfig = counsellorRuleConfigAmounts.get(client.counsellorId)!;
    perConfig.set(rc.configId, (perConfig.get(rc.configId) ?? 0) + amt);
  }

  let totalIncentiveAmount = 0;
  for (const client of allClientsForTotals) {
    const stLower = client.saleType?.toLowerCase() ?? null;
    const stat = counsellorStats.get(client.counsellorId) ?? emptyStat(client.counsellorId);
    // Clients enrolled outside the report period appear only because they have product
    // payments dated within the period; core sale and all-finance are zero for them.
    const isProductOnlyClient = client.enrollmentDate < startDate || client.enrollmentDate > endDate;

    // Handled-by and transferred-to rows only contribute other-product incentives for
    // specific payments this counsellor handled; core sale stays with the primary counsellor.
    const isTransferredToRowTotals = !client.isHandledByRow && client.originalCounsellorId != null;
    const allRawProductRows = allOtherProductPaymentDetailsForTotals.get(client.clientId) ?? [];
    const periodFilteredForTotals = filterProductRowsByPeriod(allRawProductRows, startDate, endDate, isProductOnlyClient);
    const productRowsForThisCounsellor = (() => {
      if (client.isHandledByRow)        return periodFilteredForTotals.filter((r) => r.handledBy === client.counsellorId);
      if (isTransferredToRowTotals)     return periodFilteredForTotals.filter((r) => r.handledBy == null || r.handledBy === client.counsellorId);
      if (client.transferStatus)        return periodFilteredForTotals.filter((r) => r.handledBy === client.counsellorId);
      return periodFilteredForTotals.filter((r) => r.handledBy == null || r.handledBy === client.counsellorId);
    })();

    // Determine if this counsellor row "owns" the All Finance payment for this client.
    // Transferred-to counsellor: only if they handled the AF payment.
    // Primary counsellor: only if no transferred-to counsellor handled it.
    const afPaymentsTotals = allFinancePaymentDetailsForTotals.get(client.clientId) ?? [];
    const shouldShowAllFinanceTotals = (() => {
      if (client.isHandledByRow) return false;
      if (isTransferredToRowTotals) return afPaymentsTotals.some((p) => p.handledBy === client.counsellorId);
      return !afPaymentsTotals.some((p) => p.handledBy != null && p.handledBy !== client.counsellorId);
    })();

    let allFinanceIncentive = 0;
    if (shouldShowAllFinanceTotals && stLower && client.saleTypeId != null) {
      const pickedAllFinance = pickAllFinanceRuleForClient(
        allFinanceRuleCandidates,
        stLower,
        client.saleTypeId,
        saleTypeRuleMap
      );
      const allFinanceResolvedForClient = buildAllFinanceRuleEntryForReport(
        pickedAllFinance,
        rules.allFinanceBudgetRules
      );
      const allFinanceCtx: AllFinanceResolutionContext = {
        saleTypeLower: stLower,
        saleTypeId: client.saleTypeId,
        paymentStage: allPaymentStagesForTotals.get(client.clientId),
        saleTypeRuleMap,
        companyWideRuleConfigCounts,
        spouseCount,
        counsellorStat: stat,
      };
      ({ incentive: allFinanceIncentive } = resolveAllFinancePerClientIncentive(
        allFinanceResolvedForClient,
        shouldShowAllFinanceTotals ? (allFinanceAmountsForTotals.get(client.clientId) ?? 0) : 0,
        stat.allFinanceCount,
        counsellorAllFinanceAmountTotals.get(client.counsellorId) ?? 0,
        rules.allFinanceRules,
        allFinanceCtx
      ));
    }

    const { incentive: coreSaleIncentive } = !client.isHandledByRow && !isTransferredToRowTotals && !isProductOnlyClient && client.saleType
      ? resolveCoreSale(
          client.saleType,
          client.saleTypeId!,
          client.counsellorId,
          saleTypeRuleMap,
          companyWideRuleConfigCounts,
          counsellorRuleConfigAmounts,
          spouseCount,
          stat,
          rules,
          allPaymentStagesForTotals.get(client.clientId)
        )
      : { incentive: 0 };

    const otherProductsIncentive = APPLY_OTHER_PRODUCT_INCENTIVES_IN_REPORT
      ? productRowsForThisCounsellor.reduce((sum, row) => {
          const productName = String(row.productName);
          const amount = resolveEntityAmount(row);
          const entity = (row.entity ?? {}) as Record<string, unknown>;
          const subType = entity.type ? String(entity.type) : null;
          const baseName = productDisplayNames.get(productName) ?? productName.replace(/_/g, " ");
          const displayName = subType ? `${baseName} (${subType})` : baseName;
          return (
            sum +
            resolveOtherProductLineIncentive(
              productName,
              amount,
              displayName,
              stLower ?? "",
              productNameToOpKey,
              otherProductRuleMap,
              rules,
              allPaymentStagesForTotals.get(client.clientId)
            )
          );
        }, 0)
      : 0;
    totalIncentiveAmount += coreSaleIncentive + allFinanceIncentive + otherProductsIncentive;
  }

  // Fetch paginated client rows, then batch-fetch their payment stages + product data.
  const clients = await getPaginatedClients(startDate, endDate, pageSize, offset, clientId);
  // Deduplicate — handled-by rows repeat the same clientId under a different counsellorId.
  const clientIds = [...new Set(clients.map((c) => c.clientId))];
  const [paymentStages, allFinanceAmounts, otherProductPaymentDetails, allFinancePaymentDetails] =
    await Promise.all([
      getClientPaymentStages(clientIds),
      getClientAllFinanceAmounts(clientIds, startDate, endDate),
      getOtherProductPaymentsDetailsByClientIds(clientIds),
      getAllFinancePaymentsDetailsByClientIds(clientIds),
    ]);
  const actionStateMap = await getIncentiveActionStateForClientsInRange(clientIds, startDate, endDate);

  const data: ReportItem[] = clients.map((client) => {
    // Clients enrolled outside the report period appear only because of product payments
    // dated within the period; core sale incentive is always 0 for them.
    // All Finance incentive IS calculated when their payment date falls in the period.
    const isProductOnlyClient = client.enrollmentDate < startDate || client.enrollmentDate > endDate;

    const stat = counsellorStats.get(client.counsellorId);
    if (!stat && !client.isHandledByRow && !isProductOnlyClient) {
      console.warn(
        `[incentiveReport] counsellor ${client.counsellorId} missing from stats map for client ${client.clientId}`
      );
    }
    const resolvedStat = stat ?? emptyStat(client.counsellorId);
    const stage = paymentStages.get(client.clientId);
    const saleTypeLower = client.saleType?.toLowerCase() ?? null;

    // Transferred-to rows: client appeared under this counsellor via ci.transfered_to_counsellor_id.
    // Like handled-by rows, they only earn incentive on payments they personally handled.
    const isTransferredToRow = !client.isHandledByRow && client.originalCounsellorId != null;

    // For product-only clients: additionally filter all rows by their payment date.
    const allRawProductRows = otherProductPaymentDetails.get(client.clientId) ?? [];
    const periodFiltered = filterProductRowsByPeriod(allRawProductRows, startDate, endDate, isProductOnlyClient);
    // Product row attribution rules:
    //   handled-by row          → only products this counsellor explicitly handled
    //   transferred-to row      → unattributed products (handledBy=null) + their own (they took over the client)
    //   primary + transferred   → primary counsellor yields unattributed products to the transferred-to
    //                             counsellor; only keeps products they explicitly handled
    //   standard primary        → unattributed products + their own
    const filteredProductRows = (() => {
      if (client.isHandledByRow)  return periodFiltered.filter((r) => r.handledBy === client.counsellorId);
      if (isTransferredToRow)    return periodFiltered.filter((r) => r.handledBy == null || r.handledBy === client.counsellorId);
      if (client.transferStatus) return periodFiltered.filter((r) => r.handledBy === client.counsellorId);
      return periodFiltered.filter((r) => r.handledBy == null || r.handledBy === client.counsellorId);
    })();

    // Card 1: Core Sale — 0 for handled-by, transferred-to, and product-only rows.
    const receivedAmount = (client.isHandledByRow || isTransferredToRow) ? 0 : computeReceivedAmount(stage);
    const { incentive: coreSaleIncentive, detail: coreSaleDetail } =
      !client.isHandledByRow && !isTransferredToRow && !isProductOnlyClient && client.saleType
        ? resolveCoreSale(
            client.saleType,
            client.saleTypeId!,
            client.counsellorId,
            saleTypeRuleMap,
            companyWideRuleConfigCounts,
            counsellorRuleConfigAmounts,
            spouseCount,
            resolvedStat,
            rules,
            paymentStages.get(client.clientId)
          )
        : { incentive: 0, detail: null };

    const coreSaleItems: CoreSaleItem[] = [];
    if (!client.isHandledByRow && !isTransferredToRow && stage) {
      if (stage.initialAmount > 0) {
        coreSaleItems.push({ label: "Initial", amount: stage.initialAmount, paymentDate: stage.initialPaymentDate });
      }
      if (stage.beforeVisaAmount > 0) {
        coreSaleItems.push({
          label: "Before Visa",
          amount: stage.beforeVisaAmount,
          paymentDate: stage.beforeVisaPaymentDate,
        });
      }
      if (stage.afterVisaAmount > 0) {
        coreSaleItems.push({ label: "After Visa", amount: stage.afterVisaAmount, paymentDate: stage.afterVisaPaymentDate });
      }
    }
    const coreSale: CoreSale = {
      items:      coreSaleItems,
      eligible:   coreSaleIncentive > 0,
      incentive:  coreSaleIncentive,
      ruleDetail: coreSaleDetail,
    };

    // Card 2: All Finance — attribute to whoever handled the payment.
    // Transferred-to counsellor: only if they handled the AF payment.
    // Primary counsellor: only if no transferred-to counsellor handled it.
    const afPaymentsForClient = allFinancePaymentDetails.get(client.clientId) ?? [];
    const shouldShowAllFinance = (() => {
      if (client.isHandledByRow) return false;
      if (isTransferredToRow) return afPaymentsForClient.some((p) => p.handledBy === client.counsellorId);
      return !afPaymentsForClient.some((p) => p.handledBy != null && p.handledBy !== client.counsellorId);
    })();
    const allFinanceAmount = shouldShowAllFinance ? (allFinanceAmounts.get(client.clientId) ?? 0) : 0;
    let financeBonus = 0;
    let allFinanceRuleDetail: AllFinanceRuleDetail | null = null;
    if (shouldShowAllFinance && saleTypeLower && client.saleTypeId != null) {
      const pickedAllFinanceRow = pickAllFinanceRuleForClient(
        allFinanceRuleCandidates,
        saleTypeLower,
        client.saleTypeId,
        saleTypeRuleMap
      );
      const allFinanceResolvedForClientRow = buildAllFinanceRuleEntryForReport(
        pickedAllFinanceRow,
        rules.allFinanceBudgetRules
      );
      const allFinanceCtxRow: AllFinanceResolutionContext = {
        saleTypeLower,
        saleTypeId: client.saleTypeId,
        paymentStage: paymentStages.get(client.clientId),
        saleTypeRuleMap,
        companyWideRuleConfigCounts,
        spouseCount,
        counsellorStat: resolvedStat,
      };
      ({ incentive: financeBonus, detail: allFinanceRuleDetail } = resolveAllFinancePerClientIncentive(
        allFinanceResolvedForClientRow,
        allFinanceAmount,
        resolvedStat.allFinanceCount,
        counsellorAllFinanceAmountTotals.get(client.counsellorId) ?? 0,
        rules.allFinanceRules,
        allFinanceCtxRow
      ));
    }
    const allFinance: AllFinanceBreakdown = {
      amount:     allFinanceAmount,
      eligible:   financeBonus > 0,
      incentive:  financeBonus,
      ruleDetail: allFinanceRuleDetail,
      payments:   shouldShowAllFinance ? (allFinancePaymentDetails.get(client.clientId) ?? []) : [],
    };

    // Card 3: Other Products — one item per payment row (not grouped by name), so multiple
    // payments of the same product type (e.g. two visa extensions) each get their own entry.
    const otherProductItems: OtherProductItem[] = filteredProductRows.map((row) => {
      const productName = String(row.productName);
      const amount = resolveEntityAmount(row);
      const entity = (row.entity ?? {}) as Record<string, unknown>;
      const subType = entity.type ? String(entity.type) : null;
      const baseName = productDisplayNames.get(productName) ?? productName.replace(/_/g, " ");
      const displayName = subType ? `${baseName} (${subType})` : baseName;
      const paymentDate = resolveProductPaymentDate(row);
      const productIncentive = APPLY_OTHER_PRODUCT_INCENTIVES_IN_REPORT
        ? resolveOtherProductLineIncentive(
            productName,
            amount,
            displayName,
            saleTypeLower ?? "",
            productNameToOpKey,
            otherProductRuleMap,
            rules,
            paymentStages.get(client.clientId)
          )
        : 0;
      return {
        name: displayName,
        amountReceived: amount,
        paymentDate,
        eligible: productIncentive > 0,
        incentive: productIncentive,
      };
    });
    const otherProductsIncentive = otherProductItems.reduce((sum, p) => sum + p.incentive, 0);
    const totalAmountReceived = otherProductItems.reduce((sum, p) => sum + p.amountReceived, 0);
    const otherProducts: OtherProductsBreakdown = {
      items: otherProductItems,
      totalAmountReceived,
      incentive: otherProductsIncentive,
      payments: filteredProductRows,
    };

    const originalIncentiveAmount = coreSaleIncentive + financeBonus + otherProductsIncentive;
    const actionState = actionStateMap.get(client.clientId);
    const effectiveCore =
      actionState?.overrideCoreSale !== null && actionState?.overrideCoreSale !== undefined
        ? Number(actionState.overrideCoreSale)
        : coreSaleIncentive;
    const effectiveFinance =
      actionState?.overrideAllFinance !== null && actionState?.overrideAllFinance !== undefined
        ? Number(actionState.overrideAllFinance)
        : financeBonus;
    const effectiveProducts =
      actionState?.overrideOtherProducts !== null && actionState?.overrideOtherProducts !== undefined
        ? Number(actionState.overrideOtherProducts)
        : otherProductsIncentive;
    const hasSectionOverride =
      (actionState?.overrideCoreSale !== null && actionState?.overrideCoreSale !== undefined) ||
      (actionState?.overrideAllFinance !== null && actionState?.overrideAllFinance !== undefined) ||
      (actionState?.overrideOtherProducts !== null && actionState?.overrideOtherProducts !== undefined);
    const hasTotalOverride = actionState?.overrideAmount !== null && actionState?.overrideAmount !== undefined;
    const isOverridden = hasSectionOverride || hasTotalOverride;
    // For Approved/Rejected records use the amount that was locked when the action was taken.
    // total_incentive_amount is written by persistIncentiveAction and is the single source of
    // truth for finalised records — avoids recalculation drift after approval.
    const incentiveAmount = (() => {
      if (hasTotalOverride) return Number(actionState!.overrideAmount);
      if (actionState?.status === "Approved") return actionState.totalIncentiveAmount;
      if (actionState?.status === "Rejected") return 0;
      return effectiveCore + effectiveFinance + effectiveProducts;
    })();

    return {
      clientId:             client.clientId,
      counsellorId:         client.counsellorId,
      clientName:           client.clientName,
      counsellor:           client.counsellor,
      enrollmentDate:       client.enrollmentDate,
      paymentDate:          (client.isHandledByRow || isTransferredToRow) ? null : (stage?.latestPaymentDate ?? null),
      saleType:             client.saleType
                              ? (client.saleType.charAt(0).toUpperCase() + client.saleType.slice(1)) as "Spouse" | "Visitor" | "Student"
                              : null,
      saleTypeName:         client.saleTypeName,
      saleTypeCategoryId:   client.saleTypeCategoryId,
      eligible:             incentiveAmount > 0,
      receivedAmount,
      originalIncentiveAmount,
      incentiveAmount,
      isOverridden,
      overrideAmount:       actionState?.overrideAmount ?? null,
      overrideCoreSale:     actionState?.overrideCoreSale ?? null,
      overrideAllFinance:   actionState?.overrideAllFinance ?? null,
      overrideOtherProducts: actionState?.overrideOtherProducts ?? null,
      overrideByUserId:     actionState?.overrideByUserId ?? null,
      remark:               actionState?.remark ?? null,
      status:               actionState?.status ?? "Pending",
      coreSale,
      allFinance,
      otherProducts,
      isHandledByRow:       client.isHandledByRow,
      isSharedClient:       client.isHandledByRow || client.transferStatus,
      originalCounsellorId: client.originalCounsellorId,
    };
  });

  return {
    ...(noRulesConfigured && {
      warning: "No incentive rules are configured. Please add rules to check eligibility.",
    }),
    info: buildIncentiveInfo(rules),
    data,
    pagination: {
      page,
      pageSize,
      totalRecords,
      totalPages: Math.ceil(totalRecords / pageSize),
      totalIncentiveAmount,
    },
  };
}

export interface ProcessIncentiveActionInput {
  clientId: number;
  periodId?: number;
  action: "APPROVE" | "REJECT" | "PENDING";
  overrideAmount?: number;
  overrides?: {
    coreSale?: number;
    allFinance?: number;
    otherProducts?: number;
  };
  remark?: string;
  actionBy: number;
  allowApprovedEdit?: boolean;
}

export async function processIncentiveAction(input: ProcessIncentiveActionInput): Promise<void> {
  if (input.overrideAmount !== undefined) {
    if (typeof input.overrideAmount !== "number" || Number.isNaN(input.overrideAmount) || input.overrideAmount <= 0) {
      throw new Error("overrideAmount must be a positive number");
    }
  }
  if (
    input.overrides?.coreSale !== undefined &&
    (typeof input.overrides.coreSale !== "number" || Number.isNaN(input.overrides.coreSale) || input.overrides.coreSale < 0)
  ) {
    throw new Error("overrides.coreSale must be a non-negative number");
  }
  if (
    input.overrides?.allFinance !== undefined &&
    (typeof input.overrides.allFinance !== "number" || Number.isNaN(input.overrides.allFinance) || input.overrides.allFinance < 0)
  ) {
    throw new Error("overrides.allFinance must be a non-negative number");
  }
  if (
    input.overrides?.otherProducts !== undefined &&
    (typeof input.overrides.otherProducts !== "number" || Number.isNaN(input.overrides.otherProducts) || input.overrides.otherProducts < 0)
  ) {
    throw new Error("overrides.otherProducts must be a non-negative number");
  }

  let resolvedPeriodId: number;
  let period: { id: number; startDate: string; endDate: string | null } | null;
  if (input.periodId !== undefined) {
    period = await getPeriodRangeById(input.periodId);
    if (period && period.endDate) {
      resolvedPeriodId = input.periodId;
    } else {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      resolvedPeriodId = await getOrCreatePeriodByDateRange(startDate, endDate);
      period = await getPeriodRangeById(resolvedPeriodId);
      if (!period || !period.endDate) throw new Error("Invalid periodId");
    }
  } else {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    resolvedPeriodId = await getOrCreatePeriodByDateRange(startDate, endDate);
    period = await getPeriodRangeById(resolvedPeriodId);
    if (!period || !period.endDate) throw new Error("Invalid periodId");
  }

  let report = await getIncentiveReport({
    page: 1,
    pageSize: 1,
    startDate: period.startDate,
    endDate: period.endDate,
    clientId: input.clientId,
  });

  let client = report.data[0];
  if (!client || client.clientId !== input.clientId) {
    report = await getIncentiveReport({
      page: 1,
      pageSize: 1,
      startDate: "2000-01-01",
      endDate: "2100-12-31",
      clientId: input.clientId,
    });
    client = report.data[0];
    if (!client || client.clientId !== input.clientId) {
      throw new Error("Client not found in selected period");
    }
    const enrollmentDate = new Date(client.enrollmentDate);
    const startDate = new Date(enrollmentDate.getFullYear(), enrollmentDate.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const endDate = new Date(enrollmentDate.getFullYear(), enrollmentDate.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    resolvedPeriodId = await getOrCreatePeriodByDateRange(startDate, endDate);
  }

  const existing = await getIncentiveRecordByClientPeriod(input.clientId, resolvedPeriodId);
  if (existing?.status === "APPROVED" && !input.allowApprovedEdit) {
    throw new Error("Already approved");
  }

  const coreAmountRawDefault = client.coreSale?.incentive || 0;
  const financeAmountRawDefault = client.allFinance?.incentive || 0;
  const productAmountRawDefault = client.otherProducts?.incentive || 0;
  let preserveExistingBreakdowns = false;

  let coreAmountRaw = coreAmountRawDefault;
  let financeAmountRaw = financeAmountRawDefault;
  let productAmountRaw = productAmountRawDefault;

  if (input.action === "APPROVE" && existing?.id) {
    const approvedBreakdownTotals = await getApprovedBreakdownTotals(existing.id);
    if (approvedBreakdownTotals.hasBreakdowns) {
      coreAmountRaw = approvedBreakdownTotals.coreApprovedAmount;
      financeAmountRaw = approvedBreakdownTotals.allFinanceApprovedAmount;
      productAmountRaw = approvedBreakdownTotals.otherProductApprovedAmount;
      preserveExistingBreakdowns = true;
    }
  }

  const coreAmount = input.action === "REJECT" ? 0 : coreAmountRaw;
  const financeAmount = input.action === "REJECT" ? 0 : financeAmountRaw;
  const productAmount = input.action === "REJECT" ? 0 : productAmountRaw;
  const effectiveCoreAmount = input.action === "REJECT" ? 0 : (input.overrides?.coreSale ?? coreAmount);
  const effectiveFinanceAmount = input.action === "REJECT" ? 0 : (input.overrides?.allFinance ?? financeAmount);
  const effectiveProductAmount =
    input.action === "REJECT" ? 0 : (input.overrides?.otherProducts ?? productAmount);

  const totalAmount =
    input.action === "REJECT"
      ? 0
      : input.overrideAmount ?? (effectiveCoreAmount + effectiveFinanceAmount + effectiveProductAmount);

  await persistIncentiveAction({
    clientId: client.clientId,
    counsellorId: client.counsellorId,
    periodId: resolvedPeriodId,
    saleTypeCategoryId: client.saleTypeCategoryId,
    coreIncentiveAmount: coreAmount,
    financeIncentiveAmount: financeAmount,
    otherProductIncentiveAmount: productAmount,
    totalIncentiveAmount: totalAmount,
    status:
      input.action === "APPROVE"
        ? "APPROVED"
        : input.action === "REJECT"
          ? "REJECTED"
          : "PENDING",
    calculationSnapshot: client,
    actionBy: input.actionBy,
    remark: input.remark,
    overrideAmount: input.overrideAmount,
    overrideCoreSale: input.overrides?.coreSale,
    overrideAllFinance: input.overrides?.allFinance,
    overrideOtherProducts: input.overrides?.otherProducts,
    existingRecord: existing,
    coreSale: client.coreSale,
    allFinance: client.allFinance,
    otherProducts: client.otherProducts,
    preserveExistingBreakdowns,
  });
}

export interface BulkApproveInput {
  mode: "COUNSELLOR" | "FILTER" | "SELECTED";
  counsellorId?: number;
  status: "APPROVED" | "REJECTED" | "PENDING";
  filters?: {
    counsellorIds?: number[];
    saleTypeCategoryIds?: number[];
  };
  recordIds?: number[];
  approvedBy: number;
}

export interface BulkApproveResult {
  updatedCount: number;
}

export async function getIncentiveReportAll(
  startDate: string,
  endDate: string
): Promise<{
  warning?: string;
  info: IncentiveInfo;
  data: ReportItem[];
  summary: {
    totalRecords: number;
    approved: number;
    rejected: number;
    pending: number;
    totalIncentiveAmount: number;
  };
}> {
  const total = await getTotalClientCount(startDate, endDate);
  const pageSize = Math.max(total, 1);
  const report = await getIncentiveReport({
    page: 1,
    pageSize,
    startDate,
    endDate,
  });

  const filteredData = report.data.filter(
    (row) => row.status === "Approved" || row.status === "Rejected"
  );

  let approved = 0;
  let rejected = 0;
  let pending = 0;
  for (const row of filteredData) {
    if (row.status === "Approved") approved += 1;
    else if (row.status === "Rejected") rejected += 1;
    else pending += 1;
  }

  return {
    warning: report.warning,
    info: report.info,
    data: filteredData,
    summary: {
      totalRecords: filteredData.length,
      approved,
      rejected,
      pending,
      totalIncentiveAmount: filteredData.reduce((sum, row) => sum + row.incentiveAmount, 0),
    },
  };
}

export async function bulkApproveIncentives(input: BulkApproveInput): Promise<BulkApproveResult> {
  const nextStatus = input.status;

  if (input.mode === "SELECTED") {
    const ids = input.recordIds ?? [];
    if (!ids.length) return { updatedCount: 0 };

    const idSql = sql.join(ids.map((id) => sql`${id}`), sql`, `);

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE incentive_record_breakdowns
        SET
          status = ${nextStatus},
          approved_by = ${input.approvedBy},
          approved_at = now()
        WHERE incentive_record_id IN (${idSql})
      `);

      await tx.execute(sql`
        UPDATE incentive_records
        SET
          status = ${nextStatus},
          approved_by = ${input.approvedBy},
          approved_at = now(),
          updated_at = now()
        WHERE id IN (${idSql})
      `);

      await tx.execute(sql`
        UPDATE incentive_records ir
        SET final_incentive = agg.total
        FROM (
          SELECT
            incentive_record_id,
            COALESCE(SUM(calculated_amount::numeric), 0) AS total
          FROM incentive_record_breakdowns
          WHERE status = 'APPROVED'
            AND incentive_record_id IN (${idSql})
          GROUP BY incentive_record_id
        ) agg
        WHERE ir.id = agg.incentive_record_id
      `);
    });

    return { updatedCount: ids.length };
  }

  const recordIds = await (async () => {
    if (input.mode === "COUNSELLOR") {
      const result = await db.execute<{ id: string }>(sql`
        SELECT id
        FROM incentive_records
        WHERE counsellor_id = ${input.counsellorId}
          AND status = 'PENDING'
      `);
      return result.rows.map((row) => Number(row.id));
    }

    const counsellorIds = input.filters?.counsellorIds ?? [];
    const saleTypeCategoryIds = input.filters?.saleTypeCategoryIds ?? [];
    const explicitRecordIds = input.recordIds ?? [];

    const counsellorClause =
      counsellorIds.length > 0
        ? sql`AND counsellor_id IN (${sql.join(counsellorIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``;
    const saleTypeCategoryClause =
      saleTypeCategoryIds.length > 0
        ? sql`AND sale_type_category_id IN (${sql.join(saleTypeCategoryIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``;
    const recordClause =
      explicitRecordIds.length > 0
        ? sql`AND id IN (${sql.join(explicitRecordIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``;

    const result = await db.execute<{ id: string }>(sql`
      SELECT id
      FROM incentive_records
      WHERE status = 'PENDING'
      ${counsellorClause}
      ${saleTypeCategoryClause}
      ${recordClause}
    `);
    return result.rows.map((row) => Number(row.id));
  })();

  if (!recordIds.length) {
    return { updatedCount: 0 };
  }

  const recordIdSql = sql.join(recordIds.map((id) => sql`${id}`), sql`, `);

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE incentive_record_breakdowns
      SET
        status = ${nextStatus},
        approved_by = ${input.approvedBy},
        approved_at = now()
      WHERE incentive_record_id IN (${recordIdSql})
    `);

    await tx.execute(sql`
      UPDATE incentive_records
      SET
        status = ${nextStatus},
        approved_by = ${input.approvedBy},
        approved_at = now(),
        updated_at = now()
      WHERE id IN (${recordIdSql})
    `);

    await tx.execute(sql`
      UPDATE incentive_records ir
      SET final_incentive = agg.total
      FROM (
        SELECT
          incentive_record_id,
          COALESCE(SUM(calculated_amount::numeric), 0) AS total
        FROM incentive_record_breakdowns
        WHERE status = 'APPROVED'
          AND incentive_record_id IN (${recordIdSql})
        GROUP BY incentive_record_id
      ) agg
      WHERE ir.id = agg.incentive_record_id
    `);
  });

  return { updatedCount: recordIds.length };
}
