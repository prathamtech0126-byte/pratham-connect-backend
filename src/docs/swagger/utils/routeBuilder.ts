import type { OperationObject, PathsObject, RouteDoc } from "../types";

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });
const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const defaultErrorResponses = {
  "400": ref("BadRequest"),
  "401": ref("Unauthorized"),
  "403": ref("Forbidden"),
  "404": ref("NotFound"),
  "500": ref("InternalServerError"),
};

function buildOperation(route: RouteDoc): OperationObject {
  const secured = route.secured !== false;

  const descriptionParts: string[] = [];
  if (route.description) descriptionParts.push(route.description);
  if (route.roles?.length) {
    descriptionParts.push(`**Required roles:** ${route.roles.join(", ")}`);
  }

  const operation: OperationObject = {
    tags: [route.tag],
    summary: route.summary,
    ...(descriptionParts.length ? { description: descriptionParts.join("\n\n") } : {}),
    ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
    ...(route.parameters?.length ? { parameters: route.parameters } : {}),
    ...(route.requestBody ? { requestBody: route.requestBody } : {}),
    responses: {
      ...(route.method === "post"
        ? {
            "201": route.successResponse
              ? ref(route.successResponse)
              : {
                  description: "Created",
                  content: {
                    "application/json": {
                      schema: schemaRef("SuccessResponse"),
                      ...(route.responseExample
                        ? { example: route.responseExample }
                        : {}),
                    },
                  },
                },
          }
        : {}),
      "200": route.successResponse
        ? ref(route.successResponse)
        : {
            description: "Success",
            content: {
              "application/json": {
                schema: schemaRef("SuccessResponse"),
                ...(route.responseExample ? { example: route.responseExample } : {}),
              },
            },
          },
      ...defaultErrorResponses,
    },
  };

  if (route.requestBody && route.requestExample && operation.requestBody) {
    const body = operation.requestBody;
    if ("content" in body) {
      const content = body.content?.["application/json"];
      if (content) {
        content.example = route.requestExample;
      }
    }
  }

  // POST already has 201; avoid duplicate 200 for pure creates when 201 is set
  if (route.method === "post" && !route.successResponse) {
    delete (operation.responses as Record<string, unknown>)["200"];
  }

  if (route.method === "delete") {
    operation.responses = {
      "200": {
        description: "Deleted",
        content: {
          "application/json": {
            schema: schemaRef("SuccessResponse"),
          },
        },
      },
      ...defaultErrorResponses,
    };
  }

  return operation;
}

/** Merge route definitions into an OpenAPI paths object. */
export function buildPaths(routes: RouteDoc[]): PathsObject {
  const paths: PathsObject = {};

  for (const route of routes) {
    const existing = paths[route.path] ?? {};
    paths[route.path] = {
      ...existing,
      [route.method]: buildOperation(route),
    };
  }

  return paths;
}

/** Deep-merge multiple path objects (later keys win on collision). */
export function mergePaths(...pathObjects: PathsObject[]): PathsObject {
  return pathObjects.reduce<PathsObject>((acc, current) => {
    for (const [path, item] of Object.entries(current)) {
      acc[path] = { ...(acc[path] ?? {}), ...item };
    }
    return acc;
  }, {});
}

export const param = {
  path: (name: string, description: string, schema: "string" | "integer" = "string") =>
    ({
      name,
      in: "path",
      required: true,
      schema: { type: schema },
      description,
    }) as const,
  query: (name: string, description: string, required = false, schema: "string" | "integer" = "string") =>
    ({
      name,
      in: "query",
      required,
      schema: { type: schema },
      description,
    }) as const,
};

export const jsonBody = (
  schemaName: string,
  description: string,
  required = true
) => ({
  required,
  description,
  content: {
    "application/json": {
      schema: schemaRef(schemaName),
    },
  },
});
