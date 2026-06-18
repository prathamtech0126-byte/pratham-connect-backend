import type { Role } from "../../../types/role";
import { getOrSetCache } from "../../cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../cache/keys";
import {
  getBackendDashboard,
  type BackendDashboardInput,
} from "../services/backendDashboard.service";
import {
  getBackendReport,
  type BackendReportInput,
} from "../services/backendReport.service";
import {
  getBindingReport,
  type BindingReportInput,
} from "../services/bindingReport.service";
import { getCxReport, type CxReportInput } from "../services/cxReport.service";
import {
  getOpsDashboard,
  type OpsDashboardInput,
} from "../services/opsDashboard.service";

type Viewer = { userId: number; role: Role };

const reportKey = (segment: string, viewer: Viewer, input: unknown) =>
  `${MODULE_CACHE_KEYS.REPORTS}${segment}:${viewer.userId}:${viewer.role}:${JSON.stringify(input)}`;

export const getCachedBackendReport = (
  viewer: Viewer,
  input: BackendReportInput
) =>
  getOrSetCache(
    reportKey("backend-report", viewer, input),
    MODULE_CACHE_TTL.REPORTS,
    () => getBackendReport(viewer, input)
  );

export const getCachedBackendDashboard = (
  viewer: Viewer,
  input: BackendDashboardInput
) =>
  getOrSetCache(
    reportKey("backend-dashboard", viewer, input),
    MODULE_CACHE_TTL.REPORTS,
    () => getBackendDashboard(viewer, input)
  );

export const getCachedOpsDashboard = (viewer: Viewer, input: OpsDashboardInput) =>
  getOrSetCache(
    reportKey("ops-dashboard", viewer, input),
    MODULE_CACHE_TTL.REPORTS,
    () => getOpsDashboard(viewer, input)
  );

export const getCachedCxReport = (viewer: Viewer, input: CxReportInput) =>
  getOrSetCache(
    reportKey("cx-report", viewer, input),
    MODULE_CACHE_TTL.REPORTS,
    () => getCxReport(viewer, input)
  );

export const getCachedBindingReport = (
  viewer: Viewer,
  input: BindingReportInput
) =>
  getOrSetCache(
    reportKey("binding-report", viewer, input),
    MODULE_CACHE_TTL.REPORTS,
    () => getBindingReport(viewer, input)
  );
