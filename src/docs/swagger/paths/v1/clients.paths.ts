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
    path: "/api/clients/{clientId}/portal-status",
    tag: TAG_NAMES.CLIENTS,
    summary: "Get client portal account status",
    roles: clientRoles,
    parameters: [param.path("clientId", "Client ID", "integer")],
    responseExample: {
      exists: true,
      invitedAt: "2026-07-01T10:15:00.000Z",
      email: "client@example.com",
      username: "john.client",
      mustChangePassword: true,
    },
  },
  {
    method: "post",
    path: "/api/clients/{clientId}/portal-invitation",
    tag: TAG_NAMES.CLIENTS,
    summary: "Send or resend client portal invitation",
    roles: clientRoles,
    parameters: [param.path("clientId", "Client ID", "integer")],
    requestBody: jsonBody("ClientPortalInvitationRequest", "Optional override delivery email", false),
    requestExample: {
      deliveryEmail: "client@example.com",
    },
    responseExample: {
      message: "Portal invitation sent",
      resent: false,
      emailDelivered: true,
      emailFailureReason: null,
      accountId: "acc_123",
      clientId: 101,
      email: "client@example.com",
      username: "john.client",
    },
  },
  {
    method: "post",
    path: "/api/clients/{clientId}/portal-reset-password",
    tag: TAG_NAMES.CLIENTS,
    summary: "Reset client portal password and email credentials",
    roles: clientRoles,
    parameters: [param.path("clientId", "Client ID", "integer")],
    responseExample: {
      message: "New portal password sent",
      emailDelivered: true,
      emailFailureReason: null,
      clientId: 101,
      accountId: "acc_123",
    },
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
    method: "patch",
    path: "/api/clients/{clientId}/basic-details",
    tag: TAG_NAMES.CLIENTS,
    summary: "Update client basic details (name, enrollment, passport, lead type)",
    roles: ["admin", "manager", "developer", "cx", "binding", "application"],
    parameters: [param.path("clientId", "Client ID", "integer")],
    requestBody: jsonBody("SuccessResponse", "Basic details payload"),
    requestExample: {
      fullName: "Jane Doe",
      enrollmentDate: "15-01-2025",
      passportDetails: "P1234567",
      leadTypeId: 1,
    },
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

const modulePaymentEndpointDefs = [
  {
    method: "get" as const,
    summary: "Full client payment profile (modules DB)",
    subpath: "/client/{clientId}",
    parameters: [param.path("clientId", "Modules client UUID or legacy CRM client id")],
  },
  {
    method: "get" as const,
    summary: "Lightweight client payment summary",
    subpath: "/client/{clientId}/summary",
    parameters: [param.path("clientId", "Modules client UUID or legacy CRM client id")],
  },
  {
    method: "get" as const,
    summary: "Client product entity tables",
    subpath: "/client/{clientId}/entities",
    parameters: [param.path("clientId", "Modules client UUID or legacy CRM client id")],
  },
  {
    method: "get" as const,
    summary: "Current month revenue",
    subpath: "/revenue/current-month",
    parameters: [] as ReturnType<typeof param.path>[],
  },
  {
    method: "get" as const,
    summary: "Last month revenue",
    subpath: "/revenue/last-month",
    parameters: [] as ReturnType<typeof param.path>[],
  },
];

/** Legacy mount: /api/module-payments */
export const modulePaymentsPaths = buildPaths(
  modulePaymentEndpointDefs.map((endpoint) => ({
    method: endpoint.method,
    path: `/api/module-payments${endpoint.subpath}`,
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: endpoint.summary,
    parameters: endpoint.parameters,
  }))
);

/** Modules aggregator mount: /api/modules/payments */
export const modulePaymentsModulesPaths = buildPaths(
  modulePaymentEndpointDefs.map((endpoint) => ({
    method: endpoint.method,
    path: `/api/modules/payments${endpoint.subpath}`,
    tag: TAG_NAMES.MODULE_PAYMENTS,
    summary: endpoint.summary,
    parameters: endpoint.parameters,
  }))
);
