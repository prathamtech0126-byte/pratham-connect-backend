import type { RangeRuleItem, CategoryRuleItem } from "../models/incentiveRules.model";

// Returns the incentiveAmount for the first slab where minCount <= count <= maxCount.
// maxCount === -1 is treated as Infinity.
// Assumes rules are in ascending order with non-overlapping ranges.
export function findSlab(count: number, rules: RangeRuleItem[]): number {
  for (const rule of rules) {
    const max = rule.maxCount === -1 ? Infinity : rule.maxCount;
    if (count >= rule.minCount && count <= max) {
      return rule.incentiveAmount;
    }
  }
  return 0;
}

// Spouse is team-based: all counsellors get the same amount derived from company-wide count.
export function getSpouseIncentive(
  companyWideCount: number,
  coreSpouseRules: RangeRuleItem[]
): number {
  return findSlab(companyWideCount, coreSpouseRules);
}

// Visitor is amount-based per counsellor.
// coreVisitorRules labels encode numeric minimum thresholds (e.g. "50000", "1,00,000+").
// Rules must be ordered by sort_order ASC (lowest threshold first).
// Returns the highest tier's incentiveAmount where counsellorTotalAmount >= threshold.
// Rules with non-numeric labels are silently skipped (isNaN check).
export function getVisitorIncentive(
  counsellorTotalAmount: number,
  coreVisitorRules: CategoryRuleItem[]
): number {
  let result = 0;
  for (const rule of coreVisitorRules) {
    const threshold = parseFloat(rule.label.replace(/[^0-9.]/g, ""));
    if (!isNaN(threshold) && counsellorTotalAmount >= threshold) {
      result = rule.incentiveAmount;
    }
  }
  return result;
}

// Student is count-based per counsellor.
export function getStudentIncentive(
  studentCount: number,
  studentRules: RangeRuleItem[]
): number {
  return findSlab(studentCount, studentRules);
}

// Canada Student bonus — added on top of Student incentive.
// Identified by clients who have a TUTION_FEES product payment.
export function getCanadaStudentBonus(
  canadaStudentCount: number,
  canadaStudentRules: RangeRuleItem[]
): number {
  return findSlab(canadaStudentCount, canadaStudentRules);
}

// All Finance bonus — added on top of any sale type's base incentive.
export function getFinanceBonus(
  financeCount: number,
  allFinanceRules: RangeRuleItem[]
): number {
  return findSlab(financeCount, allFinanceRules);
}
