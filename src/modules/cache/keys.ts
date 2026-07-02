/** Redis key prefixes for modules APIs (DATABASE_URL_SECOND). */
export const MODULE_CACHE_KEYS = {
  COUNTRIES_LIST: "modules:countries:list:",
  COUNTRIES_DETAIL: "modules:countries:id:",
  REPORTS: "modules:reports:",
  VISA_CASE: "modules:visa-case:",
  JOURNEY_TIMELINE: "modules:journey:timeline:",
  JOURNEY_SUMMARY: "modules:journey:summary:",
  /** Front desk dashboard APIs (list, detail, stats, activity). */
  FRONTDESK: "modules:frontdesk:",
  /** Admin-managed stage registry (pipelines + definitions). */
  STAGES_PIPELINES: "modules:stages:pipelines:",
  STAGES_PIPELINE: "modules:stages:pipeline:",
  STAGES_TREE: "modules:stages:tree:",
  STAGES_LIST: "modules:stages:list:",
  STAGES_DETAIL: "modules:stages:id:",
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
  /** Front desk list, detail, stats, activity. */
  FRONT_DESK_LIST: 60,
  FRONT_DESK_DETAIL: 60,
  FRONT_DESK_STATS: 60,
  FRONT_DESK_ACTIVITY: 60,
  /** Sale type filter dropdown — changes infrequently. */
  FRONT_DESK_SALE_TYPES: 3600,
  /** Stage pipelines and definitions — invalidate on admin mutations. */
  STAGES: 3600,
} as const;
