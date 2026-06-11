import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";

export const saleTypesPaths = buildPaths([
  {
    method: "post",
    path: "/api/sale-types",
    tag: TAG_NAMES.SALE_TYPES,
    summary: "Create sale type",
    roles: ["developer", "admin"],
    requestBody: jsonBody("SuccessResponse", "Sale type payload"),
    requestExample: { name: "Canada Student", categoryId: 1 },
  },
  {
    method: "get",
    path: "/api/sale-types",
    tag: TAG_NAMES.SALE_TYPES,
    summary: "List sale types",
  },
  {
    method: "put",
    path: "/api/sale-types/{id}",
    tag: TAG_NAMES.SALE_TYPES,
    summary: "Update sale type",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Sale type ID", "integer")],
    requestBody: jsonBody("SuccessResponse", "Sale type fields to update"),
  },
  {
    method: "delete",
    path: "/api/sale-types/{id}",
    tag: TAG_NAMES.SALE_TYPES,
    summary: "Delete sale type",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Sale type ID", "integer")],
  },
]);

export const saleTypeCategoriesPaths = buildPaths([
  {
    method: "get",
    path: "/api/sale-type-categories",
    tag: TAG_NAMES.SALE_TYPE_CATEGORIES,
    summary: "List sale type categories",
  },
  {
    method: "get",
    path: "/api/sale-type-categories/{id}",
    tag: TAG_NAMES.SALE_TYPE_CATEGORIES,
    summary: "Get sale type category by ID",
    parameters: [param.path("id", "Category ID", "integer")],
  },
  {
    method: "post",
    path: "/api/sale-type-categories",
    tag: TAG_NAMES.SALE_TYPE_CATEGORIES,
    summary: "Create sale type category",
    roles: ["developer", "admin"],
    requestBody: jsonBody("SuccessResponse", "Category payload"),
  },
  {
    method: "put",
    path: "/api/sale-type-categories/{id}",
    tag: TAG_NAMES.SALE_TYPE_CATEGORIES,
    summary: "Update sale type category",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Category ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/sale-type-categories/{id}",
    tag: TAG_NAMES.SALE_TYPE_CATEGORIES,
    summary: "Delete sale type category",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Category ID", "integer")],
  },
]);

export const leadTypesPaths = buildPaths([
  {
    method: "post",
    path: "/api/lead-types",
    tag: TAG_NAMES.LEAD_TYPES,
    summary: "Create lead type",
    roles: ["developer", "admin"],
    requestBody: jsonBody("SuccessResponse", "Lead type payload"),
  },
  {
    method: "get",
    path: "/api/lead-types",
    tag: TAG_NAMES.LEAD_TYPES,
    summary: "List lead types",
  },
  {
    method: "put",
    path: "/api/lead-types/{id}",
    tag: TAG_NAMES.LEAD_TYPES,
    summary: "Update lead type",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Lead type ID", "integer")],
  },
  {
    method: "delete",
    path: "/api/lead-types/{id}",
    tag: TAG_NAMES.LEAD_TYPES,
    summary: "Archive lead type",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Lead type ID", "integer")],
  },
  {
    method: "post",
    path: "/api/lead-types/{id}/unarchive",
    tag: TAG_NAMES.LEAD_TYPES,
    summary: "Unarchive lead type",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Lead type ID", "integer")],
  },
]);
