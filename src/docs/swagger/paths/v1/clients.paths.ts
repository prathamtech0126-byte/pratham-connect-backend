import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";

const clientRoles = ["admin", "counsellor", "manager", "developer"];

export const clientsPaths = buildPaths([
  {
    method: "post",
    path: "/api/clients",
    tag: TAG_NAMES.CLIENTS,
    summary: "Create client",
    roles: clientRoles,
    requestBody: jsonBody("SuccessResponse", "Client payload"),
  },
  {
    method: "get",
    path: "/api/clients/counsellor-clients",
    tag: TAG_NAMES.CLIENTS,
    summary: "List counsellor clients (non-archived)",
    roles: clientRoles,
    successResponse: "PaginatedResponse",
  },
  {
    method: "get",
    path: "/api/clients/counsellor-clients/filtered",
    tag: TAG_NAMES.CLIENTS,
    summary: "Filtered clients by date/user (GET)",
    roles: clientRoles,
    parameters: [
      param.query("startDate", "Filter start date (ISO)"),
      param.query("endDate", "Filter end date (ISO)"),
      param.query("userId", "Filter by user ID"),
    ],
  },
  {
    method: "post",
    path: "/api/clients/counsellor-clients/filtered",
    tag: TAG_NAMES.CLIENTS,
    summary: "Filtered clients by date/user (POST)",
    roles: clientRoles,
    requestBody: jsonBody("SuccessResponse", "Filter criteria"),
  },
  {
    method: "get",
    path: "/api/clients/archived-clients",
    tag: TAG_NAMES.CLIENTS,
    summary: "List archived clients (GET)",
    roles: clientRoles,
  },
  {
    method: "post",
    path: "/api/clients/archived-clients",
    tag: TAG_NAMES.CLIENTS,
    summary: "List archived clients (POST)",
    roles: clientRoles,
  },
  {
    method: "put",
    path: "/api/clients/{clientId}/archive",
    tag: TAG_NAMES.CLIENTS,
    summary: "Archive or unarchive client",
    roles: clientRoles,
    parameters: [param.path("clientId", "Client ID", "integer")],
    requestBody: jsonBody("SuccessResponse", "Archive action payload"),
  },
  {
    method: "get",
    path: "/api/clients/{clientId}/complete",
    tag: TAG_NAMES.CLIENTS,
    summary: "Client complete details with payments",
    roles: clientRoles,
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "get",
    path: "/api/clients/{counsellorId}",
    tag: TAG_NAMES.CLIENTS,
    summary: "Clients by counsellor ID",
    roles: clientRoles,
    parameters: [param.path("counsellorId", "Counsellor user ID", "integer")],
  },
  {
    method: "get",
    path: "/api/clients/admin/all-clients",
    tag: TAG_NAMES.CLIENTS,
    summary: "All clients (admin)",
    roles: ["admin", "developer"],
    parameters: [param.query("search", "Search term")],
  },
  {
    method: "put",
    path: "/api/clients/admin/transfer-client",
    tag: TAG_NAMES.CLIENTS,
    summary: "Transfer client to another counsellor",
    roles: ["admin", "developer"],
    requestBody: jsonBody("SuccessResponse", "Transfer payload"),
    requestExample: { clientId: 101, newCounsellorId: 42 },
  },
]);

export const clientPaymentsPaths = buildPaths([
  {
    method: "post",
    path: "/api/client-payments",
    tag: TAG_NAMES.CLIENT_PAYMENTS,
    summary: "Create client payment",
    roles: ["developer", "admin", "counsellor", "manager"],
    requestBody: jsonBody("SuccessResponse", "Payment payload"),
  },
  {
    method: "get",
    path: "/api/client-payments/client/{clientId}",
    tag: TAG_NAMES.CLIENT_PAYMENTS,
    summary: "Get payments by client",
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/client-payments/{paymentId}",
    tag: TAG_NAMES.CLIENT_PAYMENTS,
    summary: "Delete client payment",
    roles: ["developer", "admin", "manager"],
    parameters: [param.path("paymentId", "Payment ID", "integer")],
  },
]);

export const clientProductPaymentsPaths = buildPaths([
  {
    method: "post",
    path: "/api/client-product-payments",
    tag: TAG_NAMES.CLIENT_PRODUCT_PAYMENTS,
    summary: "Create client product payment",
    requestBody: jsonBody("SuccessResponse", "Product payment payload"),
  },
  {
    method: "get",
    path: "/api/client-product-payments/client/{clientId}",
    tag: TAG_NAMES.CLIENT_PRODUCT_PAYMENTS,
    summary: "Get product payments by client",
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/client-product-payments/{productPaymentId}",
    tag: TAG_NAMES.CLIENT_PRODUCT_PAYMENTS,
    summary: "Delete product payment",
    parameters: [param.path("productPaymentId", "Product payment ID", "integer")],
  },
]);

export const modulePaymentsPaths = buildPaths([
  {
    method: "get",
    path: "/api/module-payments/client/{clientId}",
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: "Full client payment profile (modules DB)",
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "get",
    path: "/api/module-payments/client/{clientId}/summary",
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: "Lightweight client payment summary",
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "get",
    path: "/api/module-payments/client/{clientId}/entities",
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: "Client product entity tables",
    parameters: [param.path("clientId", "Client ID", "integer")],
  },
  {
    method: "get",
    path: "/api/module-payments/revenue/current-month",
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: "Current month revenue",
  },
  {
    method: "get",
    path: "/api/module-payments/revenue/last-month",
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: "Last month revenue",
  },
]);
