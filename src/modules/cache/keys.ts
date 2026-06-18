/** Redis key prefixes for modules APIs (DATABASE_URL_SECOND). */
export const MODULE_CACHE_KEYS = {
  COUNTRIES_LIST: "modules:countries:list:",
  COUNTRIES_DETAIL: "modules:countries:id:",
  REPORTS: "modules:reports:",
  VISA_CASE: "modules:visa-case:",
  JOURNEY_TIMELINE: "modules:journey:timeline:",
  JOURNEY_SUMMARY: "modules:journey:summary:",
} as const;

export const MODULE_CACHE_TTL = {
  /** Fallback only — writes call invalidateModulesCachesOnWrite() immediately. */
  COUNTRIES: 3600,
  /** Aggregated dashboards and reports. */
  REPORTS: 300,
  /** Visa case list and detail. */
  VISA_CASE_LIST: 60,
  VISA_CASE_DETAIL: 60,
  VISA_CASE_DASHBOARD: 90,
  /** Static per-role processing stage metadata. */
  VISA_CASE_PROCESSING_STAGES: 3600,
  /** Client journey reads — invalidate on visa/journey mutations. */
  JOURNEY: 120,
} as const;
