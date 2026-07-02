import type { ComponentsObject } from "../types";

export const commonSchemas: ComponentsObject["schemas"] = {
  SuccessResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string", example: "Operation completed successfully" },
      data: {
        description: "Response payload (shape varies by endpoint)",
        nullable: true,
      },
      count: { type: "integer", example: 10, description: "Optional count for list endpoints" },
    },
    additionalProperties: true,
  },

  ErrorResponse: {
    type: "object",
    required: ["message"],
    properties: {
      success: { type: "boolean", example: false },
      message: { type: "string", example: "Request failed" },
      hint: { type: "string", description: "Optional troubleshooting hint" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    additionalProperties: true,
  },

  PaginationMeta: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, example: 1 },
      limit: { type: "integer", minimum: 1, example: 20 },
      total: { type: "integer", minimum: 0, example: 100 },
      totalPages: { type: "integer", minimum: 0, example: 5 },
    },
    required: ["page", "limit", "total", "totalPages"],
  },

  PaginationResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      pagination: { $ref: "#/components/schemas/PaginationMeta" },
    },
    required: ["success", "data", "pagination"],
  },

  AuthenticationResponse: {
    type: "object",
    properties: {
      message: { type: "string", example: "Login successful" },
      fullname: { type: "string", example: "Jane Doe" },
      email: { type: "string", format: "email", example: "jane.doe@example.com" },
      empid: { type: "string", nullable: true, example: "EMP-1024" },
      officePhone: { type: "string", nullable: true },
      personalPhone: { type: "string", nullable: true },
      designation: { type: "string", nullable: true },
      role: { type: "string", example: "counsellor" },
      roleId: { type: "integer", nullable: true, example: 3 },
      teamId: { type: "integer", nullable: true, example: 2 },
      accessToken: {
        type: "string",
        description: "JWT access token (also set as httpOnly cookie when using cookie auth)",
      },
      csrfToken: {
        type: "string",
        description: "CSRF token — send as X-CSRF-Token header on mutating requests in production cookie auth",
      },
    },
    required: ["message", "email", "role", "accessToken"],
  },

  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", example: "jane.doe@example.com" },
      password: { type: "string", format: "password", example: "SecurePass123!" },
    },
  },

  RefreshTokenRequest: {
    type: "object",
    properties: {
      refreshToken: {
        type: "string",
        description: "Optional when refresh token is sent via cookie or Authorization header",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      },
    },
  },

  ChangePasswordRequest: {
    type: "object",
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", format: "password" },
      newPassword: { type: "string", format: "password", minLength: 8 },
    },
  },

  ClientPortalLoginRequest: {
    type: "object",
    required: ["loginId", "password"],
    properties: {
      loginId: {
        type: "string",
        description: "Client login identifier (email or username)",
        example: "client@example.com",
      },
      password: { type: "string", format: "password", example: "TempPass123!" },
    },
  },

  ClientPortalRefreshRequest: {
    type: "object",
    properties: {
      refreshToken: {
        type: "string",
        description: "Optional when refresh token is sent via clientRefreshToken cookie",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      },
    },
  },

  ClientPortalChangePasswordRequest: {
    type: "object",
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", format: "password" },
      newPassword: { type: "string", format: "password", minLength: 8 },
    },
  },

  ClientPortalInvitationRequest: {
    type: "object",
    properties: {
      deliveryEmail: {
        type: "string",
        format: "email",
        description: "Optional explicit email to deliver portal invitation/reset credentials",
      },
      delivery_email: {
        type: "string",
        format: "email",
        description: "Legacy alias for deliveryEmail",
      },
    },
  },

  ClientPortalChecklistAssignmentRequest: {
    type: "object",
    required: ["clientId", "checklistId", "visaType", "country"],
    properties: {
      clientId: { type: "integer", example: 101 },
      checklistId: {
        type: "string",
        format: "uuid",
        example: "b13f6d84-f9db-4b3a-a5db-a6935f2a87c2",
      },
      visaType: { type: "string", example: "student" },
      country: { type: "string", example: "canada" },
    },
  },
};
