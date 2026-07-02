import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { canUserModifyClient } from "../../clients/services/clientAccess.service";
import { clientDocumentAssignments } from "../schemas/clientDocumentAssignment.schema";
import {
  clientDocumentItemStatuses,
  type ClientDocumentReviewStatus,
} from "../schemas/clientDocumentItemStatus.schema";
import {
  clientDocumentReviewEvents,
  type ClientDocumentReviewEventType,
} from "../schemas/clientDocumentReviewEvent.schema";
import { clientDocumentChecklistItems } from "../schemas/clientDocumentChecklist.schema";
import { ClientDocumentError } from "./clientDocumentChecklist.service";

export type ItemReviewStatus = ClientDocumentReviewStatus | "not_uploaded";

export async function resolveChecklistItemName(checklistItemId: string): Promise<string> {
  const [item] = await getDbSecond()
    .select({ name: clientDocumentChecklistItems.name })
    .from(clientDocumentChecklistItems)
    .where(eq(clientDocumentChecklistItems.id, checklistItemId))
    .limit(1);

  return item?.name ?? "Document";
}

export async function recordDocumentUploaded(input: {
  clientId: number;
  assignmentId: number;
  checklistItemId: string;
  uploadId: number;
  fileName: string;
  itemName: string;
  actor: { type: "client"; accountId: number } | { type: "staff"; userId: number };
}) {
  const now = new Date();

  await db
    .insert(clientDocumentItemStatuses)
    .values({
      assignmentId: input.assignmentId,
      checklistItemId: input.checklistItemId,
      clientId: input.clientId,
      status: "under_review",
      latestUploadId: input.uploadId,
      reviewedByUserId: null,
      reviewedAt: null,
      rejectionReason: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        clientDocumentItemStatuses.assignmentId,
        clientDocumentItemStatuses.checklistItemId,
      ],
      set: {
        status: "under_review",
        latestUploadId: input.uploadId,
        reviewedByUserId: null,
        reviewedAt: null,
        rejectionReason: null,
        updatedAt: now,
      },
    });

  await db.insert(clientDocumentReviewEvents).values({
    clientId: input.clientId,
    assignmentId: input.assignmentId,
    checklistItemId: input.checklistItemId,
    uploadId: input.uploadId,
    eventType: "uploaded",
    itemName: input.itemName,
    fileName: input.fileName,
    rejectionReason: null,
    actorType: input.actor.type,
    actorAccountId: input.actor.type === "client" ? input.actor.accountId : null,
    actorUserId: input.actor.type === "staff" ? input.actor.userId : null,
  });
}

async function assertStaffCanReviewClient(
  clientId: number,
  userId: number,
  role: string
): Promise<void> {
  const allowed = await canUserModifyClient(clientId, userId, role);
  if (!allowed) {
    throw new ClientDocumentError("Forbidden: you cannot review this client's documents", 403);
  }
}

async function assertAssignmentItem(input: {
  clientId: number;
  assignmentId: number;
  checklistItemId: string;
}) {
  const [assignment] = await db
    .select()
    .from(clientDocumentAssignments)
    .where(
      and(
        eq(clientDocumentAssignments.id, input.assignmentId),
        eq(clientDocumentAssignments.clientId, input.clientId),
        eq(clientDocumentAssignments.status, "active")
      )
    )
    .limit(1);

  if (!assignment) {
    throw new ClientDocumentError("Checklist assignment not found", 404);
  }

  const [status] = await db
    .select()
    .from(clientDocumentItemStatuses)
    .where(
      and(
        eq(clientDocumentItemStatuses.assignmentId, input.assignmentId),
        eq(clientDocumentItemStatuses.checklistItemId, input.checklistItemId),
        eq(clientDocumentItemStatuses.clientId, input.clientId)
      )
    )
    .limit(1);

  if (!status || !status.latestUploadId) {
    throw new ClientDocumentError("No uploaded document found for this checklist item", 400);
  }

  return { assignment, status };
}

