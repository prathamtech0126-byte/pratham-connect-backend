import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody, param } from "../../utils/routeBuilder";

export const clientDocumentsPaths = buildPaths([
  {
    method: "post",
    path: "/api/client-documents/assignments",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Assign checklist to client",
    roles: ["counsellor", "admin", "superadmin", "developer"],
    requestBody: jsonBody(
      "ClientPortalChecklistAssignmentRequest",
      "Checklist assignment payload"
    ),
    requestExample: {
      clientId: 101,
      checklistId: "b13f6d84-f9db-4b3a-a5db-a6935f2a87c2",
      visaType: "Visitor",
      country: "canada",
    },
  },
  {
    method: "get",
    path: "/api/client-documents/assignments/{clientId}",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "List assigned checklists for a client",
    description:
      "Staff view of assigned checklists and upload status. Available to counsellor, CX, binding, and admin roles.",
    roles: ["counsellor", "cx", "binding", "admin", "superadmin", "manager", "developer"],
    parameters: [param.path("clientId", "Legacy client_information.id", "integer")],
  },
  {
    method: "post",
    path: "/api/client-documents/uploads",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Upload checklist document on behalf of client",
    description:
      "Allows counsellor, CX, and binding team to upload documents when the client cannot. Multipart form-data: clientId, assignmentId, checklistItemId, file.",
    roles: ["counsellor", "cx", "binding", "admin", "superadmin", "manager", "developer"],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["clientId", "assignmentId", "checklistItemId", "file"],
            properties: {
              clientId: { type: "integer", example: 1103 },
              assignmentId: { type: "integer", example: 1 },
              checklistItemId: {
                type: "string",
                format: "uuid",
                example: "23fc66eb-d5f6-462e-980b-5b4db3451bfa",
              },
              file: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
      },
    },
    responseExample: {
      success: true,
      data: {
        upload: {
          id: 56,
          fileName: "passport.pdf",
          uploadedByUserId: 44,
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/client-portal/checklists",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Get assigned checklists for logged-in client",
    responseExample: {
      success: true,
      data: [
        {
          id: 12,
          checklistId: "b13f6d84-f9db-4b3a-a5db-a6935f2a87c2",
          checklistTitle: "Canada Visitor Visa",
          visaType: "Visitor",
          country: "canada",
          folderPath: "Visitor/canada/john-doe-pra-vad-cli-2026-000101",
        },
      ],
    },
  },
  {
    method: "get",
    path: "/api/client-portal/storage-usage",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Get storage quota usage for logged-in client",
    responseExample: {
      success: true,
      data: {
        clientId: 101,
        quotaBytes: 2147483648,
        usedBytes: 1048576,
      },
    },
  },
  {
    method: "post",
    path: "/api/client-portal/checklists/upload",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Upload checklist document",
    description:
      "Multipart upload. Send `assignmentId`, `checklistItemId`, and `file` in form-data.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["assignmentId", "checklistItemId", "file"],
            properties: {
              assignmentId: { type: "integer", example: 12 },
              checklistItemId: {
                type: "string",
                format: "uuid",
                example: "6cf2d7f6-67cb-4202-9034-4ec9f98f0632",
              },
              file: {
                type: "string",
                format: "binary",
              },
            },
          },
        },
      },
    },
    responseExample: {
      success: true,
      data: {
        upload: {
          id: 55,
          fileName: "passport.pdf",
          mimeType: "application/pdf",
          sizeBytes: 245678,
          workdriveFileId: "u9m8k7j6h5g4",
        },
      },
    },
  },
  {
    method: "post",
    path: "/api/client-documents/reviews/approve",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Approve a client checklist document",
    roles: ["counsellor", "cx", "binding", "admin", "superadmin", "manager", "developer"],
    requestBody: jsonBody("ClientDocumentReviewActionRequest", "Approve document payload"),
    requestExample: {
      clientId: 1103,
      assignmentId: 1,
      checklistItemId: "6cf2d7f6-67cb-4202-9034-4ec9f98f0632",
    },
  },
  {
    method: "post",
    path: "/api/client-documents/reviews/reject",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "Reject a client checklist document",
    roles: ["counsellor", "cx", "binding", "admin", "superadmin", "manager", "developer"],
    requestBody: jsonBody("ClientDocumentRejectRequest", "Reject document payload"),
    requestExample: {
      clientId: 1103,
      assignmentId: 1,
      checklistItemId: "6cf2d7f6-67cb-4202-9034-4ec9f98f0632",
      rejectionReason: "Passport copy is blurry. Please upload a clearer scan.",
    },
  },
  {
    method: "get",
    path: "/api/client-documents/reviews/events/{clientId}",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "List document review events for a client (staff)",
    roles: ["counsellor", "cx", "binding", "admin", "superadmin", "manager", "developer"],
    parameters: [param.path("clientId", "Legacy client_information.id", "integer")],
  },
  {
    method: "get",
    path: "/api/client-portal/review-events",
    tag: TAG_NAMES.CLIENT_DOCUMENTS,
    summary: "List document review events for logged-in client",
    responseExample: {
      success: true,
      data: [
        {
          type: "document_approved",
          title: "Document Approved",
          description: "Passport has been approved",
          occurredAt: "2026-07-02T10:00:00.000Z",
          assignmentId: 1,
          checklistItemId: "6cf2d7f6-67cb-4202-9034-4ec9f98f0632",
          fileName: null,
          rejectionReason: null,
        },
      ],
    },
  },
]);
