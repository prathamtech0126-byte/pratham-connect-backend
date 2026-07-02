import {
  bigserial,
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";
import { clientDocumentAssignments } from "./clientDocumentAssignment.schema";
import { clientDocumentUploads } from "./clientDocumentUpload.schema";

export const CLIENT_DOCUMENT_REVIEW_STATUSES = [
  "under_review",
  "approved",
  "rejected",
] as const;

export type ClientDocumentReviewStatus = (typeof CLIENT_DOCUMENT_REVIEW_STATUSES)[number];

export const clientDocumentItemStatuses = pgTable(
  "client_portal_checklist_item_status",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    assignmentId: bigint("assignment_id", { mode: "number" })
      .references(() => clientDocumentAssignments.id, { onDelete: "cascade" })
      .notNull(),
    checklistItemId: uuid("checklist_item_id").notNull(),
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 20 }).notNull().default("under_review"),
    latestUploadId: bigint("latest_upload_id", { mode: "number" }).references(
      () => clientDocumentUploads.id,
      { onDelete: "set null" }
    ),
    reviewedByUserId: bigint("reviewed_by_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assignmentItemUniq: uniqueIndex("uniq_client_portal_checklist_item_status").on(
      table.assignmentId,
      table.checklistItemId
    ),
    clientIdx: index("idx_client_portal_checklist_item_status_client").on(table.clientId),
    statusIdx: index("idx_client_portal_checklist_item_status_status").on(table.status),
    updatedIdx: index("idx_client_portal_checklist_item_status_updated").on(table.updatedAt),
  })
);
