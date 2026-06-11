import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";

export const maintenancePaths = buildPaths([
  {
    method: "get",
    path: "/api/maintenance",
    tag: TAG_NAMES.MAINTENANCE,
    summary: "Get maintenance status",
    secured: false,
    responseExample: { enabled: false, message: null, scheduledEnd: null },
  },
  {
    method: "post",
    path: "/api/maintenance",
    tag: TAG_NAMES.MAINTENANCE,
    summary: "Toggle maintenance mode",
    roles: ["developer"],
    requestBody: jsonBody("SuccessResponse", "Maintenance toggle payload"),
    requestExample: { enabled: true, message: "Scheduled upgrade in progress" },
  },
]);

const incentiveWriteRoles = ["admin", "superadmin", "manager"];
const incentiveReportRoles = ["admin", "superadmin", "manager", "developer"];

export const incentivesPaths = buildPaths([
  { method: "get", path: "/api/incentives/rules", tag: TAG_NAMES.INCENTIVES, summary: "Get all incentive rules" },
  { method: "get", path: "/api/incentives/rules/spouse", tag: TAG_NAMES.INCENTIVES, summary: "Get spouse incentive rules" },
  { method: "get", path: "/api/incentives/rules/visitor", tag: TAG_NAMES.INCENTIVES, summary: "Get visitor incentive rules" },
  { method: "get", path: "/api/incentives/rules/canada-student", tag: TAG_NAMES.INCENTIVES, summary: "Get Canada student incentive rules" },
  { method: "get", path: "/api/incentives/rules/student", tag: TAG_NAMES.INCENTIVES, summary: "Get student incentive rules" },
  { method: "get", path: "/api/incentives/rules/all-finance", tag: TAG_NAMES.INCENTIVES, summary: "Get all-finance incentive rules" },
  { method: "put", path: "/api/incentives/rules/spouse", tag: TAG_NAMES.INCENTIVES, summary: "Upsert spouse rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "Spouse rules") },
  { method: "put", path: "/api/incentives/rules/visitor", tag: TAG_NAMES.INCENTIVES, summary: "Upsert visitor rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "Visitor rules") },
  { method: "put", path: "/api/incentives/rules/canada-student", tag: TAG_NAMES.INCENTIVES, summary: "Upsert Canada student rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "Canada student rules") },
  { method: "put", path: "/api/incentives/rules/student", tag: TAG_NAMES.INCENTIVES, summary: "Upsert student rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "Student rules") },
  { method: "put", path: "/api/incentives/rules/all-finance", tag: TAG_NAMES.INCENTIVES, summary: "Upsert all-finance rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "All-finance rules") },
  { method: "put", path: "/api/incentives/rules", tag: TAG_NAMES.INCENTIVES, summary: "Bulk upsert incentive rules", roles: incentiveWriteRoles, requestBody: jsonBody("SuccessResponse", "Rules bundle") },
  { method: "get", path: "/api/incentives/report", tag: TAG_NAMES.INCENTIVES, summary: "Incentive report", roles: incentiveReportRoles },
  { method: "get", path: "/api/incentives/report/all", tag: TAG_NAMES.INCENTIVES, summary: "Incentive report (all)", roles: incentiveReportRoles },
  {
    method: "get",
    path: "/api/incentives/breakdown/{incentiveRecordId}",
    tag: TAG_NAMES.INCENTIVES,
    summary: "Incentive breakdown",
    roles: incentiveReportRoles,
    parameters: [param.path("incentiveRecordId", "Incentive record ID", "integer")],
  },
  { method: "post", path: "/api/incentives/breakdown/action", tag: TAG_NAMES.INCENTIVES, summary: "Incentive breakdown action", roles: incentiveReportRoles, requestBody: jsonBody("SuccessResponse", "Breakdown action") },
  { method: "post", path: "/api/incentives/action", tag: TAG_NAMES.INCENTIVES, summary: "Incentive action", roles: incentiveReportRoles, requestBody: jsonBody("SuccessResponse", "Incentive action") },
  { method: "put", path: "/api/incentives/action", tag: TAG_NAMES.INCENTIVES, summary: "Update incentive action", roles: incentiveReportRoles, requestBody: jsonBody("SuccessResponse", "Incentive action update") },
  {
    method: "post",
    path: "/api/incentives/bulk-approve",
    tag: TAG_NAMES.INCENTIVES,
    summary: "Bulk approve incentives",
    roles: incentiveReportRoles,
    requestBody: jsonBody("SuccessResponse", "Record IDs to approve"),
    requestExample: { incentiveRecordIds: [101, 102, 103] },
  },
]);

export const otherProductsPaths = buildPaths([
  { method: "get", path: "/api/other-products", tag: TAG_NAMES.OTHER_PRODUCTS, summary: "List other products", roles: ["admin", "superadmin", "developer"] },
  { method: "get", path: "/api/other-products/grouped", tag: TAG_NAMES.OTHER_PRODUCTS, summary: "Products grouped by category", roles: ["admin", "superadmin", "developer"] },
  { method: "get", path: "/api/other-products/categories", tag: TAG_NAMES.OTHER_PRODUCTS, summary: "List product categories", roles: ["admin", "superadmin", "developer"] },
  {
    method: "get",
    path: "/api/other-products/{id}",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Get product by ID",
    roles: ["admin", "superadmin", "developer"],
    parameters: [param.path("id", "Product ID", "integer")],
  },
  {
    method: "post",
    path: "/api/other-products",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Create product",
    roles: ["admin", "superadmin", "developer"],
    requestBody: jsonBody("SuccessResponse", "Product payload"),
    requestExample: { name: "IELTS Coaching", category: "Education", status: "active" },
  },
  {
    method: "put",
    path: "/api/other-products/{id}",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Update product",
    roles: ["admin", "superadmin", "developer"],
    parameters: [param.path("id", "Product ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/other-products/{id}",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Soft delete product",
    roles: ["admin", "superadmin", "developer"],
    parameters: [param.path("id", "Product ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/other-products/{id}/permanent",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Hard delete product",
    roles: ["admin", "superadmin", "developer"],
    parameters: [param.path("id", "Product ID", "integer")],
  },
  {
    method: "post",
    path: "/api/other-products/bulk/status",
    tag: TAG_NAMES.OTHER_PRODUCTS,
    summary: "Bulk update product status",
    roles: ["admin", "superadmin", "developer"],
    requestBody: jsonBody("SuccessResponse", "Bulk status update"),
    requestExample: { ids: [1, 2, 3], status: "inactive" },
  },
]);

export const ruleConfigurationsPaths = buildPaths([
  { method: "get", path: "/api/rule-configurations", tag: TAG_NAMES.RULE_CONFIGURATIONS, summary: "List rule configurations", roles: ["admin", "superadmin", "manager", "developer"] },
  {
    method: "get",
    path: "/api/rule-configurations/{id}",
    tag: TAG_NAMES.RULE_CONFIGURATIONS,
    summary: "Get rule configuration by ID",
    roles: ["admin", "superadmin", "manager", "developer"],
    parameters: [param.path("id", "Configuration ID", "integer")],
  },
  {
    method: "post",
    path: "/api/rule-configurations",
    tag: TAG_NAMES.RULE_CONFIGURATIONS,
    summary: "Create rule configuration",
    roles: ["admin", "superadmin", "manager", "developer"],
    requestBody: jsonBody("SuccessResponse", "Rule configuration payload"),
  },
  {
    method: "put",
    path: "/api/rule-configurations/{id}",
    tag: TAG_NAMES.RULE_CONFIGURATIONS,
    summary: "Update rule configuration",
    roles: ["admin", "superadmin", "manager", "developer"],
    parameters: [param.path("id", "Configuration ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/rule-configurations/{id}",
    tag: TAG_NAMES.RULE_CONFIGURATIONS,
    summary: "Delete rule configuration",
    roles: ["admin", "superadmin", "manager", "developer"],
    parameters: [param.path("id", "Configuration ID", "integer")],
  },
]);
