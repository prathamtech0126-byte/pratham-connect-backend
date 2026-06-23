/** Products that count for stats but do not contribute to revenue (matches dashboard.model.ts). */
export const COUNT_ONLY_PRODUCTS = [
  "LOAN_DETAILS",
  "FOREX_CARD",
  "TUTION_FEES",
  "CREDIT_CARD",
  "SIM_CARD_ACTIVATION",
  "INSURANCE",
  "BEACON_ACCOUNT",
  "AIR_TICKET",
  "FOREX_FEES",
] as const;

export const REVENUE_CORE_STAGES = [
  "INITIAL",
  "BEFORE_VISA",
  "AFTER_VISA",
] as const;

export const REVENUE_VIEW_ALL_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "developer",
] as const;
