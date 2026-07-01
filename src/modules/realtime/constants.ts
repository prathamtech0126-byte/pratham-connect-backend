import type { Role } from "../../types/role";
import { BINDING_REPORT_ROLES } from "../reports/constants/bindingReport.constants";
import { BACKEND_DASHBOARD_ROLES } from "../reports/constants/backendDashboard.constants";
import { BACKEND_REPORT_ROLES } from "../reports/constants/backendReport.constants";
import { CX_REPORT_ROLES } from "../reports/constants/cxReport.constants";
import { OPS_DASHBOARD_ROLES } from "../reports/constants/opsDashboard.constants";
import { VISA_CASE_LIST_ROLES } from "../visaCase/constants/visaCase.constants";

/** Server → client Socket.io event names. */
export const MODULES_REALTIME_EVENTS = {
  REPORTS_REFRESH: "modules:reports:refresh",
  VISA_CASE_REFRESH: "modules:visa-case:refresh",
  VISA_CASE_UPDATED: "modules:visa-case:updated",
  VISA_CASE_ASSIGNED: "modules:visa-case:assigned",
  FRONTDESK_REFRESH: "modules:frontdesk:refresh",
  FRONTDESK_UPDATED: "modules:frontdesk:updated",
} as const;

/** Client → server subscription events. */
export const MODULES_SOCKET_SUBSCRIBE = {
  JOIN_REPORTS: "join:modules:reports",
  LEAVE_REPORTS: "leave:modules:reports",
  JOIN_VISA_CASE: "join:modules:visa-case",
  LEAVE_VISA_CASE: "leave:modules:visa-case",
  JOIN_VISA_CASE_DETAIL: "join:modules:visa-case:detail",
  LEAVE_VISA_CASE_DETAIL: "leave:modules:visa-case:detail",
  JOIN_FRONTDESK: "join:modules:frontdesk",
  LEAVE_FRONTDESK: "leave:modules:frontdesk",
  JOIN_FRONTDESK_DETAIL: "join:modules:frontdesk:detail",
  LEAVE_FRONTDESK_DETAIL: "leave:modules:frontdesk:detail",
} as const;

/** Server → client join confirmations. */
export const MODULES_SOCKET_CONFIRM = {
  JOINED_REPORTS: "joined:modules:reports",
  JOINED_VISA_CASE: "joined:modules:visa-case",
  JOINED_VISA_CASE_DETAIL: "joined:modules:visa-case:detail",
  JOINED_FRONTDESK: "joined:modules:frontdesk",
  JOINED_FRONTDESK_DETAIL: "joined:modules:frontdesk:detail",
} as const;

const uniqueRoles = (roles: readonly Role[]): Role[] =>
  Array.from(new Set(roles));

/** Roles that should receive reports/dashboard refresh signals. */
export const REPORTS_REALTIME_ROLES = uniqueRoles([
  ...BACKEND_REPORT_ROLES,
  ...BACKEND_DASHBOARD_ROLES,
  ...OPS_DASHBOARD_ROLES,
  ...CX_REPORT_ROLES,
  ...BINDING_REPORT_ROLES,
  "counsellor",
  "developer",
]);

/** Roles that should receive visa case list/dashboard refresh signals. */
export const VISA_CASE_REALTIME_ROLES = uniqueRoles([
  ...VISA_CASE_LIST_ROLES,
  "developer",
]);

/** Roles that should receive front desk list/dashboard refresh signals. */
export const FRONTDESK_REALTIME_ROLES: Role[] = ["front_desk", "developer"];

export type ModulesRefreshPayload = {
  reason: string;
  clientId?: string;
  visaCaseId?: string;
  leadId?: number;
  timestamp: string;
};

export type FrontDeskUpdatedPayload = {
  leadId: number;
  reason: string;
  timestamp: string;
  /** Optional row snapshot for detail views (omit on list-only refreshes). */
  snapshot?: Record<string, unknown>;
};

export type VisaCaseUpdatedPayload = {
  visaCaseId: string;
  clientId?: string;
  assignedUserId?: number | null;
  assignedTeam?: string | null;
  currentStage?: string | null;
  currentSubStatus?: string | null;
  reason: string;
  timestamp: string;
  /** Optional row snapshot for detail views (omit on list-only refreshes). */
  snapshot?: Record<string, unknown>;
};

export type VisaCaseAssignedPayload = {
  visaCaseId: string;
  clientId?: string;
  assignedUserId: number;
  assignedTeam: string;
  previousUserId?: number | null;
  previousTeam?: string | null;
  assignmentType?: string;
  reason: string;
  timestamp: string;
};
