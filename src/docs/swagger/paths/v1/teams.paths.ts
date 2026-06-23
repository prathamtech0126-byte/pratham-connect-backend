import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";

export const teamsPaths = buildPaths([
  {
    method: "post",
    path: "/api/team",
    tag: TAG_NAMES.TEAMS,
    summary: "Create team",
    roles: ["developer", "admin"],
    requestBody: jsonBody("SuccessResponse", "Team payload"),
    requestExample: { name: "North Region", description: "North region sales team" },
  },
  {
    method: "get",
    path: "/api/team",
    tag: TAG_NAMES.TEAMS,
    summary: "List all teams",
    roles: ["admin", "superadmin"],
  },
  {
    method: "get",
    path: "/api/team/{id}",
    tag: TAG_NAMES.TEAMS,
    summary: "Get team by ID",
    roles: ["admin", "superadmin"],
    parameters: [param.path("id", "Team ID", "integer")],
  },
  {
    method: "put",
    path: "/api/team/{id}",
    tag: TAG_NAMES.TEAMS,
    summary: "Update team",
    roles: ["developer", "admin"],
    parameters: [param.path("id", "Team ID", "integer")],
    requestBody: jsonBody("SuccessResponse", "Team fields to update"),
  },
  {
    method: "delete",
    path: "/api/team/{id}",
    tag: TAG_NAMES.TEAMS,
    summary: "Delete team",
    roles: ["admin", "superadmin"],
    parameters: [param.path("id", "Team ID", "integer")],
  },
]);
