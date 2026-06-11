import type { OpenAPIV3 } from "openapi-types";

const trim = (value?: string) => value?.trim() || undefined;

/**
 * Environment-based server URLs for Swagger UI server selector.
 *
 * Configure via:
 * - SWAGGER_DEV_URL (default: http://localhost:{PORT})
 * - SWAGGER_STAGING_URL
 * - SWAGGER_PRODUCTION_URL
 * - API_BASE_URL (fallback for staging/production)
 */
export function getSwaggerServers(): OpenAPIV3.ServerObject[] {
  const port = process.env.PORT || "3000";
  const nodeEnv = process.env.NODE_ENV || "development";

  const devUrl =
    trim(process.env.SWAGGER_DEV_URL) ?? `http://localhost:${port}`;
  const stagingUrl =
    trim(process.env.SWAGGER_STAGING_URL) ?? trim(process.env.API_BASE_URL);
  const productionUrl =
    trim(process.env.SWAGGER_PRODUCTION_URL) ?? trim(process.env.API_BASE_URL);

  const servers: OpenAPIV3.ServerObject[] = [
    {
      url: devUrl,
      description: "Local development",
      variables: {},
    },
  ];

  if (stagingUrl) {
    servers.push({
      url: stagingUrl,
      description: "Staging",
    });
  }

  if (productionUrl && productionUrl !== stagingUrl) {
    servers.push({
      url: productionUrl,
      description: "Production",
    });
  }

  // Promote the active environment server to the top of the list.
  if (nodeEnv === "production" && productionUrl) {
    return [
      { url: productionUrl, description: "Production (active)" },
      ...servers.filter((s) => s.url !== productionUrl),
    ];
  }

  if (nodeEnv === "staging" && stagingUrl) {
    return [
      { url: stagingUrl, description: "Staging (active)" },
      ...servers.filter((s) => s.url !== stagingUrl),
    ];
  }

  return servers;
}