export async function approveChecklistItemDocument(input: {
  clientId: number;
  assignmentId: number;
  checklistItemId: string;
  reviewedByUserId: number;
  role: string;
}) {
  await assertStaffCanReviewClient(input.clientId, input.reviewedByUserId, input.role);
  const { status } = await assertAssignmentItem(input);
  const itemName = await resolveChecklistItemName(input.checklistItemId);
  const now = new Date();

  const [updated] = await db
    .update(clientDocumentItemStatuses)
    .set({
      status: "approved",
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: now,
      rejectionReason: null,
      updatedAt: now,
    })
    .where(eq(clientDocumentItemStatuses.id, status.id))
    .returning();

  await db.insert(clientDocumentReviewEvents).values({
    clientId: input.clientId,
    assignmentId: input.assignmentId,
    checklistItemId: input.checklistItemId,
    uploadId: status.latestUploadId,
    eventType: "approved",
    itemName,
    fileName: null,
    rejectionReason: null,
    actorType: "staff",
    actorUserId: input.reviewedByUserId,
  });

  return updated;
}

export async function rejectChecklistItemDocument(input: {
  clientId: number;
  assignmentId: number;
  checklistItemId: string;
  reviewedByUserId: number;
  role: string;
  rejectionReason: string;
}) {
  const reason = input.rejectionReason?.trim();
  if (!reason) {
    throw new ClientDocumentError("rejectionReason is required", 400);
  }

  await assertStaffCanReviewClient(input.clientId, input.reviewedByUserId, input.role);
  const { status } = await assertAssignmentItem(input);
  const itemName = await resolveChecklistItemName(input.checklistItemId);
  const now = new Date();

  const [updated] = await db
    .update(clientDocumentItemStatuses)
    .set({
      status: "rejected",
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: now,
      rejectionReason: reason,
      updatedAt: now,
    })
    .where(eq(clientDocumentItemStatuses.id, status.id))
    .returning();

  await db.insert(clientDocumentReviewEvents).values({
    clientId: input.clientId,
    assignmentId: input.assignmentId,
    checklistItemId: input.checklistItemId,
    uploadId: status.latestUploadId,
    eventType: "rejected",
    itemName,
    fileName: null,
    rejectionReason: reason,
    actorType: "staff",
    actorUserId: input.reviewedByUserId,
  });

  return updated;
}

export async function getItemStatusesForAssignments(assignmentIds: number[]) {
  if (assignmentIds.length === 0) return new Map<string, typeof clientDocumentItemStatuses.$inferSelect>();

  const rows = await db
    .select()
    .from(clientDocumentItemStatuses)
    .where(inArray(clientDocumentItemStatuses.assignmentId, assignmentIds));

  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    map.set(`${row.assignmentId}:${row.checklistItemId}`, row);
  }
  return map;
}

export async function listDocumentReviewEventsForClient(clientId: number, limit = 20) {
  return db
    .select()
    .from(clientDocumentReviewEvents)
    .where(eq(clientDocumentReviewEvents.clientId, clientId))
    .orderBy(desc(clientDocumentReviewEvents.createdAt))
    .limit(limit);
}

export function mapReviewEventToUpdate(event: {
  eventType: string;
  itemName: string;
  fileName: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  assignmentId: number;
  checklistItemId: string;
}) {
  const type = event.eventType as ClientDocumentReviewEventType;
  if (type === "approved") {
    return {
      type: "document_approved" as const,
      title: "Document Approved",
      description: `${event.itemName} has been approved`,
      occurredAt: event.createdAt.toISOString(),
      assignmentId: event.assignmentId,
      checklistItemId: event.checklistItemId,
      fileName: event.fileName,
      rejectionReason: null,
    };
  }
  if (type === "rejected") {
    return {
      type: "document_rejected" as const,
      title: "Document Rejected",
      description: event.rejectionReason || `${event.itemName} needs to be updated`,
      occurredAt: event.createdAt.toISOString(),
      assignmentId: event.assignmentId,
      checklistItemId: event.checklistItemId,
      fileName: event.fileName,
      rejectionReason: event.rejectionReason,
    };
  }

  return {
    type: "document_uploaded" as const,
    title: "Document Uploaded",
    description: `${event.itemName} uploaded`,
    occurredAt: event.createdAt.toISOString(),
    assignmentId: event.assignmentId,
    checklistItemId: event.checklistItemId,
    fileName: event.fileName,
    rejectionReason: null,
  };
}
