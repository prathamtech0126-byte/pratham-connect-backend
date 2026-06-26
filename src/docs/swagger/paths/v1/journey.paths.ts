import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

const journeyRoles = [
  "counsellor",
  "telecaller",
  "cx",
  "binding",
  "application",
  "admin",
  "manager",
  "developer",
];

export const journeyPaths = buildPaths([
  {
    method: "get",
    path: "/api/modules/clients/{clientId}/journey-timeline",
    tag: TAG_NAMES.MODULE_JOURNEY,
    summary: "Client journey timeline",
    description:
      "All journey events for a client, sorted newest first. Merges modules-DB sources: " +
      "`journey_timeline_events` (enrollment, transfer, conversion, visa creation, payments, decisions), " +
      "`client_transfer_modules` (counsellor handoffs), " +
      "`visa_case_assignments` (team handoffs), and `visa_case_status_events` (processing stage changes). " +
      "Actor names are resolved from the main CRM users table. " +
      "`clientId` accepts modules UUID or legacy CRM `client_information.id`. " +
      "Counsellors: own or shared clients. Telecallers: clients converted from their assigned leads. " +
      "Events are returned newest first.",
    roles: journeyRoles,
    parameters: [param.path("clientId", "Modules client UUID or legacy CRM client id")],
    responseExample: {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      legacyClientId: 960,
      counsellorId: 42,
      enrollmentDate: "2026-01-15",
      createdAt: "2026-01-15T10:30:00.000Z",
      events: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          occurredAt: "2026-01-15T10:30:00.000Z",
          phase: "ENROLLMENT",
          type: "CLIENT_ENROLLED",
          title: "Client enrolled",
          description: null,
          actor: { id: 42, name: "Jane Doe", role: "counsellor" },
          visaCaseId: null,
          metadata: {
            enrollmentDate: "2026-01-15",
            createdAt: "2026-01-15T10:30:00.000Z",
          },
          source: "journey_event",
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440002",
          occurredAt: "2026-01-16T09:00:00.000Z",
          phase: "ASSIGNMENT",
          type: "ASSIGNMENT_CX_TO_BINDING",
          title: "Handed off to Binding team",
          description: "Assigned to John Smith by Admin User",
          actor: { id: 1, name: "Admin User", role: "admin" },
          visaCaseId: "660e8400-e29b-41d4-a716-446655440000",
          metadata: {
            assignedTeam: "binding",
            assignedUserId: 55,
            assignedUserName: "John Smith",
            previousTeam: "cx",
            previousUserId: 42,
            assignmentType: "cx_to_binding",
            notes: null,
          },
          source: "visa_assignment",
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440003",
          occurredAt: "2026-01-20T14:15:00.000Z",
          phase: "PROCESSING",
          type: "STATUS_CHECKLIST_SHARED",
          title: "Status: Checklist Shared",
          description: null,
          actor: { id: 55, name: "John Smith", role: "binding" },
          visaCaseId: "660e8400-e29b-41d4-a716-446655440000",
          metadata: {
            fromStage: null,
            toStage: "DOCUMENTATION",
            fromSubStatus: null,
            toSubStatus: "CHECKLIST_SHARED",
          },
          source: "visa_status_event",
        },
      ],
      total: 3,
    },
  },
  {
    method: "get",
    path: "/api/modules/clients/{clientId}/journey-summary",
    tag: TAG_NAMES.MODULE_JOURNEY,
    summary: "Client journey summary",
    description:
      "Current journey stage, active visa cases, and total event count across all timeline sources. " +
      "Data from modules DB (`client_journey`, `visa_cases`, and event tables). " +
      "`clientId` accepts modules UUID or legacy CRM `client_information.id`.",
    roles: journeyRoles,
    parameters: [param.path("clientId", "Modules client UUID or legacy CRM client id")],
    responseExample: {
      clientId: "550e8400-e29b-41d4-a716-446655440000",
      legacyClientId: 960,
      counsellorId: 42,
      enrollmentDate: "2026-01-15",
      createdAt: "2026-01-15T10:30:00.000Z",
      currentJourneyStage: "DOCUMENTS_IN_PROGRESS",
      currentProcessingStage: "DOCUMENTATION",
      currentProcessingSubStatus: "CHECKLIST_SHARED",
      activeVisaCases: [
        {
          id: "660e8400-e29b-41d4-a716-446655440000",
          currentStage: "DOCUMENTATION",
          currentSubStatus: "CHECKLIST_SHARED",
          decision: "PENDING",
          assignedTeam: "binding",
          assignedUserId: 55,
        },
      ],
      totalEvents: 12,
    },
  },
]);
