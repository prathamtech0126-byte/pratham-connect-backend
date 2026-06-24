import type { ComponentsObject } from "../types";
import { commonSchemas } from "./common.schemas";
import { responseSchemas } from "./responses.schemas";
import { roleSchemas } from "./role.schemas";
import { userSchemas } from "./user.schemas";

export const components: ComponentsObject = {
  schemas: {
    ...commonSchemas,
    ...userSchemas,
    ...roleSchemas,
  },
  responses: responseSchemas,
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "JWT access token from login/refresh. Send as `Authorization: Bearer <token>` or use httpOnly cookie `accessToken`.",
    },
    csrfHeader: {
      type: "apiKey",
      in: "header",
      name: "X-CSRF-Token",
      description:
        "Required in production for cookie-based mutating requests. Value returned in login/refresh response as `csrfToken`.",
    },
  },
};
