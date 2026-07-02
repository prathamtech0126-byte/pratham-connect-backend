import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

const stageReadRoles = [
  "counsellor",
  "cx",
  "binding",
  "application",
  "admin",
  "manager",
  "developer",
];

const stageAdminRoles = ["admin", "superadmin", "manager", "developer"];

export const moduleStagesPaths = buildPaths([
  {
    method: "get",
    path: "/api/modules/stages/pipelines",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "List stage pipelines",
    description:
      "Returns the three stage domains: CLIENT_JOURNEY, VISA_CASE_PROCESSING, and PAYMENT.",
    roles: stageReadRoles,
    parameters: [
      param.query(
        "includeInactive",
        "Include inactive pipelines: true | false (default: false)"
      ),
    ],
    responseExample: {
      success: true,
      count: 3,
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          code: "CLIENT_JOURNEY",
          name: "Client Journey",
          isActive: true,
        },
      ],
    },
  },
  {
    method: "get",
    path: "/api/modules/stages/pipelines/{pipelineCode}",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Get stage pipeline by code",
    roles: stageReadRoles,
    parameters: [param.path("pipelineCode", "CLIENT_JOURNEY | VISA_CASE_PROCESSING | PAYMENT")],
    responseExample: {
      success: true,
      data: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        code: "VISA_CASE_PROCESSING",
        name: "Visa Case Processing",
        isActive: true,
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/stages/pipelines/{pipelineCode}/tree",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Get nested stages for a pipeline",
    description:
      "Returns macro stages with nested sub-statuses. Visa case processing uses macro + sub_status hierarchy.",
    roles: stageReadRoles,
    parameters: [
      param.path("pipelineCode", "Pipeline code"),
      param.query("includeInactive", "Include inactive stages: true | false"),
    ],
    responseExample: {
      success: true,
      data: {
        pipeline: { code: "VISA_CASE_PROCESSING", name: "Visa Case Processing" },
        stages: [
          {
            code: "DOCUMENTATION",
            label: "Documentation",
            kind: "macro",
            subStatuses: [
              { code: "CHECKLIST_SHARED", label: "Checklist Shared", kind: "sub_status" },
            ],
          },
        ],
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/stages",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "List stage definitions",
    roles: stageReadRoles,
    parameters: [
      param.query("pipeline", "Filter by pipeline code"),
      param.query("parentId", "Filter by parent stage UUID, or null for macro stages"),
      param.query("kind", "Filter by kind: macro | sub_status"),
      param.query("includeInactive", "Include inactive stages: true | false"),
    ],
    responseExample: {
      success: true,
      count: 2,
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          pipelineCode: "CLIENT_JOURNEY",
          code: "ENROLLED",
          label: "Enrolled",
          kind: "macro",
          sortOrder: 10,
          isSystem: true,
          isActive: true,
        },
      ],
    },
  },
  {
    method: "get",
    path: "/api/modules/stages/{stageId}",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Get stage definition by ID",
    roles: stageReadRoles,
    parameters: [param.path("stageId", "Stage UUID")],
    responseExample: {
      success: true,
      data: {
        id: "550e8400-e29b-41d4-a716-446655440001",
        pipelineCode: "VISA_CASE_PROCESSING",
        code: "DOCUMENTATION",
        label: "Documentation",
        kind: "macro",
        team: "cx",
        subStatuses: [],
      },
    },
  },
  {
    method: "post",
    path: "/api/modules/stages",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Create stage definition (admin)",
    roles: stageAdminRoles,
    requestExample: {
      pipelineCode: "CLIENT_JOURNEY",
      code: "CUSTOM_STAGE",
      label: "Custom Stage",
      sortOrder: 200,
      kind: "macro",
    },
    responseExample: {
      success: true,
      message: "Stage created",
      data: {
        id: "550e8400-e29b-41d4-a716-446655440099",
        code: "CUSTOM_STAGE",
        label: "Custom Stage",
      },
    },
  },
  {
    method: "patch",
    path: "/api/modules/stages/{stageId}",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Update stage definition (admin)",
    roles: stageAdminRoles,
    parameters: [param.path("stageId", "Stage UUID")],
    requestExample: {
      label: "Updated Label",
      sortOrder: 25,
      isActive: true,
    },
    responseExample: {
      success: true,
      message: "Stage updated",
      data: {
        id: "550e8400-e29b-41d4-a716-446655440099",
        label: "Updated Label",
      },
    },
  },
  {
    method: "delete",
    path: "/api/modules/stages/{stageId}",
    tag: TAG_NAMES.MODULE_STAGES,
    summary: "Deactivate or delete stage (admin)",
    description:
      "Soft-deactivates by default. Pass hard=true to permanently delete non-system stages with no children.",
    roles: stageAdminRoles,
    parameters: [
      param.path("stageId", "Stage UUID"),
      param.query("hard", "Permanent delete: true | false (default: false)"),
    ],
    responseExample: {
      success: true,
      message: "Stage deactivated",
      data: null,
    },
  },
]);
