import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import {
  visaAssignedTeamEnum,
  visaCases,
  visaProcessingStageEnum,
  visaProcessingSubStatusEnum,
} from "./visaCase.schema";

export const visaDocumentRequestStatusEnum = pgEnum(
  "visa_document_request_status_enum",
  ["OPEN", "FULFILLED", "CANCELLED"]
);

/**
 * Client-wise pending document requests raised by ops teams and fulfilled by CX.
 */
export const visaCaseDocumentRequests = pgTable(
  "visa_case_document_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visaCaseId: uuid("visa_case_id")
      .references(() => visaCases.id)
      .notNull(),

    clientId: uuid("client_id").references(() => clients.id),
    personLabel: varchar("person_label", { length: 150 }).notNull(),
    documentType: varchar("document_type", { length: 120 }).notNull(),
    notes: text("notes"),

    requestStatus: visaDocumentRequestStatusEnum("request_status")
      .notNull()
      .default("OPEN"),

    raisedBy: bigint("raised_by", { mode: "number" }).notNull(),
    raisedByRole: varchar("raised_by_role", { length: 50 }),
    targetTeam: visaAssignedTeamEnum("target_team").notNull().default("cx"),

    sourceStage: visaProcessingStageEnum("source_stage").notNull(),
    sourceSubStatus: visaProcessingSubStatusEnum("source_sub_status").notNull(),
    sourceTeam: visaAssignedTeamEnum("source_team").notNull(),

    fulfilledBy: bigint("fulfilled_by", { mode: "number" }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    fulfilmentNotes: text("fulfilment_notes"),

    cancelledBy: bigint("cancelled_by", { mode: "number" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    visaCaseIdIdx: index("idx_visa_doc_requests_visa_case_id").on(table.visaCaseId),
    statusIdx: index("idx_visa_doc_requests_status").on(table.requestStatus),
    clientIdIdx: index("idx_visa_doc_requests_client_id").on(table.clientId),
    createdAtIdx: index("idx_visa_doc_requests_created_at").on(table.createdAt),
  })
);
