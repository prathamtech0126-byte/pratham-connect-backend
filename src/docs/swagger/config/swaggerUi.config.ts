import type { SwaggerUiOptions } from "swagger-ui-express";

export const swaggerUiOptions: SwaggerUiOptions = {
  explorer: true,
  customSiteTitle: "Pratham Connect API Docs",
  swaggerOptions: {
    url: "/api-docs.json",
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "none",
    filter: true,
    tagsSorter: "alpha",
    operationsSorter: "alpha",
    tryItOutEnabled: true,
  },
};
