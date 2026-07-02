import {
  bigserial,
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";
import { clientPortalAccounts } from "../../clientPortal/schemas/clientPortalAccount.schema";
import { clientDocumentAssignments } from "./clientDocumentAssignment.schema";
import { clientDocumentUploads } from "./clientDocumentUpload.schema";

export const CLIENT_DOCUMENT_REVIEW_EVENT_TYPES = [
  "uploaded",
  "approved",
  "rejected",
] as const;

export type ClientDocumentReviewEventType =
  (typeof CLIENT_DOCUMENT_REVIEW_EVENT_TYPES)[number];

export const clientDocumentReviewEvents = pgTable(
  "client_portal_document_review_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),
    assignmentId: bigint("assignment_id", { mode: "number" })
      .references(() => clientDocumentAssignments.id, { onDelete: "cascade" })
      .notNull(),
    checklistItemId: uuid("checklist_item_id").notNull(),
    uploadId: bigint("upload_id", { mode: "number" }).references(
      () => clientDocumentUploads.id,
      { onDelete: "set null" }
    ),
    eventType: varchar("event_type", { length: 20 }).notNull(),
    itemName: varchar("item_name", { length: 255 }).notNull(),
    fileName: varchar("file_name", { length: 255 }),
    rejectionReason: text("rejection_reason"),
    actorType: varchar("actor_type", { length: 10 }).notNull(),
    actorAccountId: bigint("actor_account_id", { mode: "number" }).references(
      () => clientPortalAccounts.id,
      { onDelete: "set null" }
    ),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    clientIdx: index("idx_client_portal_document_review_events_client").on(table.clientId),
    assignmentIdx: index("idx_client_portal_document_review_events_assignment").on(
      table.assignmentId
    ),
    createdIdx: index("idx_client_portal_document_review_events_created").on(table.createdAt),
    eventTypeIdx: index("idx_client_portal_document_review_events_type").on(table.eventType),
  })
);
