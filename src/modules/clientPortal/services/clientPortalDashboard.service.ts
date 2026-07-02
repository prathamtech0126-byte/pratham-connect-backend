import { isModulesDbConfigured, getPoolSecond } from "../../../config/databaseConnectionSecond";
import { getClientStorageUsage, listChecklistAssignmentsForClient } from "../../clientDocuments/services/clientDocumentChecklist.service";
import {
  listDocumentReviewEventsForClient,
  mapReviewEventToUpdate,
} from "../../clientDocuments/services/clientDocumentReview.service";
import { getClientPortalProfile } from "./clientPortalAuth.service";

export type ApplicationStatusCode =
  | "NO_CHECKLIST"
  | "DOCUMENTS_PENDING"
  | "DOCUMENTS_SUBMITTED"
  | "UNDER_REVIEW";

export interface ClientPortalDashboard {
  client: {
    clientId: number;
    fullName: string;
    email: string;
    username: string;
    mustChangePassword: boolean;
  };
  counsellor: {
    id: number;
    fullName: string;
    email: string;
  } | null;
  applicationStatus: {
    code: ApplicationStatusCode;
    label: string;
    subtitle: string;
  };
  documents: {
    required: number;
    uploaded: number;
    pending: number;
    approved: number;
    rejected: number;
    underReview: number;
    assignmentsCount: number;
    approvedItems: Array<{ itemName: string; assignmentId: number; checklistItemId: string }>;
  };
  storage: {
    usedBytes: number;
    quotaBytes: number;
    percentUsed: number;
  };
  journey: {
    currentStage: string | null;
    currentStageLabel: string | null;
  } | null;
  upcomingTasks: Array<{
    type: "upload";
    assignmentId: number;
    checklistItemId: string;
    itemName: string;
    checklistTitle: string | null;
    isMandatory: boolean;
  }>;
  recentUpdates: Array<{
    type: "document_uploaded" | "document_approved" | "document_rejected";
    title: string;
    description: string;
    occurredAt: string;
    assignmentId: number;
    checklistItemId: string;
    fileName: string | null;
    rejectionReason: string | null;
  }>;
}

