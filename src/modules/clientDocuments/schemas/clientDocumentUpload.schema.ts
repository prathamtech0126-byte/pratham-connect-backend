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

export const clientDocumentUploads = pgTable(
  "client_portal_checklist_uploads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    assignmentId: bigint("assignment_id", { mode: "number" })
      .references(() => clientDocumentAssignments.id, { onDelete: "cascade" })
      .notNull(),
    checklistItemId: uuid("checklist_item_id").notNull(),
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    fileExtension: varchar("file_extension", { length: 20 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    workdriveFileId: varchar("workdrive_file_id", { length: 150 }).notNull(),
    workdriveFolderId: varchar("workdrive_folder_id", { length: 150 }),
    workdrivePermalink: text("workdrive_permalink"),
    uploadedByAccountId: bigint("uploaded_by_account_id", { mode: "number" }).references(
      () => clientPortalAccounts.id,
      { onDelete: "set null" }
    ),
    uploadedByUserId: bigint("uploaded_by_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assignmentIdx: index("idx_client_portal_checklist_uploads_assignment").on(
      table.assignmentId
    ),
    checklistItemIdx: index("idx_client_portal_checklist_uploads_item").on(
      table.checklistItemId
    ),
    clientIdx: index("idx_client_portal_checklist_uploads_client").on(table.clientId),
    uploadedAtIdx: index("idx_client_portal_checklist_uploads_uploaded_at").on(
      table.uploadedAt
    ),
  })
);
