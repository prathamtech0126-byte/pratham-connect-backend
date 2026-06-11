import swaggerJSDoc from "swagger-jsdoc";
import type { OpenAPIV3 } from "openapi-types";
import { openApiDefinition } from "./openapi.config";
import { components } from "../schemas";
import { tags } from "../tags/tags";
import { v1Paths } from "../paths/v1";
import { v2Paths } from "../paths/v2";

/**
 * swagger-jsdoc options — scans annotation files for supplemental @openapi JSDoc blocks.
 * Primary path definitions are assembled programmatically from `paths/v1` and `paths/v2`.
 */
export const swaggerJSDocOptions: swaggerJSDoc.OAS3Options = {
  definition: {
    ...openApiDefinition,
    tags,
    components: components as swaggerJSDoc.OAS3Definition["components"],
    paths: {
      ...v1Paths,
      ...v2Paths,
    } as swaggerJSDoc.OAS3Definition["paths"],
  },
  apis: [
    "./src/docs/swagger/annotations/**/*.ts",
    "./dist/docs/swagger/annotations/**/*.js",
  ],
};

export function buildSwaggerSpec(): OpenAPIV3.Document {
  const spec = swaggerJSDoc(swaggerJSDocOptions) as OpenAPIV3.Document;

  // Ensure programmatic paths are always present (jsdoc merge safety net).
  spec.paths = {
    ...v1Paths,
    ...v2Paths,
    ...(spec.paths ?? {}),
  };

  spec.tags = tags;
  spec.components = {
    ...components,
    ...(spec.components ?? {}),
    schemas: {
      ...components.schemas,
      ...(spec.components?.schemas ?? {}),
    },
    responses: {
      ...components.responses,
      ...(spec.components?.responses ?? {}),
    },
    securitySchemes: {
      ...components.securitySchemes,
      ...(spec.components?.securitySchemes ?? {}),
    },
  };

  spec.security = [{ bearerAuth: [] }];

  return spec;
}
