import type { OpenAPIV3 } from "openapi-types";

export type PathsObject = OpenAPIV3.PathsObject;
export type SchemaObject = OpenAPIV3.SchemaObject;
export type OperationObject = OpenAPIV3.OperationObject;
export type ParameterObject = OpenAPIV3.ParameterObject;
export type RequestBodyObject = OpenAPIV3.RequestBodyObject;
export type ComponentsObject = OpenAPIV3.ComponentsObject;

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDoc {
  method: HttpMethod;
  /** Full path including mount prefix, e.g. /api/users/login */
  path: string;
  summary: string;
  description?: string;
  tag: string;
  /** Defaults to true — set false for public endpoints */
  secured?: boolean;
  /** Documented RBAC hint (informational) */
  roles?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  /** $ref to a component response, e.g. SuccessResponse */
  successResponse?: string;
  /** Example payload for request body */
  requestExample?: Record<string, unknown>;
  /** Example payload for 200/201 response */
  responseExample?: Record<string, unknown>;
}
