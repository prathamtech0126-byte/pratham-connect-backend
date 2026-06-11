import { TAG_NAMES } from "../../tags/tags";
import { buildPaths } from "../../utils/routeBuilder";

/**
 * v2 API placeholder — add breaking-change endpoints here under `/api/v2/*`
 * when the next major API version is introduced.
 */
export const v2Paths = buildPaths([
  {
    method: "get",
    path: "/api/v2/health",
    tag: TAG_NAMES.V2_PLACEHOLDER,
    summary: "v2 health check (placeholder)",
    secured: false,
    description:
      "Reserved endpoint demonstrating v2 namespace. Not implemented in routes yet.",
    responseExample: {
      version: "v2",
      status: "not_implemented",
      message: "v2 API is not yet available. Use v1 endpoints.",
    },
  },
]);