const JOURNEY_STAGE_LABELS: Record<string, string> = {
  ENROLLED: "Enrolled",
  INITIAL_PAYMENT_PENDING: "Initial Payment Pending",
  INITIAL_PAYMENT_DONE: "Initial Payment Done",
  DOCUMENTS_IN_PROGRESS: "Documents In Progress",
  DOCUMENTS_SUBMITTED: "Documents Submitted",
  BEFORE_VISA_PAYMENT_PENDING: "Before Visa Payment Pending",
  BEFORE_VISA_PAYMENT_DONE: "Before Visa Payment Done",
  VISA_FILED: "Visa Filed",
  VISA_RESULT_PENDING: "Visa Result Pending",
  AFTER_VISA_PAYMENT_PENDING: "After Visa Payment Pending",
  AFTER_VISA_PAYMENT_DONE: "After Visa Payment Done",
  VISA_APPROVED: "Visa Approved",
  VISA_REJECTED: "Visa Rejected",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

type AssignmentTree = Awaited<ReturnType<typeof listChecklistAssignmentsForClient>>;

function formatStageLabel(code: string | null): string | null {
  if (!code) return null;
  return JOURNEY_STAGE_LABELS[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getClientJourneySnapshot(clientId: number): Promise<ClientPortalDashboard["journey"]> {
  if (!isModulesDbConfigured()) return null;

  try {
    const { rows } = await getPoolSecond().query<{ current_stage: string | null }>(
      `SELECT cj.current_stage
         FROM client_journey cj
         JOIN clients c ON c.id = cj.client_id
        WHERE c.legacy_client_id = $1
        LIMIT 1`,
      [clientId]
    );

    const currentStage = rows[0]?.current_stage ?? null;
    return {
      currentStage,
      currentStageLabel: formatStageLabel(currentStage),
    };
  } catch {
    return null;
  }
}

function computeDocumentStats(assignments: AssignmentTree) {
  let required = 0;
  let uploaded = 0;
  let approved = 0;
  let rejected = 0;
  let underReview = 0;
  let notUploaded = 0;
  const approvedItems: ClientPortalDashboard["documents"]["approvedItems"] = [];

  for (const assignment of assignments) {
    for (const section of assignment.sections) {
      for (const item of section.items) {
        if (!item.isMandatory) continue;
        required += 1;

        const status = item.reviewStatus ?? (item.uploads.length > 0 ? "under_review" : "not_uploaded");

        if (status === "not_uploaded") {
          notUploaded += 1;
        } else {
          uploaded += 1;
        }

        if (status === "approved") {
          approved += 1;
          approvedItems.push({
            itemName: item.name,
            assignmentId: assignment.id,
            checklistItemId: item.id,
          });
        } else if (status === "rejected") {
          rejected += 1;
        } else if (status === "under_review") {
          underReview += 1;
        }
      }
    }
  }

  return {
    required,
    uploaded,
    pending: notUploaded + rejected,
    approved,
    rejected,
    underReview,
    assignmentsCount: assignments.length,
    approvedItems: approvedItems.slice(0, 10),
  };
}

function deriveApplicationStatus(
  assignments: AssignmentTree,
  documents: ReturnType<typeof computeDocumentStats>,
  journey: ClientPortalDashboard["journey"]
): ClientPortalDashboard["applicationStatus"] {
  if (assignments.length === 0) {
    return {
      code: "NO_CHECKLIST",
      label: "Getting Started",
      subtitle: "Your counsellor will share your document checklist soon",
    };
  }

  if (documents.pending > 0) {
    const subtitle =
      documents.rejected > 0
        ? `${documents.rejected} rejected, ${Math.max(0, documents.required - documents.uploaded)} still required`
        : `${documents.pending} document(s) still required`;

    return {
      code: "DOCUMENTS_PENDING",
      label: documents.rejected > 0 ? "Action Required" : "Documents Pending",
      subtitle,
    };
  }

  if (documents.underReview > 0) {
    return {
      code: "UNDER_REVIEW",
      label: "Under Review",
      subtitle: `${documents.underReview} document(s) are being reviewed`,
    };
  }

  if (documents.required > 0 && documents.approved >= documents.required) {
    const journeyStage = journey?.currentStage;
    if (journeyStage === "DOCUMENTS_SUBMITTED" || journeyStage === "VISA_FILED") {
      return {
        code: "UNDER_REVIEW",
        label: "Under Review",
        subtitle: journey?.currentStageLabel ?? "Your application is being reviewed",
      };
    }

    return {
      code: "DOCUMENTS_SUBMITTED",
      label: "Documents Submitted",
      subtitle: "All required documents have been uploaded",
    };
  }

  return {
    code: "UNDER_REVIEW",
    label: "In Progress",
    subtitle: journey?.currentStageLabel ?? "Your application is in progress",
  };
}

function buildUpcomingTasks(assignments: AssignmentTree): ClientPortalDashboard["upcomingTasks"] {
  const tasks: ClientPortalDashboard["upcomingTasks"] = [];

  for (const assignment of assignments) {
    for (const section of assignment.sections) {
      for (const item of section.items) {
        if (!item.isMandatory) continue;

        const status = item.reviewStatus ?? (item.uploads.length > 0 ? "under_review" : "not_uploaded");
        const needsUpload = status === "not_uploaded" || status === "rejected";
        if (!needsUpload) continue;

        tasks.push({
          type: "upload",
          assignmentId: assignment.id,
          checklistItemId: item.id,
          itemName: item.name,
          checklistTitle: assignment.checklistTitle,
          isMandatory: item.isMandatory,
        });
      }
    }
  }

  return tasks.slice(0, 10);
}

async function buildRecentUpdates(
  clientId: number,
  limit = 5
): Promise<ClientPortalDashboard["recentUpdates"]> {
  const events = await listDocumentReviewEventsForClient(clientId, limit);
  return events.map(mapReviewEventToUpdate);
}

export async function getClientPortalDashboard(accountId: number): Promise<ClientPortalDashboard> {
  const profile = await getClientPortalProfile(accountId);
  const clientId = profile.clientId;

  const [assignments, storage, journey, recentUpdates] = await Promise.all([
    listChecklistAssignmentsForClient(clientId),
    getClientStorageUsage(clientId),
    getClientJourneySnapshot(clientId),
    buildRecentUpdates(clientId),
  ]);

  const documents = computeDocumentStats(assignments);
  const usedBytes = Number(storage?.usedBytes ?? 0);
  const quotaBytes = Number(storage?.quotaBytes ?? 0);
  const percentUsed = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;

  return {
    client: {
      clientId: profile.clientId,
      fullName: profile.fullName,
      email: profile.email,
      username: profile.username,
      mustChangePassword: profile.mustChangePassword,
    },
    counsellor: profile.counsellor,
    applicationStatus: deriveApplicationStatus(assignments, documents, journey),
    documents,
    storage: {
      usedBytes,
      quotaBytes,
      percentUsed,
    },
    journey,
    upcomingTasks: buildUpcomingTasks(assignments),
    recentUpdates,
  };
}
