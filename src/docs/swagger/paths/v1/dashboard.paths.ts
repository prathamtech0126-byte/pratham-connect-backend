import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

export const dashboardPaths = buildPaths([
  {
    method: "get",
    path: "/api/dashboard/stats",
    tag: TAG_NAMES.DASHBOARD,
    summary: "Dashboard stats",
    roles: ["developer", "admin", "manager", "counsellor", "telecaller"],
    parameters: [
      param.query("month", "Month filter (YYYY-MM)"),
      param.query("year", "Year filter"),
    ],
  },
]);

export const activityLogsPaths = buildPaths([
  {
    method: "get",
    path: "/api/activity-logs",
    tag: TAG_NAMES.ACTIVITY_LOGS,
    summary: "Get activity logs",
    roles: ["admin", "manager", "counsellor", "developer", "telecaller", "marketing_head"],
    parameters: [
      param.query("page", "Page number", false, "integer"),
      param.query("limit", "Page size", false, "integer"),
      param.query("userId", "Filter by user ID", false, "integer"),
    ],
    successResponse: "PaginatedResponse",
  },
]);

export const leaderboardPaths = buildPaths([
  { method: "get", path: "/api/leaderboard", tag: TAG_NAMES.LEADERBOARD, summary: "Counsellor leaderboard", roles: ["developer", "admin", "manager", "counsellor"] },
  { method: "get", path: "/api/leaderboard/summary", tag: TAG_NAMES.LEADERBOARD, summary: "Leaderboard summary", roles: ["developer", "admin", "manager", "counsellor"] },
  { method: "get", path: "/api/leaderboard/counsellors", tag: TAG_NAMES.LEADERBOARD, summary: "Counsellors for target dropdown", roles: ["developer", "admin", "manager"] },
  {
    method: "post",
    path: "/api/leaderboard/target",
    tag: TAG_NAMES.LEADERBOARD,
    summary: "Set counsellor target",
    roles: ["developer", "admin", "manager"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
    requestExample: { counsellorId: 42, targetAmount: 500000, monthYear: "2026-06" },
  },
  {
    method: "put",
    path: "/api/leaderboard/target/{id}",
    tag: TAG_NAMES.LEADERBOARD,
    summary: "Update counsellor target",
    roles: ["developer", "admin", "manager"],
    parameters: [param.path("id", "Target ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/leaderboard/target/{id}",
    tag: TAG_NAMES.LEADERBOARD,
    summary: "Delete counsellor target",
    roles: ["developer", "admin", "manager"],
    parameters: [param.path("id", "Target ID", "integer")],
  },
]);

export const managerTargetsPaths = buildPaths([
  { method: "get", path: "/api/manager-targets", tag: TAG_NAMES.MANAGER_TARGETS, summary: "List manager targets", roles: ["developer", "admin", "manager"] },
  {
    method: "get",
    path: "/api/manager-targets/{id}",
    tag: TAG_NAMES.MANAGER_TARGETS,
    summary: "Get manager target by ID",
    roles: ["developer", "admin", "manager"],
    parameters: [param.path("id", "Target ID", "integer")],
  },
  {
    method: "post",
    path: "/api/manager-targets",
    tag: TAG_NAMES.MANAGER_TARGETS,
    summary: "Create manager target",
    roles: ["developer", "admin"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  },
  {
    method: "put",
    path: "/api/manager-targets/{id}",
    tag: TAG_NAMES.MANAGER_TARGETS,
    summary: "Update manager target",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Target ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/manager-targets/{id}",
    tag: TAG_NAMES.MANAGER_TARGETS,
    summary: "Delete manager target",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Target ID", "integer")],
  },
]);

export const telecallerTargetsPaths = buildPaths([
  {
    method: "post",
    path: "/api/telecaller-targets",
    tag: TAG_NAMES.TELECALLER_TARGETS,
    summary: "Upsert telecaller target",
    roles: ["developer", "admin", "manager", "telecaller"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
    requestExample: { telecallerId: 15, monthYear: "2026-06", target: 120 },
  },
  {
    method: "get",
    path: "/api/telecaller-targets/leaderboard/{monthYear}",
    tag: TAG_NAMES.TELECALLER_TARGETS,
    summary: "Telecaller target leaderboard for month",
    parameters: [param.path("monthYear", "Month year (YYYY-MM)")],
  },
  {
    method: "get",
    path: "/api/telecaller-targets/{telecallerId}/history",
    tag: TAG_NAMES.TELECALLER_TARGETS,
    summary: "Telecaller target history",
    parameters: [param.path("telecallerId", "Telecaller user ID", "integer")],
  },
  {
    method: "get",
    path: "/api/telecaller-targets/{telecallerId}/{monthYear}",
    tag: TAG_NAMES.TELECALLER_TARGETS,
    summary: "Get telecaller target for month",
    secured: false,
    parameters: [
      param.path("telecallerId", "Telecaller user ID", "integer"),
      param.path("monthYear", "Month year (YYYY-MM)"),
    ],
  },
]);
