import {
  pgEnum,
  pgTable,
  bigserial,
  bigint,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const techSupportPriorityEnum = pgEnum("tech_support_priority_enum", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const techSupportStatusEnum = pgEnum("tech_support_status_enum", [
  "pending",
  "in_progress",
  "waiting_for_approval",
  "resolved",
]);

export const techSupportDeviceTypeEnum = pgEnum("tech_support_device_type_enum", [
  "laptop",
  "desktop",
  "mouse",
  "keyboard",
  "network-wifi",
  "printer",
  "scanner",
  "monitor",
  "webcam",
  "headset",
  "other",
]);

export const techSupportTickets = pgTable(
  "tech_support_tickets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketNo: varchar("ticket_no", { length: 30 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    counsellorId: bigint("counsellor_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),
    counsellorNameSnapshot: varchar("counsellor_name_snapshot", { length: 120 }).notNull(),
    deviceType: techSupportDeviceTypeEnum("device_type").notNull(),
    customDeviceType: varchar("custom_device_type", { length: 120 }),
    commonIssue: varchar("common_issue", { length: 255 }),
    customIssueText: text("custom_issue_text"),
    description: text("description").notNull(),
    priority: techSupportPriorityEnum("priority").notNull().default("medium"),
    status: techSupportStatusEnum("status").notNull().default("pending"),
    assignedToUserId: bigint("assigned_to_user_id", { mode: "number" }).references(() => users.id),
    attachments: jsonb("attachments")
      .$type<Array<{ name: string; url?: string; mimeType?: string }>>()
      .default([]),
    firstResponseAt: timestamp("first_response_at"),
    resolvedAt: timestamp("resolved_at"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusPriorityCreatedIdx: index("idx_ts_tickets_status_priority_created").on(
      table.status,
      table.priority,
      table.createdAt,
    ),
    counsellorCreatedIdx: index("idx_ts_tickets_counsellor_created").on(table.counsellorId, table.createdAt),
    assignedActiveIdx: index("idx_ts_tickets_assigned_active").on(table.assignedToUserId, table.isActive),
    updatedIdx: index("idx_ts_tickets_updated").on(table.updatedAt),
  }),
);

export const techSupportRequestTypeEnum = pgEnum("tech_support_request_type_enum", [
  "device_request",
  "recharge_sim_request",
]);

export const techSupportRequestStatusEnum = pgEnum("tech_support_request_status_enum", [
  "pending",
  "approved",
  "rejected",
  "in_progress",
  "waiting_for_approval",
  "completed",
]);

export const techSupportRequests = pgTable(
  "tech_support_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestNo: varchar("request_no", { length: 30 }).notNull().unique(),
    requestType: techSupportRequestTypeEnum("request_type").notNull(),
    requesterId: bigint("requester_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),
    requesterNameSnapshot: varchar("requester_name_snapshot", { length: 120 }).notNull(),
    deviceType: techSupportDeviceTypeEnum("device_type"),
    deviceRequestType: varchar("device_request_type", { length: 30 }),
    phoneNumber: varchar("phone_number", { length: 30 }),
    rechargeRequestType: varchar("recharge_request_type", { length: 30 }),
    currentRechargeExpiryDate: varchar("current_recharge_expiry_date", { length: 30 }),
    amountOrPlan: varchar("amount_or_plan", { length: 120 }),
    reason: text("reason"),
    priority: techSupportPriorityEnum("priority").notNull().default("medium"),
    attachments: jsonb("attachments")
      .$type<Array<{ name: string; url?: string; mimeType?: string }>>()
      .default([]),
    status: techSupportRequestStatusEnum("status").notNull().default("pending"),
    reviewedByUserId: bigint("reviewed_by_user_id", { mode: "number" }).references(() => users.id),
    reviewComment: text("review_comment"),
    expectedCompletionAt: timestamp("expected_completion_at"),
    reviewedAt: timestamp("reviewed_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    requesterCreatedIdx: index("idx_ts_requests_requester_created").on(table.requesterId, table.createdAt),
    statusPriorityCreatedIdx: index("idx_ts_requests_status_priority_created").on(
      table.status,
      table.priority,
      table.createdAt,
    ),
    reviewedByIdx: index("idx_ts_requests_reviewed_by").on(table.reviewedByUserId, table.updatedAt),
  }),
);

export const techSupportAssignments = pgTable(
  "tech_support_assignments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: bigint("ticket_id", { mode: "number" })
      .references(() => techSupportTickets.id, { onDelete: "cascade" })
      .notNull(),
    techUserId: bigint("tech_user_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),
    assignedByUserId: bigint("assigned_by_user_id", { mode: "number" }).references(() => users.id),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
    unassignedAt: timestamp("unassigned_at"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => ({
    techActiveIdx: index("idx_ts_assignments_tech_active").on(table.techUserId, table.isActive),
    ticketActiveIdx: index("idx_ts_assignments_ticket_active").on(table.ticketId, table.isActive),
  }),
);

export const techSupportTicketEvents = pgTable(
  "tech_support_ticket_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ticketId: bigint("ticket_id", { mode: "number" })
      .references(() => techSupportTickets.id, { onDelete: "cascade" })
      .notNull(),
    actorId: bigint("actor_id", { mode: "number" }).references(() => users.id),
    actorRole: varchar("actor_role", { length: 50 }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    fromStatus: techSupportStatusEnum("from_status"),
    toStatus: techSupportStatusEnum("to_status"),
    note: text("note"),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    ticketCreatedIdx: index("idx_ts_events_ticket_created").on(table.ticketId, table.createdAt),
    actorCreatedIdx: index("idx_ts_events_actor_created").on(table.actorId, table.createdAt),
  }),
);

