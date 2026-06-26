import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";
import {
  ALL_PROCESSING_SUB_STATUS_VALUES,
  STAGE_ORDER,
} from "../../../../modules/visaCase/constants/visaCase.constants";

const visaCaseListRoles = [
  "counsellor",
  "cx",
  "binding",
  "application",
  "admin",
  "manager",
  "developer",
];

const travelUpdateRoles = [
  "counsellor",
  "cx",
  "admin",
  "manager",
  "developer",
];

const decisionRoles = ["application", "binding", "admin", "developer"];

export const visaCasePaths = buildPaths([
  {
    method: "get",
    path: "/api/modules/visa-cases/dashboard",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Visa case dashboard",
    description:
      "Aggregated Visa Case Dashboard (outcomes, financials, processing times, enrollment trend). Data from modules DB.",
    roles: visaCaseListRoles,
    parameters: [
      param.query("fromDate", "Enrollment from date (YYYY-MM-DD)"),
      param.query("toDate", "Enrollment to date (YYYY-MM-DD)"),
      param.query("userId", "Filter by user (admin)", false, "integer"),
      param.query("branchCode", "Filter by branch code, e.g. VAD"),
    ],
    responseExample: {
      success: true,
      data: {
        summary: {
          totalClients: 120,
          approvalRate: "68.5%",
          outstandingBalance: "450000.00",
        },
        caseOutcomes: {
          approved: 45,
          refused: 12,
          pendingDecision: 30,
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/processing-stages",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Processing stage metadata",
    description:
      "All visa processing stages and sub-statuses for filters and status pickers. " +
      "teamViews.binding is a flat combined list for Financial Assessment (4 statuses). " +
      "teamViews.application combines Case Preparation, Filing Preparation, Submission, Decision, and Refiling. " +
      "viewer.teamView and viewer.updatableSubStatuses reflect the caller role.",
    roles: visaCaseListRoles,
    responseExample: {
      success: true,
      data: {
        stages: [
          {
            stage: "DOCUMENTATION",
            label: "Documentation",
            team: "cx",
            subStatuses: [
              {
                value: "CHECKLIST_SHARED",
                label: "Checklist Shared",
                displayLabel: "Documentation: Checklist Shared",
                stage: "DOCUMENTATION",
                stageLabel: "Documentation",
              },
            ],
          },
        ],
        teamViews: {
          binding: {
            team: "binding",
            label: "Binding",
            stages: ["FINANCIAL_ASSESSMENT"],
            subStatuses: [
              {
                value: "REVIEW_PENDING",
                label: "Review Pending",
                displayLabel: "Financial Assessment: Review Pending",
                stage: "FINANCIAL_ASSESSMENT",
                stageLabel: "Financial Assessment",
              },
            ],
          },
          application: {
            team: "application",
            label: "Application",
            stages: [
              "CASE_PREPARATION",
              "FILING_PREPARATION",
              "SUBMISSION",
            ],
            subStatuses: [
              {
                value: "PROFILE_ASSESSMENT_COMPLETED",
                label: "Profile Assessment Completed",
                displayLabel:
                  "Case Preparation: Profile Assessment Completed",
                stage: "CASE_PREPARATION",
                stageLabel: "Case Preparation",
              },
            ],
          },
        },
        viewer: {
          team: "binding",
          teamView: { team: "binding", label: "Binding" },
          updatableSubStatuses: [],
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/modules/visa-cases/sync-eligible",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Sync eligible visa cases for a client",
    description:
      "Creates or updates visa cases for a legacy CRM client when eligibility criteria are met. " +
      "Resolves counsellorId from the request body or from client_information when omitted.",
    roles: ["admin", "manager", "superadmin", "developer"],
    requestBody: jsonBody("SuccessResponse", "Client sync payload"),
    requestExample: {
      legacyClientId: 960,
      counsellorId: 42,
    },
  },
  {
    method: "get",
    path: "/api/modules/visa-cases",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "List visa cases",
    description:
      "Paginated list: client, category, financials, travel/sponsorship (visitor/spouse), studentApplication (student), processing. " +
      "Filter by macro stage via stage or currentStage. " +
      "Filter by processing sub-status via currentSubStatus. " +
      "Decision outcomes (PENDING, APPROVED, REFUSED, WITHDRAWN or DECISION_*) filter by visa_cases.decision so pending returns all cases still awaiting embassy decision regardless of earlier processing stage.",
    roles: visaCaseListRoles,
    parameters: [
      param.query("page", "Page number", false, "integer"),
      param.query("pageSize", "Page size (max 100)", false, "integer"),
      param.query("fromDate", "Enrollment from date (YYYY-MM-DD)"),
      param.query("toDate", "Enrollment to date (YYYY-MM-DD)"),
      param.query("userId", "User ID (client owner)", false, "integer"),
      param.query("destinationCountryId", "Travel destination country UUID"),
      param.query(
        "countryId",
        "Country UUID from GET /api/modules/countries — filters by displayed Destination (travel destination, else sale type country)"
      ),
      param.query("countriesId", "Alias for countryId"),
      param.query("stage", `Alias for currentStage. ${STAGE_ORDER.join(" | ")}`),
      param.query("currentStage", STAGE_ORDER.join(" | ")),
      param.query(
        "currentSubStatus",
        `${ALL_PROCESSING_SUB_STATUS_VALUES.join(" | ")} | PENDING | APPROVED | REFUSED | WITHDRAWN (decision outcomes filter by visa_cases.decision)`
      ),
      param.query("assignedTeam", "cx | binding | application"),
      param.query(
        "assignedUserId",
        "Filter by assignee user id (admin/manager)",
        false,
        "integer"
      ),
      param.query(
        "unassigned",
        "Unassigned cases only (admin/manager): true"
      ),
      param.query("saleTypeId", "Modules sale type UUID"),
      param.query("legacySaleTypeId", "Main CRM sale_type.id", false, "integer"),
      param.query(
        "visaCategory",
        "Visa category slug: visitor | spouse | student (CX visitor/spouse/student views)"
      ),
    ],
    successResponse: "PaginatedResponse",
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/{visaCaseId}",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Get visa case by ID",
    description:
      "Detail view including category, financials, travel/sponsorship or studentApplication block, processing history, and decision.",
    roles: visaCaseListRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    responseExample: {
      success: true,
      data: {
        visaCaseId: "550e8400-e29b-41d4-a716-446655440000",
        category: "student",
        categoryLabel: "Student",
        sale: {
          saleType: "Canada Student",
          legacySaleTypeId: 12,
        },
        studentApplication: {
          applicationId: 101,
          universityName: "University of Toronto",
          courseName: "MBA",
          country: "Canada",
          status: "app_submitted",
          statusLabel: "Application Submitted",
        },
        processing: {
          stage: "DOCUMENTATION",
          subStatus: "CHECKLIST_SHARED",
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/document-requests",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Document request history (global inbox)",
    description:
      "Paginated history of client-wise document requests across visa cases. " +
      "CX sees requests targeted to CX by default; Binding/Application see requests they raised. " +
      "Admins can filter by status, sourceTeam, raisedByRole, visaCaseId, and date range.",
    roles: visaCaseListRoles,
    parameters: [
      param.query("status", "OPEN | FULFILLED | CANCELLED"),
      param.query("sourceTeam", "Team that owned the case when raised (cx | binding | application)"),
      param.query("targetTeam", "Team that must fulfill (usually cx)"),
      param.query("raisedByRole", "Role of user who raised the request"),
      param.query("raisedBy", "User id who raised the request (admin)", false, "integer"),
      param.query("visaCaseId", "Filter to one visa case UUID"),
      param.query("fromDate", "Created from date (YYYY-MM-DD)"),
      param.query("toDate", "Created to date (YYYY-MM-DD)"),
      param.query("page", "Page number (default 1)", false, "integer"),
      param.query("pageSize", "Page size (default 25, max 100)", false, "integer"),
    ],
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/{visaCaseId}/document-requests",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "List client-wise document requests",
    description:
      "Returns all document requests raised for this visa case. " +
      "Useful for CX/Binding/Application to track pending docs per client.",
    roles: visaCaseListRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
  },
  {
    method: "post",
    path: "/api/modules/visa-cases/{visaCaseId}/document-requests",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Raise document request for a client",
    description:
      "Creates a document request for a specific client and moves case to CX document-needed flow " +
      "(DOCUMENTATION + ADDITIONAL_DOCUMENTS_REQUESTED). " +
      "Send either legacyClientId (main CRM id, e.g. 960) or clientId (modules UUID). " +
      "clientId alone also accepts legacy id for backward compatibility.",
    roles: [...visaCaseListRoles, "superadmin"],
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Client-wise document request"),
    requestExample: {
      legacyClientId: 960,
      documentType: "Passport",
      notes: "Need latest stamped copy",
    },
  },
  {
    method: "patch",
    path: "/api/modules/visa-cases/document-requests/{requestId}/fulfill",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Mark document request fulfilled",
    description:
      "Marks the requested document as received. " +
      "If no other open requests remain, case resumes previous stage when payment is fully received.",
    roles: [...visaCaseListRoles, "superadmin"],
    parameters: [param.path("requestId", "Document request UUID")],
    requestBody: jsonBody("SuccessResponse", "Document fulfilment"),
    requestExample: {
      notes: "Uploaded by client over WhatsApp and verified",
    },
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/assignable-users",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "List assignable ops users (bulk assign picker)",
    description:
      "Returns active users with role cx, binding, or application. " +
      "targetRole is optional: admin/manager/branchmanager get all ops users when omitted; " +
      "cx defaults to binding; binding/application default to application. " +
      "Admin/manager may pass targetRole=cx|binding|application to filter. " +
      "CX may only use targetRole=binding; binding may only use targetRole=application.",
    roles: [
      "admin",
      "manager",
      "superadmin",
      "developer",
      "branchmanager",
      "cx",
      "binding",
      "application",
    ],
    parameters: [
      param.query("targetRole", "cx | binding | application", false),
    ],
  },
  {
    method: "post",
    path: "/api/modules/visa-cases/assign-bulk",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Assign multiple visa cases to one ops user",
    description:
      "Assign up to 50 visa cases to one cx, binding, or application user in a single request. Per-case handoff rules still apply.",
    roles: [
      "admin",
      "manager",
      "superadmin",
      "developer",
      "cx",
      "binding",
    ],
    requestBody: jsonBody("SuccessResponse", "Bulk assignment"),
    requestExample: {
      visaCaseIds: [
        "b4b57842-58cc-4ab9-8d43-f8ff8a1ec752",
        "75478467-09cf-4b47-a7a5-0abaca70678c",
      ],
      assignedUserId: 86,
      notes: "Batch assign to CX",
    },
  },
  {
    method: "post",
    path: "/api/modules/visa-cases/{visaCaseId}/assign",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Assign or hand off visa case",
    description:
      "Admin/manager assigns to CX, Binding, or Application. CX hands off to Binding; Binding hands off to Application. Ops users only see cases assigned to them.",
    roles: [
      "admin",
      "manager",
      "superadmin",
      "developer",
      "cx",
      "binding",
    ],
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Assignment"),
    requestExample: {
      assignedUserId: 101,
      empId: "PINT41922",
      notes: "Handing to binding for financial review",
    },
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/{visaCaseId}/assignments",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Assignment history",
    roles: visaCaseListRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
  },
  {
    method: "get",
    path: "/api/modules/visa-cases/{visaCaseId}/assignable-users",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Users available for next assignment",
    description:
      "CX sees binding users; binding sees application users; application sees application peers; " +
      "admin passes targetRole=cx|binding|application.",
    roles: [
      "admin",
      "manager",
      "superadmin",
      "developer",
      "branchmanager",
      "cx",
      "binding",
      "application",
    ],
    parameters: [
      param.path("visaCaseId", "Visa case UUID"),
      param.query("targetRole", "cx | binding | application (admin only)"),
    ],
  },
  {
    method: "patch",
    path: "/api/modules/visa-cases/{visaCaseId}/travel",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Update travel details",
    roles: travelUpdateRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Travel details"),
    requestExample: {
      reasonOfTravel: "TOURISM",
      destinationCountryId: "550e8400-e29b-41d4-a716-446655440000",
    },
  },
  {
    method: "patch",
    path: "/api/modules/visa-cases/{visaCaseId}/sponsorship",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Update sponsorship details",
    roles: travelUpdateRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Sponsorship details"),
    requestExample: {
      sponsorRelationship: "SON",
      accompanyingMembersCount: 2,
    },
  },
  {
    method: "patch",
    path: "/api/modules/visa-cases/{visaCaseId}/status",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Set processing status directly",
    description:
      "Sets the visa case processing sub-status directly (no sequential stage workflow). " +
      "Stage and assigned team are derived from subStatus. Status history and client journey are still recorded. " +
      "Optional submissionDate (for FILE_SUBMITTED) and decisionDate (for DECISION_APPROVED / DECISION_REFUSED / DECISION_WITHDRAWN) accept YYYY-MM-DD or DD-MM-YYYY. " +
      "See GET /processing-stages for all valid subStatus values and labels.",
    roles: [...visaCaseListRoles, "superadmin"],
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Processing status update"),
    requestExample: {
      subStatus: "DECISION_APPROVED",
      decisionDate: "2026-06-15",
      notes: "Visa approved",
    },
  },
  {
    method: "patch",
    path: "/api/modules/visa-cases/{visaCaseId}/decision",
    tag: TAG_NAMES.MODULE_VISA_CASES,
    summary: "Update embassy decision",
    roles: decisionRoles,
    parameters: [param.path("visaCaseId", "Visa case UUID")],
    requestBody: jsonBody("SuccessResponse", "Decision tracking"),
    requestExample: {
      decision: "APPROVED",
      decisionDate: "2026-06-01",
      remarks: "Visa granted",
    },
  },
]);
