import type { ComponentsObject } from "../types";

export const roleSchemas: ComponentsObject["schemas"] = {
  Role: {
    type: "object",
    description: "RBAC role entity",
    properties: {
      id: { type: "integer", format: "int64", example: 3 },
      name: {
        type: "string",
        example: "counsellor",
        description: "Unique role slug used in JWT and users.role",
      },
      description: { type: "string", nullable: true, example: "Counsellor role" },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "name"],
  },

  Permission: {
    type: "object",
    properties: {
      id: { type: "integer", example: 12 },
      name: { type: "string", example: "users.read" },
      description: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "name"],
  },

  CreateRoleRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", example: "marketing_head" },
      description: { type: "string", example: "Marketing head role" },
    },
  },

  UpdateRoleRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
    },
  },

  RolePermissionsUpdateRequest: {
    type: "object",
    required: ["permissionIds"],
    properties: {
      permissionIds: {
        type: "array",
        items: { type: "integer" },
        example: [1, 2, 5],
      },
    },
  },

  SetUserPrimaryRoleRequest: {
    type: "object",
    required: ["roleId"],
    properties: {
      roleId: { type: "integer", example: 3 },
    },
  },
};
