import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, jsonBody } from "../../utils/routeBuilder";

export const clientPortalPaths = buildPaths([
  {
    method: "post",
    path: "/api/client-portal/login",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Client portal login",
    secured: false,
    description: "Authenticate client using loginId (email or username) and password.",
    requestBody: jsonBody("ClientPortalLoginRequest", "Client portal login credentials"),
    requestExample: {
      loginId: "client@example.com",
      password: "TempPass123!",
    },
    responseExample: {
      message: "Login successful",
      mustChangePassword: true,
      csrfToken: "csrf-token",
      client: {
        clientId: 101,
        accountId: "acc_123",
        fullName: "John Client",
        email: "client@example.com",
        username: "john.client",
      },
    },
  },
  {
    method: "post",
    path: "/api/client-portal/refresh",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Refresh client portal session",
    secured: false,
    requestBody: jsonBody(
      "ClientPortalRefreshRequest",
      "Refresh token payload (optional if sent via cookie)",
      false
    ),
    responseExample: {
      message: "Token refreshed",
      mustChangePassword: false,
      csrfToken: "csrf-token",
      clientId: 101,
    },
  },
  {
    method: "post",
    path: "/api/client-portal/logout",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Logout client portal session",
    requestBody: jsonBody(
      "ClientPortalRefreshRequest",
      "Refresh token payload (optional if sent via cookie)",
      false
    ),
    responseExample: {
      message: "Logged out",
    },
  },
  {
    method: "post",
    path: "/api/client-portal/change-password",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Change client portal password",
    description: "Changes password for the logged-in client and invalidates current session cookies.",
    requestBody: jsonBody("ClientPortalChangePasswordRequest", "Current and new password"),
    requestExample: {
      currentPassword: "TempPass123!",
      newPassword: "StrongPass456!",
    },
    responseExample: {
      message: "Password changed successfully. Please log in again.",
    },
  },
  {
    method: "get",
    path: "/api/client-portal/me",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Get logged-in client portal profile",
    responseExample: {
      clientId: 101,
      accountId: "acc_123",
      fullName: "John Client",
      email: "client@example.com",
      username: "john.client",
      mustChangePassword: false,
      lastLoginAt: "2026-07-02T08:30:00.000Z",
    },
  },
  {
    method: "get",
    path: "/api/client-portal/dashboard",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Client portal dashboard summary",
    description:
      "Aggregated home-screen data: profile, counsellor, document progress, storage, upcoming upload tasks, and recent upload activity.",
    responseExample: {
      success: true,
      data: {
        client: {
          clientId: 101,
          fullName: "John Client",
          email: "client@example.com",
          username: "john.client",
          mustChangePassword: false,
        },
        counsellor: {
          id: 14,
          fullName: "Priya Sharma",
          email: "counsellor@example.com",
        },
        applicationStatus: {
          code: "DOCUMENTS_PENDING",
          label: "Documents Pending",
          subtitle: "2 document(s) still required",
        },
        documents: {
          required: 6,
          uploaded: 4,
          pending: 2,
          assignmentsCount: 1,
        },
        storage: {
          usedBytes: 1048576,
          quotaBytes: 2147483648,
          percentUsed: 0,
        },
        journey: {
          currentStage: "DOCUMENTS_IN_PROGRESS",
          currentStageLabel: "Documents In Progress",
        },
        upcomingTasks: [
          {
            type: "upload",
            assignmentId: 1,
            checklistItemId: "item-uuid",
            itemName: "Passport",
            checklistTitle: "Canada Visitor Visa",
            isMandatory: true,
          },
        ],
        recentUpdates: [
          {
            type: "document_uploaded",
            title: "Document Uploaded",
            description: "Bank Statement uploaded",
            occurredAt: "2026-07-02T08:30:00.000Z",
            assignmentId: 1,
            checklistItemId: "item-uuid",
            fileName: "bank-statement.pdf",
          },
        ],
      },
    },
  },
  {
    method: "get",
    path: "/api/client-portal/timeline",
    tag: TAG_NAMES.CLIENT_PORTAL,
    summary: "Client application timeline",
    description:
      "Returns a client-safe 5-step application timeline with progress percentage, step status, and timestamps.",
    responseExample: {
      success: true,
      data: {
        progressPercent: 40,
        completedSteps: 2,
        totalSteps: 5,
        currentPhaseLabel: "Under Review",
        currentStepCode: "UNDER_REVIEW",
        journeyStage: "DOCUMENTS_SUBMITTED",
        visaResult: null,
        enrollmentDate: "2026-01-15",
        note: "Timeline dates are estimates. Updates are reflected within 1–2 business days.",
        steps: [
          {
            code: "APPLICATION_STARTED",
            title: "Application Started",
            status: "completed",
            occurredAt: "2026-01-15T10:30:00.000Z",
            sortOrder: 1,
          },
          {
            code: "UNDER_REVIEW",
            title: "Under Review",
            status: "in_progress",
            occurredAt: "2026-02-05T09:15:00.000Z",
            sortOrder: 3,
          },
        ],
      },
    },
  },
]);
