import path from "path";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { clients } from "../../clients/schemas/client_convert.schema";
import { personModule } from "../../clients/schemas/person.schema";
import { clientDocumentAssignments } from "../schemas/clientDocumentAssignment.schema";
import { clientDocumentUploads } from "../schemas/clientDocumentUpload.schema";
import { clientDocumentStorageUsage } from "../schemas/clientDocumentStorageUsage.schema";
import {
  clientDocumentChecklistItems,
  clientDocumentChecklists,
  clientDocumentChecklistSections,
} from "../schemas/clientDocumentChecklist.schema";
import {
  ensureWorkdriveFolderHierarchy,
  uploadFileToWorkdrive,
} from "./clientDocumentWorkdrive.service";
import {
  getItemStatusesForAssignments,
  recordDocumentUploaded,
  resolveChecklistItemName,
} from "./clientDocumentReview.service";

const DEFAULT_CLIENT_QUOTA_BYTES = Number(
  process.env.CLIENT_STORAGE_QUOTA_BYTES?.trim() || "2147483648"
);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".zip",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
]);

const sanitizeFolderSegment = (value: string): string =>
  value
    .trim()
    .replace(/[^A-Za-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";

const normalizeFolderSegment = (value: string): string => {
  const sanitized = sanitizeFolderSegment(value);
  if (!sanitized) return sanitized;
  return sanitized.charAt(0).toUpperCase() + sanitized.slice(1).toLowerCase();
};

const sanitizeFileName = (value: string): string =>
  value
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180);

export class ClientDocumentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

type ClientIdentity = {
  fullName: string;
  clientCode: string;
};

const resolveClientIdentity = async (clientId: number): Promise<ClientIdentity> => {
  const [clientRow] = await db
    .select({
      fullName: clientInformation.fullName,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!clientRow) {
    throw new ClientDocumentError("Client not found", 404);
  }

  const [moduleClientRow] = await getDbSecond()
    .select({
      clientCode: clients.clientCode,
      fullName: personModule.fullName,
    })
    .from(clients)
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .where(eq(clients.legacyClientId, clientId))
    .limit(1);

  return {
    fullName: moduleClientRow?.fullName || clientRow.fullName,
    clientCode: moduleClientRow?.clientCode || `client-${clientId}`,
  };
};

const ensureStorageUsageRow = async (clientId: number): Promise<void> => {
  await db.execute(sql`
    INSERT INTO client_portal_storage_usage (client_id, quota_bytes, used_bytes, updated_at)
    VALUES (${clientId}, ${DEFAULT_CLIENT_QUOTA_BYTES}, 0, now())
    ON CONFLICT (client_id) DO NOTHING
  `);
};

const reserveClientStorage = async (
  clientId: number,
  fileSizeBytes: number
): Promise<{ usedBytes: number; quotaBytes: number }> => {
  const result = await db.execute(sql`
    UPDATE client_portal_storage_usage
    SET used_bytes = used_bytes + ${fileSizeBytes},
        updated_at = now()
    WHERE client_id = ${clientId}
      AND used_bytes + ${fileSizeBytes} <= quota_bytes
    RETURNING used_bytes, quota_bytes
  `);

  const row = result.rows?.[0] as
    | { used_bytes: string | number; quota_bytes: string | number }
    | undefined;
  if (!row) {
    const [usage] = await db
      .select()
      .from(clientDocumentStorageUsage)
      .where(eq(clientDocumentStorageUsage.clientId, clientId))
      .limit(1);
    throw new ClientDocumentError(
      `Client storage quota exceeded (${usage?.usedBytes ?? 0}/${usage?.quotaBytes ?? DEFAULT_CLIENT_QUOTA_BYTES} bytes used)`,
      400
    );
  }

  return {
    usedBytes: Number(row.used_bytes),
    quotaBytes: Number(row.quota_bytes),
  };
};

const releaseClientStorageReservation = async (
  clientId: number,
  fileSizeBytes: number
): Promise<void> => {
  await db.execute(sql`
    UPDATE client_portal_storage_usage
    SET used_bytes = GREATEST(0, used_bytes - ${fileSizeBytes}),
        updated_at = now()
    WHERE client_id = ${clientId}
  `);
};

export const assignChecklistToClient = async (input: {
  clientId: number;
  checklistId: string;
  visaType: string;
  country: string;
  assignedByUserId: number;
}) => {
  const visaType = normalizeFolderSegment(input.visaType);
  const country = normalizeFolderSegment(input.country);
  if (!visaType || !country) {
    throw new ClientDocumentError("visaType and country are required", 400);
  }

  const [checklist] = await getDbSecond()
    .select({
      id: clientDocumentChecklists.id,
      title: clientDocumentChecklists.title,
      isActive: clientDocumentChecklists.isActive,
    })
    .from(clientDocumentChecklists)
    .where(eq(clientDocumentChecklists.id, input.checklistId))
    .limit(1);

  if (!checklist || !checklist.isActive) {
    throw new ClientDocumentError("Checklist not found or inactive", 404);
  }

  const identity = await resolveClientIdentity(input.clientId);
  const clientFolder = sanitizeFolderSegment(`${identity.fullName}-${identity.clientCode}`);

  const workdriveFolder = await ensureWorkdriveFolderHierarchy([
    visaType,
    country,
    clientFolder,
  ]);

  await ensureStorageUsageRow(input.clientId);

  const [assignment] = await db
    .insert(clientDocumentAssignments)
    .values({
      clientId: input.clientId,
      checklistId: checklist.id,
      visaType,
      country,
      folderPath: workdriveFolder.folderPath,
      workdriveFolderId: workdriveFolder.folderId,
      assignedByUserId: input.assignedByUserId,
      status: "active",
      updatedAt: new Date(),
    })
    .returning();

  return assignment;
};

export const listChecklistAssignmentsForClient = async (clientId: number) => {
  const assignments = await db
    .select()
    .from(clientDocumentAssignments)
    .where(
      and(
        eq(clientDocumentAssignments.clientId, clientId),
        eq(clientDocumentAssignments.status, "active")
      )
    )
    .orderBy(desc(clientDocumentAssignments.assignedAt));

  if (assignments.length === 0) return [];

  const assignmentIds = assignments.map((a) => a.id);
  const checklistIds = assignments.map((a) => a.checklistId);

  const checklistRows = await getDbSecond()
    .select({
      id: clientDocumentChecklists.id,
      title: clientDocumentChecklists.title,
      slug: clientDocumentChecklists.slug,
    })
    .from(clientDocumentChecklists)
    .where(inArray(clientDocumentChecklists.id, checklistIds));

  const sections = await getDbSecond()
    .select()
    .from(clientDocumentChecklistSections)
    .where(inArray(clientDocumentChecklistSections.checklistId, checklistIds))
    .orderBy(asc(clientDocumentChecklistSections.displayOrder));

  const sectionIds = sections.map((s) => s.id);
  const items = sectionIds.length
    ? await getDbSecond()
        .select()
        .from(clientDocumentChecklistItems)
        .where(inArray(clientDocumentChecklistItems.sectionId, sectionIds))
        .orderBy(asc(clientDocumentChecklistItems.displayOrder))
    : [];

  const uploads = await db
    .select({
      id: clientDocumentUploads.id,
      assignmentId: clientDocumentUploads.assignmentId,
      checklistItemId: clientDocumentUploads.checklistItemId,
      fileName: clientDocumentUploads.fileName,
      mimeType: clientDocumentUploads.mimeType,
      sizeBytes: clientDocumentUploads.sizeBytes,
      uploadedAt: clientDocumentUploads.uploadedAt,
      workdrivePermalink: clientDocumentUploads.workdrivePermalink,
    })
    .from(clientDocumentUploads)
    .where(inArray(clientDocumentUploads.assignmentId, assignmentIds))
    .orderBy(desc(clientDocumentUploads.uploadedAt));

  const sectionsByChecklist = new Map<string, typeof sections>();
  for (const section of sections) {
    const list = sectionsByChecklist.get(section.checklistId) || [];
    list.push(section);
    sectionsByChecklist.set(section.checklistId, list);
  }

  const itemsBySection = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySection.get(item.sectionId) || [];
    list.push(item);
    itemsBySection.set(item.sectionId, list);
  }

  const uploadsByItem = new Map<string, typeof uploads>();
  for (const upload of uploads) {
    const key = `${upload.assignmentId}:${upload.checklistItemId}`;
    const list = uploadsByItem.get(key) || [];
    list.push(upload);
    uploadsByItem.set(key, list);
  }

  const checklistById = new Map(checklistRows.map((row) => [row.id, row]));
  const statusByItem = await getItemStatusesForAssignments(assignmentIds);

  return assignments.map((assignment) => {
    const checklist = checklistById.get(assignment.checklistId);
    const assignmentSections = sectionsByChecklist.get(assignment.checklistId) || [];
    return {
      ...assignment,
      checklistTitle: checklist?.title ?? null,
      checklistSlug: checklist?.slug ?? null,
      sections: assignmentSections.map((section) => ({
        ...section,
        items: (itemsBySection.get(section.id) || []).map((item) => {
          const itemUploads = uploadsByItem.get(`${assignment.id}:${item.id}`) || [];
          const statusRow = statusByItem.get(`${assignment.id}:${item.id}`);
          const reviewStatus =
            itemUploads.length === 0
              ? ("not_uploaded" as const)
              : (statusRow?.status ?? ("under_review" as const));

          return {
            ...item,
            uploads: itemUploads,
            reviewStatus,
            rejectionReason: statusRow?.rejectionReason ?? null,
            reviewedAt: statusRow?.reviewedAt ?? null,
          };
        }),
      })),
    };
  });
};

export const uploadChecklistItemDocument = async (input: {
  clientId: number;
  assignmentId: number;
  checklistItemId: string;
  file: Express.Multer.File;
  uploadedBy:
    | { type: "client"; accountId: number }
    | { type: "staff"; userId: number };
}) => {
  if (!input.file) {
    throw new ClientDocumentError("File is required", 400);
  }

  const extension = path.extname(input.file.originalname || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(input.file.mimetype)) {
    throw new ClientDocumentError(
      "Unsupported file type. Allowed: zip, pdf, docx, images, video, audio, excel",
      400
    );
  }

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

  const [itemWithChecklist] = await getDbSecond()
    .select({
      itemId: clientDocumentChecklistItems.id,
      itemName: clientDocumentChecklistItems.name,
      checklistId: clientDocumentChecklistSections.checklistId,
    })
    .from(clientDocumentChecklistItems)
    .innerJoin(
      clientDocumentChecklistSections,
      eq(clientDocumentChecklistItems.sectionId, clientDocumentChecklistSections.id)
    )
    .where(eq(clientDocumentChecklistItems.id, input.checklistItemId))
    .limit(1);

  if (!itemWithChecklist || itemWithChecklist.checklistId !== assignment.checklistId) {
    throw new ClientDocumentError("Checklist item does not belong to this assignment", 400);
  }

  await ensureStorageUsageRow(input.clientId);
  await reserveClientStorage(input.clientId, input.file.size);

  try {
    if (!assignment.workdriveFolderId) {
      throw new ClientDocumentError("Assignment folder is not configured", 500);
    }

    const uploadResult = await uploadFileToWorkdrive({
      folderId: assignment.workdriveFolderId,
      fileName: sanitizeFileName(input.file.originalname),
      mimeType: input.file.mimetype,
      buffer: input.file.buffer,
    });

    const [uploaded] = await db
      .insert(clientDocumentUploads)
      .values({
        assignmentId: assignment.id,
        checklistItemId: input.checklistItemId,
        clientId: input.clientId,
        fileName: sanitizeFileName(input.file.originalname),
        mimeType: input.file.mimetype,
        fileExtension: extension || null,
        sizeBytes: input.file.size,
        workdriveFileId: uploadResult.fileId,
        workdriveFolderId: uploadResult.folderId,
        workdrivePermalink: uploadResult.permalink,
        uploadedByAccountId:
          input.uploadedBy.type === "client" ? input.uploadedBy.accountId : null,
        uploadedByUserId:
          input.uploadedBy.type === "staff" ? input.uploadedBy.userId : null,
      })
      .returning();

    const [usage] = await db
      .select()
      .from(clientDocumentStorageUsage)
      .where(eq(clientDocumentStorageUsage.clientId, input.clientId))
      .limit(1);

    const itemName =
      itemWithChecklist.itemName || (await resolveChecklistItemName(input.checklistItemId));

    await recordDocumentUploaded({
      clientId: input.clientId,
      assignmentId: assignment.id,
      checklistItemId: input.checklistItemId,
      uploadId: uploaded.id,
      fileName: uploaded.fileName,
      itemName,
      actor: input.uploadedBy,
    });

    return {
      upload: uploaded,
      storage: usage || {
        clientId: input.clientId,
        quotaBytes: DEFAULT_CLIENT_QUOTA_BYTES,
        usedBytes: 0,
      },
    };
  } catch (error) {
    await releaseClientStorageReservation(input.clientId, input.file.size);
    throw error;
  }
};

export const getClientStorageUsage = async (clientId: number) => {
  await ensureStorageUsageRow(clientId);
  const [usage] = await db
    .select()
    .from(clientDocumentStorageUsage)
    .where(eq(clientDocumentStorageUsage.clientId, clientId))
    .limit(1);

  return usage;
};
