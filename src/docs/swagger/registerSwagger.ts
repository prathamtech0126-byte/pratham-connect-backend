import type { Application, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { buildSwaggerSpec } from "./config/swaggerJSDoc.config";
import { swaggerUiOptions } from "./config/swaggerUi.config";

const trim = (value?: string) => value?.trim().toLowerCase();

/**
 * Register Swagger UI and raw OpenAPI JSON endpoints.
 *
 * - UI:  GET /api-docs
 * - JSON: GET /api-docs.json
 *
 * Disable in any environment with SWAGGER_ENABLED=false
 */
export function registerSwagger(app: Application): void {
  const enabled = trim(process.env.SWAGGER_ENABLED) !== "false";
  if (!enabled) {
    return;
  }

  const spec = buildSwaggerSpec();

  app.get("/api-docs.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(spec);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(spec, swaggerUiOptions)
  );
}
