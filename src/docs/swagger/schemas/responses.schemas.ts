import type { ComponentsObject } from "../types";

export const responseSchemas: ComponentsObject["responses"] = {
  SuccessResponse: {
    description: "Successful operation",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SuccessResponse" },
        example: {
          success: true,
          message: "Operation completed successfully",
          data: {},
        },
      },
    },
  },
  PaginatedResponse: {
    description: "Paginated list response",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/PaginationResponse" },
        example: {
          success: true,
          data: [{ id: 1, name: "Example" }],
          pagination: {
            page: 1,
            limit: 20,
            total: 100,
            totalPages: 5,
          },
        },
      },
    },
  },
  AuthenticationResponse: {
    description: "Authentication successful",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/AuthenticationResponse" },
        example: {
          message: "Login successful",
          fullname: "Jane Doe",
          email: "jane.doe@example.com",
          empid: "EMP-1024",
          officePhone: "9876543210",
          personalPhone: "9876543211",
          designation: "Counsellor",
          role: "counsellor",
          roleId: 3,
          teamId: 2,
          accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          csrfToken: "csrf-token-value",
        },
      },
    },
  },
  ErrorResponse: {
    description: "Error response",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: {
          message: "Request failed",
          success: false,
        },
      },
    },
  },
  BadRequest: {
    description: "Bad request — validation or malformed input",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: { message: "Invalid input" },
      },
    },
  },
  Unauthorized: {
    description: "Authentication required or token invalid/expired",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: { message: "Authentication required" },
      },
    },
  },
  Forbidden: {
    description: "Authenticated but insufficient permissions",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: { message: "Forbidden: insufficient role" },
      },
    },
  },
  NotFound: {
    description: "Resource not found",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: { message: "Route not found" },
      },
    },
  },
  InternalServerError: {
    description: "Unexpected server error",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: { message: "Internal server error" },
      },
    },
  },
};
