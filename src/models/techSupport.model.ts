import path from "path";
import fs from "fs";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import {
  techSupportAssignments,
  techSupportDeviceTypeEnum,
  techSupportPriorityEnum,
  techSupportRequests,
  techSupportRequestStatusEnum,
  techSupportRequestTypeEnum,
  techSupportStatusEnum,
  techSupportTicketEvents,
  techSupportTickets,
} from "../schemas/techSupport.schema";
import { users } from "../schemas/users.schema";
import { emitTechSupportEvent } from "../services/techSupport.service";
import { emitToCounsellor } from "../config/socket";

// Helper to delete ticket images from disk
const deleteTicketImagesFromDisk = (imagePaths: string[]) => {
  imagePaths.forEach((imagePath) => {
    try {
      let relativePath = imagePath;

      try {
        const parsedUrl = new URL(imagePath);
        relativePath = parsedUrl.pathname;
      } catch {
        // ignore invalid URL values and treat as relative path
      }

      relativePath = relativePath.replace(/^\//, "");
      if (!relativePath.startsWith("uploads/")) {
        relativePath = `uploads/${relativePath}`;
      }

      const fullPath = path.join(process.cwd(), relativePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Upload] Deleted image on resolve: ${fullPath}`);
      }
    } catch (err) {
      console.error(`[Upload] Failed to delete image on resolve: ${imagePath}`, err);
    }
  });
};

export type TechSupportPriority = (typeof techSupportPriorityEnum.enumValues)[number];
export type TechSupportStatus = (typeof techSupportStatusEnum.enumValues)[number];
export type TechSupportDeviceType = (typeof techSupportDeviceTypeEnum.enumValues)[number];
export type TechSupportRequestType = (typeof techSupportRequestTypeEnum.enumValues)[number];
export type TechSupportRequestStatus = (typeof techSupportRequestStatusEnum.enumValues)[number];

export interface CreateTechSupportTicketInput {
  deviceType: TechSupportDeviceType;
  issueCategory: string;
  customDeviceType?: string;
  description: string;
  priority: TechSupportPriority;
  attachments?: Array<{ name: string; url?: string; mimeType?: string }>;
}

export interface CreateTechSupportRequestInput {
  requestType: TechSupportRequestType;
  deviceType?: TechSupportDeviceType;
  deviceRequestType?: string;
  phoneNumber?: string;
  rechargeRequestType?: string;
  currentRechargeExpiryDate?: string;
  amountOrPlan?: string;
  reason: string;
  priority: TechSupportPriority;
  attachments?: Array<{ name: string; url?: string; mimeType?: string }>;
}

export const createTicketNo = async () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `TS-${y}${m}${d}`;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(techSupportTickets)
    .where(like(techSupportTickets.ticketNo, `${prefix}%`));

  return `${prefix}-${String((count || 0) + 1).padStart(4, "0")}`;
};

export const createTechSupportTicket = async (
  input: CreateTechSupportTicketInput,
  counsellor: { id: number; fullName: string; role: string },
) => {
  const ticketNo = await createTicketNo();
  const now = new Date();
  const derivedTitle = `${input.deviceType.toUpperCase()} - ${input.issueCategory}`;

  const [ticket] = await db
    .insert(techSupportTickets)
    .values({
      ticketNo,
      title: derivedTitle,
      counsellorId: counsellor.id,
      counsellorNameSnapshot: counsellor.fullName,
      deviceType: input.deviceType,
      customDeviceType: input.customDeviceType?.trim() || null,
      commonIssue: input.issueCategory?.trim() || null,
      customIssueText: null,
      description: input.description.trim(),
      priority: input.priority,
      status: "pending",
      attachments: input.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(techSupportTicketEvents).values({
    ticketId: ticket.id,
    actorId: counsellor.id,
    actorRole: counsellor.role,
    eventType: "created",
    toStatus: "pending",
    meta: {},
  });

  return ticket;
};

export const createRequestNo = async () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `REQ-${y}${m}${d}`;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(techSupportRequests)
    .where(like(techSupportRequests.requestNo, `${prefix}%`));

  return `${prefix}-${String((count || 0) + 1).padStart(4, "0")}`;
};

export const createTechSupportRequest = async (
  input: CreateTechSupportRequestInput,
  requester: { id: number; fullName: string },
) => {
  const now = new Date();
  const requestNo = await createRequestNo();
  const [row] = await db
    .insert(techSupportRequests)
    .values({
      requestNo,
      requestType: input.requestType,
      requesterId: requester.id,
      requesterNameSnapshot: requester.fullName,
      deviceType: input.deviceType ?? null,
      deviceRequestType: input.deviceRequestType ?? null,
      phoneNumber: input.phoneNumber ?? null,
      rechargeRequestType: input.rechargeRequestType ?? null,
      currentRechargeExpiryDate: input.currentRechargeExpiryDate ?? null,
      amountOrPlan: input.amountOrPlan ?? null,
      reason: input.reason.trim(),
      priority: input.priority,
      attachments: input.attachments ?? [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
};

export const getMyTechSupportRequests = async (requesterId: number) => {
  return db
    .select()
    .from(techSupportRequests)
    .where(eq(techSupportRequests.requesterId, requesterId))
    .orderBy(desc(techSupportRequests.createdAt));
};

export const getAllTechSupportRequests = async (startDate?: string, endDate?: string) => {
  let query = db.select().from(techSupportRequests);
  const conditions = [];
  if (startDate && endDate) {
    conditions.push(sql`${techSupportRequests.createdAt} >= ${new Date(startDate)} AND ${techSupportRequests.createdAt} <= ${new Date(endDate)}`);
  }
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }
  return query.orderBy(desc(techSupportRequests.createdAt));
};

export const getTechSupportRequestById = async (requestId: number) => {
  const [row] = await db
    .select()
    .from(techSupportRequests)
    .where(eq(techSupportRequests.id, requestId))
    .limit(1);
  return row || null;
};

export const updateTechSupportRequestReview = async (
  requestId: number,
  payload: {
    status: TechSupportRequestStatus;
    reviewComment?: string;
    expectedCompletionAt?: Date | null;
    reviewedByUserId: number;
  },
) => {
  const [existing] = await db
    .select()
    .from(techSupportRequests)
    .where(eq(techSupportRequests.id, requestId))
    .limit(1);

  if (!existing) return null;
  if (payload.status === "completed" && existing.status !== "waiting_for_approval") {
    throw new Error("Request can be completed only after counsellor approval");
  }

  const [row] = await db
    .update(techSupportRequests)
    .set({
      status: payload.status,
      reviewComment: payload.reviewComment ?? null,
      expectedCompletionAt: payload.expectedCompletionAt ?? null,
      reviewedByUserId: payload.reviewedByUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
      ...(payload.status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(eq(techSupportRequests.id, requestId))
    .returning();

  if (row) {
    emitTechSupportEvent("techSupport:requestUpdated", {
      requestId: row.id,
      status: row.status,
    });
    emitToCounsellor(row.requesterId, "techSupport:requestUpdated", {
      requestId: row.id,
      requesterId: row.requesterId,
      status: row.status,
    });
  }

  return row || null;
};

export const getMyTechSupportTickets = async (counsellorId: number) => {
  return db
    .select()
    .from(techSupportTickets)
    .where(and(eq(techSupportTickets.counsellorId, counsellorId), eq(techSupportTickets.isActive, true)))
    .orderBy(desc(techSupportTickets.createdAt));
};

export const getTicketById = async (ticketId: number) => {
  const [ticket] = await db
    .select()
    .from(techSupportTickets)
    .where(eq(techSupportTickets.id, ticketId))
    .limit(1);
  return ticket || null;
};

export const getBoardTickets = async (startDate?: string, endDate?: string) => {
  let query = db
    .select({
      id: techSupportTickets.id,
      ticketNo: techSupportTickets.ticketNo,
      title: techSupportTickets.title,
      counsellorId: techSupportTickets.counsellorId,
      counsellorNameSnapshot: techSupportTickets.counsellorNameSnapshot,
      deviceType: techSupportTickets.deviceType,
      commonIssue: techSupportTickets.commonIssue,
      customIssueText: techSupportTickets.customIssueText,
      description: techSupportTickets.description,
      priority: techSupportTickets.priority,
      status: techSupportTickets.status,
      assignedToUserId: techSupportTickets.assignedToUserId,
      assignedToName: users.fullName,
      createdAt: techSupportTickets.createdAt,
      updatedAt: techSupportTickets.updatedAt,
      firstResponseAt: techSupportTickets.firstResponseAt,
      resolvedAt: techSupportTickets.resolvedAt,
      attachments: techSupportTickets.attachments,
    })
    .from(techSupportTickets)
    .leftJoin(users, eq(techSupportTickets.assignedToUserId, users.id));

  const conditions = [eq(techSupportTickets.isActive, true)];
  if (startDate && endDate) {
    conditions.push(sql`${techSupportTickets.createdAt} >= ${new Date(startDate)} AND ${techSupportTickets.createdAt} <= ${new Date(endDate)}`);
  }

  return query.where(and(...conditions)).orderBy(desc(techSupportTickets.updatedAt));
};

export const updateTicketStatus = async (ticketId: number, status: TechSupportStatus) => {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(techSupportTickets)
    .where(eq(techSupportTickets.id, ticketId))
    .limit(1);

  if (!existing) return null;
  if (status === "resolved" && existing.status !== "waiting_for_approval") {
    throw new Error("Ticket can be resolved only after counsellor approval");
  }

  const [updated] = await db
    .update(techSupportTickets)
    .set({
      status,
      firstResponseAt:
        status === "in_progress"
          ? (existing.firstResponseAt ?? now)
          : existing.firstResponseAt,
      resolvedAt: status === "resolved" ? now : existing.resolvedAt,
      updatedAt: now,
    })
    .where(eq(techSupportTickets.id, ticketId))
    .returning();

  // 🔥 ADD THIS BLOCK
  if (updated) {
    emitTechSupportEvent("techSupport:ticketMoved", {
      ticketId,
      fromStatus: existing.status,
      toStatus: updated.status,
    });

    emitToCounsellor(updated.counsellorId, "techSupport:ticketMoved", {
      ticketId,
      counsellorId: updated.counsellorId,
      fromStatus: existing.status,
      toStatus: updated.status,
      status: updated.status,
    });

    // Delete images when ticket is resolved
    if (status === "resolved") {
      const attachments = (existing.attachments as any[]) || [];
      const imageUrls = attachments
        .filter((att) => att.url && att.mimeType?.startsWith("image/"))
        .map((att) => att.url);
      if (imageUrls.length > 0) {
        deleteTicketImagesFromDisk(imageUrls);
        // Clear attachments from DB
        await db
          .update(techSupportTickets)
          .set({ attachments: [] })
          .where(eq(techSupportTickets.id, ticketId));
      }
    }
  }

  return { existing, updated };
};

export const claimTicket = async (ticketId: number, techUserId: number, actorId: number) => {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(techSupportTickets)
    .where(eq(techSupportTickets.id, ticketId))
    .limit(1);

  if (!existing) return null;

  await db
    .update(techSupportAssignments)
    .set({ isActive: false, unassignedAt: now })
    .where(and(eq(techSupportAssignments.ticketId, ticketId), eq(techSupportAssignments.isActive, true)));

  await db.insert(techSupportAssignments).values({
    ticketId,
    techUserId,
    assignedByUserId: actorId,
    assignedAt: now,
    isActive: true,
  });

  const [updated] = await db
    .update(techSupportTickets)
    .set({
      assignedToUserId: techUserId,
      status: "in_progress",
      firstResponseAt: existing.firstResponseAt ?? now,
      updatedAt: now,
    })
    .where(eq(techSupportTickets.id, ticketId))
    .returning();

  if (updated) {
    emitTechSupportEvent("techSupport:ticketAssigned", {
      ticketId,
      assignedToUserId: techUserId,
      status: updated.status,
    });
    emitToCounsellor(updated.counsellorId, "techSupport:ticketAssigned", {
      ticketId,
      counsellorId: updated.counsellorId,
      status: updated.status,
    });
  }

  return { existing, updated };
};

export const addTicketEvent = async (data: {
  ticketId: number;
  actorId?: number;
  actorRole?: string;
  eventType: string;
  fromStatus?: TechSupportStatus;
  toStatus?: TechSupportStatus;
  note?: string;
  meta?: Record<string, unknown>;
}) => {
  await db.insert(techSupportTicketEvents).values({
    ticketId: data.ticketId,
    actorId: data.actorId ?? null,
    actorRole: data.actorRole ?? null,
    eventType: data.eventType,
    fromStatus: data.fromStatus ?? null,
    toStatus: data.toStatus ?? null,
    note: data.note ?? null,
    meta: data.meta ?? {},
  });
};

export const getTicketTimeline = async (ticketId: number) => {
  return db
    .select()
    .from(techSupportTicketEvents)
    .where(eq(techSupportTicketEvents.ticketId, ticketId))
    .orderBy(desc(techSupportTicketEvents.createdAt));
};

export const getTicketDetailsWithTimeline = async (ticketId: number) => {
  const [ticket] = await db
    .select({
      ticket: techSupportTickets,
      assignedToName: users.fullName,
    })
    .from(techSupportTickets)
    .leftJoin(users, eq(techSupportTickets.assignedToUserId, users.id))
    .where(eq(techSupportTickets.id, ticketId))
    .limit(1);

  if (!ticket) return null;

  const timeline = await getTicketTimeline(ticketId);
  return { ...ticket, timeline };
};

export const getTicketsByIds = async (ticketIds: number[]) => {
  if (!ticketIds.length) return [];
  return db.select().from(techSupportTickets).where(inArray(techSupportTickets.id, ticketIds));
};

