import { redisDelByPrefix, redisGetJson, redisSetJson } from "../../config/redis";
import {
  getTelecallerDashboardStats,
  type TelecallerDashboardStats,
} from "../models/lead.model";

export const TELECALLER_DASHBOARD_STATS_PREFIX = "leads:telecaller-dashboard-stats:";
const TELECALLER_DASHBOARD_STATS_TTL_SECONDS = 120;

export type TelecallerDashboardStatsParams = {
  telecallerId: number;
  createdFrom?: string;
  createdTo?: string;
  followupFrom?: string;
  followupTo?: string;
  followupTodayFrom?: string;
  followupTodayTo?: string;
};

const cacheKeyFor = (params: TelecallerDashboardStatsParams): string =>
  `${TELECALLER_DASHBOARD_STATS_PREFIX}${JSON.stringify(params)}`;

export async function invalidateTelecallerDashboardStatsCaches(): Promise<void> {
  await redisDelByPrefix(TELECALLER_DASHBOARD_STATS_PREFIX);
}

export async function getCachedTelecallerDashboardStats(
  params: TelecallerDashboardStatsParams
): Promise<TelecallerDashboardStats & { cached?: boolean }> {
  const cacheKey = cacheKeyFor(params);
  const cached = await redisGetJson<TelecallerDashboardStats>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const data = await getTelecallerDashboardStats(
    params.telecallerId,
    params.createdFrom ? new Date(params.createdFrom) : undefined,
    params.createdTo ? new Date(params.createdTo) : undefined,
    params.followupFrom ? new Date(params.followupFrom) : undefined,
    params.followupTo ? new Date(params.followupTo) : undefined,
    params.followupTodayFrom ? new Date(params.followupTodayFrom) : undefined,
    params.followupTodayTo ? new Date(params.followupTodayTo) : undefined
  );

  await redisSetJson(cacheKey, data, TELECALLER_DASHBOARD_STATS_TTL_SECONDS);
  return { ...data, cached: false };
}
