import {
  bigserial,
  bigint,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";

export const clientDocumentAssignments = pgTable(
  "client_portal_checklist_assignments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),
    checklistId: uuid("checklist_id").notNull(),
    visaType: varchar("visa_type", { length: 50 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    folderPath: varchar("folder_path", { length: 350 }).notNull(),
    workdriveFolderId: varchar("workdrive_folder_id", { length: 150 }),
    assignedByUserId: bigint("assigned_by_user_id", { mode: "number" }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdx: index("idx_client_portal_checklist_assignments_client").on(table.clientId),
    checklistIdx: index("idx_client_portal_checklist_assignments_checklist").on(
      table.checklistId
    ),
    statusIdx: index("idx_client_portal_checklist_assignments_status").on(table.status),
    assignedAtIdx: index("idx_client_portal_checklist_assignments_assigned_at").on(
      table.assignedAt
    ),
  })
);
