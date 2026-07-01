import { getOrSetCache } from "../../../modules/cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../../modules/cache/keys";
import {
  getFrontDeskDashboardStats,
  getFrontDeskLeads,
  getFrontDeskLeadDetail,
  getFrontDeskActivityLogsForViewer,
  getSaleTypeNamesForFilter,
  type FrontDeskLeadFilters,
} from "../models/frontdesk.model";

const scopedKey = (segment: string, payload: unknown): string =>
  `${MODULE_CACHE_KEYS.FRONTDESK}${segment}:${JSON.stringify(payload)}`;

export const getCachedFrontDeskStats = (start?: Date, end?: Date) =>
  getOrSetCache(
    scopedKey("stats", {
      start: start?.toISOString() ?? null,
      end: end?.toISOString() ?? null,
    }),
    MODULE_CACHE_TTL.FRONT_DESK_STATS,
    () => getFrontDeskDashboardStats(start, end)
  );

export const getCachedFrontDeskLeads = (filters: FrontDeskLeadFilters) =>
  getOrSetCache(
    scopedKey("list", filters),
    MODULE_CACHE_TTL.FRONT_DESK_LIST,
    () => getFrontDeskLeads(filters)
  );

export const getCachedFrontDeskLeadDetail = (leadId: number) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.FRONTDESK}detail:${leadId}`,
    MODULE_CACHE_TTL.FRONT_DESK_DETAIL,
    () => getFrontDeskLeadDetail(leadId)
  );

export const getCachedFrontDeskActivityLogs = (
  userId: number,
  viewerRole: string,
  page: number,
  limit: number
) =>
  getOrSetCache(
    scopedKey("activity", { userId, viewerRole, page, limit }),
    MODULE_CACHE_TTL.FRONT_DESK_ACTIVITY,
    () => getFrontDeskActivityLogsForViewer(userId, viewerRole, page, limit)
  );

export const getCachedFrontDeskSaleTypes = () =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.FRONTDESK}sale-types`,
    MODULE_CACHE_TTL.FRONT_DESK_SALE_TYPES,
    getSaleTypeNamesForFilter
  );
