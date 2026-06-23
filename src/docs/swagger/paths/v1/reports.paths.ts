import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

export const reportsPaths = buildPaths([
  {
    method: "get",
    path: "/api/reports",
    tag: TAG_NAMES.REPORTS,
    summary: "Role-based reports",
    roles: ["developer", "admin", "manager"],
    parameters: [
      param.query("month", "Report month"),
      param.query("year", "Report year"),
    ],
  },
  {
    method: "get",
    path: "/api/reports/sale-dashboard",
    tag: TAG_NAMES.REPORTS,
    summary: "Sales report dashboard",
    roles: ["developer", "admin", "manager"],
  },
  {
    method: "get",
    path: "/api/reports/sale-graph-report",
    tag: TAG_NAMES.REPORTS,
    summary: "Sales metric series (3-month graph)",
    roles: ["developer", "admin", "manager"],
    parameters: [
      param.query("metric", "Metric key"),
      param.query("saleTypeId", "Sale type ID filter", false, "integer"),
    ],
  },
  {
    method: "get",
    path: "/api/reports/counsellor/{counsellorId}",
    tag: TAG_NAMES.REPORTS,
    summary: "Individual counsellor report",
    roles: ["developer", "admin", "manager", "counsellor"],
    parameters: [param.path("counsellorId", "Counsellor user ID", "integer")],
  },
  {
    method: "get",
    path: "/api/reports/payments-list",
    tag: TAG_NAMES.REPORTS,
    summary: "Payments list report",
    roles: ["developer"],
  },
]);

export const messagesPaths = buildPaths([
  {
    method: "post",
    path: "/api/messages/broadcast",
    tag: TAG_NAMES.MESSAGES,
    summary: "Create broadcast message",
    roles: ["developer", "admin"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
          example: {
            title: "System maintenance",
            body: "Scheduled maintenance tonight at 11 PM IST.",
            targetRoles: ["counsellor", "telecaller"],
          },
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/messages",
    tag: TAG_NAMES.MESSAGES,
    summary: "List all messages (admin)",
    roles: ["developer", "admin"],
    successResponse: "PaginatedResponse",
  },
  { method: "get", path: "/api/messages/inbox", tag: TAG_NAMES.MESSAGES, summary: "User inbox" },
  { method: "get", path: "/api/messages/unacknowledged", tag: TAG_NAMES.MESSAGES, summary: "Unacknowledged messages" },
  {
    method: "post",
    path: "/api/messages/{messageId}/acknowledge",
    tag: TAG_NAMES.MESSAGES,
    summary: "Acknowledge message",
    parameters: [param.path("messageId", "Message ID", "integer")],
  },
  {
    method: "get",
    path: "/api/messages/{messageId}/acknowledgments",
    tag: TAG_NAMES.MESSAGES,
    summary: "Acknowledgment status",
    roles: ["developer", "admin"],
    parameters: [param.path("messageId", "Message ID", "integer")],
  },
  {
    method: "patch",
    path: "/api/messages/{messageId}/deactivate",
    tag: TAG_NAMES.MESSAGES,
    summary: "Deactivate message",
    roles: ["developer", "admin"],
    parameters: [param.path("messageId", "Message ID", "integer")],
  },
]);

export const googleSheetsPaths = buildPaths([
  { method: "get", path: "/api/google-sheets/test", tag: TAG_NAMES.GOOGLE_SHEETS, summary: "Test Google Sheets connection", roles: ["developer", "admin", "manager"] },
  { method: "get", path: "/api/google-sheets/metadata", tag: TAG_NAMES.GOOGLE_SHEETS, summary: "Get sheet metadata", roles: ["developer", "admin", "manager"] },
  {
    method: "get",
    path: "/api/google-sheets/read",
    tag: TAG_NAMES.GOOGLE_SHEETS,
    summary: "Read sheet data",
    roles: ["developer", "admin", "manager", "counsellor"],
    parameters: [
      param.query("spreadsheetId", "Spreadsheet ID", true),
      param.query("range", "A1 notation range", true),
    ],
  },
  {
    method: "post",
    path: "/api/google-sheets/write",
    tag: TAG_NAMES.GOOGLE_SHEETS,
    summary: "Write sheet data",
    roles: ["developer", "admin", "manager"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  },
  {
    method: "post",
    path: "/api/google-sheets/append",
    tag: TAG_NAMES.GOOGLE_SHEETS,
    summary: "Append sheet data",
    roles: ["developer", "admin", "manager"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  },
  {
    method: "delete",
    path: "/api/google-sheets/clear",
    tag: TAG_NAMES.GOOGLE_SHEETS,
    summary: "Clear sheet range",
    roles: ["developer", "admin"],
    parameters: [
      param.query("spreadsheetId", "Spreadsheet ID", true),
      param.query("range", "A1 notation range", true),
    ],
  },
  {
    method: "post",
    path: "/api/google-sheets/batch-update",
    tag: TAG_NAMES.GOOGLE_SHEETS,
    summary: "Batch update sheet ranges",
    roles: ["developer", "admin", "manager"],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  },
]);

export const allFinancePaths = buildPaths([
  { method: "get", path: "/api/all-finance/pending", tag: TAG_NAMES.ALL_FINANCE, summary: "Pending all-finance approvals", roles: ["admin", "manager", "developer"] },
  {
    method: "post",
    path: "/api/all-finance/{financeId}/approve",
    tag: TAG_NAMES.ALL_FINANCE,
    summary: "Approve all-finance payment",
    roles: ["admin", "manager", "developer"],
    parameters: [param.path("financeId", "Finance payment ID", "integer")],
  },
  {
    method: "post",
    path: "/api/all-finance/{financeId}/reject",
    tag: TAG_NAMES.ALL_FINANCE,
    summary: "Reject all-finance payment",
    roles: ["admin", "manager", "developer"],
    parameters: [param.path("financeId", "Finance payment ID", "integer")],
    requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string" } } } } } },
  },
  { method: "get", path: "/api/all-finance/history", tag: TAG_NAMES.ALL_FINANCE, summary: "Approval/rejection history", roles: ["admin", "manager", "developer"] },
]);
