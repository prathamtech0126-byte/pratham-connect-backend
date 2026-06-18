import type { Role } from "../../../types/role";
import { getOrSetCache } from "../../cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../cache/keys";
import type { VisaCaseListFilters } from "../models/visaCase.model";
import {
  getVisaCaseDetail,
  getVisaCaseList,
} from "../services/visaCase.service";
import { getVisaCaseDashboard } from "../services/visaCaseDashboard.service";
import { getVisaCaseProcessingStages } from "../services/visaCaseProcessingStages.service";
import type { DashboardDateFilter } from "../models/visaCaseDashboard.model";

type Viewer = { userId: number; role: Role };

const scopedKey = (
  segment: string,
  viewer: Viewer,
  payload: unknown
): string =>
  `${MODULE_CACHE_KEYS.VISA_CASE}${segment}:${viewer.userId}:${viewer.role}:${JSON.stringify(payload)}`;

export const getCachedVisaCaseProcessingStages = (viewerRole: Role) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.VISA_CASE}processing-stages:${viewerRole}`,
    MODULE_CACHE_TTL.VISA_CASE_PROCESSING_STAGES,
    async () => getVisaCaseProcessingStages(viewerRole)
  );

export const getCachedVisaCaseList = (
  viewer: Viewer,
  query: Partial<VisaCaseListFilters>
) =>
  getOrSetCache(
    scopedKey("list", viewer, query),
    MODULE_CACHE_TTL.VISA_CASE_LIST,
    () => getVisaCaseList(viewer, query)
  );

export const getCachedVisaCaseDetail = (
  visaCaseId: string,
  viewer: Viewer
) =>
  getOrSetCache(
    scopedKey("detail", viewer, { visaCaseId }),
    MODULE_CACHE_TTL.VISA_CASE_DETAIL,
    () => getVisaCaseDetail(visaCaseId, viewer)
  );

export const getCachedVisaCaseDashboard = (
  viewer: Viewer,
  filters: DashboardDateFilter
) =>
  getOrSetCache(
    scopedKey("dashboard", viewer, filters),
    MODULE_CACHE_TTL.VISA_CASE_DASHBOARD,
    () => getVisaCaseDashboard(viewer, filters)
  );
