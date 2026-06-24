import { TAG_NAMES } from "../../tags/tags";
import { buildPaths } from "../../utils/routeBuilder";

export const systemPaths = buildPaths([
  {
    method: "get",
    path: "/health",
    tag: TAG_NAMES.SYSTEM,
    summary: "Health check",
    secured: false,
    description: "Returns service health status.",
  },
  {
    method: "get",
    path: "/",
    tag: TAG_NAMES.SYSTEM,
    summary: "Root healthcheck",
    secured: false,
    description: "Returns plain text OK (used by deployment platforms).",
  },
]);
