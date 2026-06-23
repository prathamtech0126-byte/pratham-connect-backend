import type { OpenAPIV3 } from "openapi-types";
import { getSwaggerServers } from "./servers.config";

export const openApiDefinition: Omit<OpenAPIV3.Document, "paths" | "components"> = {
  openapi: "3.0.3",
  info: {
    title: "Pratham Connect API",
    version: "1.0.0",
    description: [
      "Enterprise CRM backend for Pratham Connect.",
      "",
      "## Authentication",
      "Most endpoints require a JWT Bearer token. Obtain one via `POST /api/users/login`.",
      "Cookie-based auth is also supported; in **production**, mutating requests with cookies require `X-CSRF-Token`.",
      "",
      "## API Versioning",
      "- **v1** — Current production API (documented paths under `/api/*` and `/api/v1/*`).",
      "- **v2** — Reserved for future breaking changes (see v2 tag).",
    ].join("\n"),
    contact: {
      name: "Pratham Connect Engineering",
    },
    license: {
      name: "Proprietary",
    },
  },
  servers: getSwaggerServers(),
  externalDocs: {
    description: "OpenAPI JSON specification",
    url: "/api-docs.json",
  },
};
