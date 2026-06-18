import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

const countryRoles = [
  "counsellor",
  "cx",
  "binding",
  "application",
  "admin",
  "manager",
  "developer",
];

export const moduleCountriesPaths = buildPaths([
  {
    method: "get",
    path: "/api/modules/countries",
    tag: TAG_NAMES.MODULE_COUNTRIES,
    summary: "List countries (modules DB)",
    description:
      "Active countries from the modules database. Use for visa case destination filters and dropdowns.",
    roles: countryRoles,
    parameters: [
      param.query("isActive", "Filter by active status: true | false (default: true)"),
    ],
    responseExample: {
      success: true,
      count: 10,
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          name: "Canada",
          isoCode: "CA",
          isActive: true,
        },
      ],
    },
  },
  {
    method: "get",
    path: "/api/modules/countries/{countryId}",
    tag: TAG_NAMES.MODULE_COUNTRIES,
    summary: "Get country by ID",
    roles: countryRoles,
    parameters: [param.path("countryId", "Country UUID")],
    responseExample: {
      success: true,
      data: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "UK",
        isoCode: "GB",
        isActive: true,
      },
    },
  },
]);
