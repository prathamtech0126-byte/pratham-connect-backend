import {
  AnyPgColumn,
  bigserial,
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "../../schemas/users.schema";
import { leadReferences } from "./leadReferences.schema";

export const assignmentStatusEnum = pgEnum("lead_assignment_status_enum", [
  "not_assigned",
  "assigned",
  "transferred",
  "converted",
  "dropped",
]);

export const progressStatusEnum = pgEnum("lead_progress_status_enum", [
  "not_contacted",
  "contacted",
  "follow_up",
  "converted",
  "junk",
]);

export const eligibilityStatusEnum = pgEnum("lead_eligibility_status_enum", [
  "eligible",
  "not_eligible",
  "future_prospect",
]);

export const leadQualityEnum = pgEnum("lead_quality_enum", [
  "excellent",
  "good",
  "average",
  "bad",
]);

export const leads = pgTable(
  "leads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    externalLeadId: varchar("external_lead_id", { length: 100 }).unique(),

    createdAt: timestamp("created_at").default(sql`(now() at time zone 'Asia/Kolkata')`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`(now() at time zone 'Asia/Kolkata')`).notNull(),

    fullName: varchar("full_name", { length: 150 }).notNull(),
    phone: varchar("phone", { length: 30 }).notNull(),
    whatsapp: varchar("whatsapp", { length: 30 }),
    email: varchar("email", { length: 150 }),
    city: varchar("city", { length: 100 }),

    currentTelecallerId: bigint("current_telecaller_id", { mode: "number" }).references(
      (): AnyPgColumn => users.id
    ),

    currentCounsellorId: bigint("current_counsellor_id", { mode: "number" }).references(
      (): AnyPgColumn => users.id
    ),

    assignedBy: bigint("assigned_by", { mode: "number" }).references(
      (): AnyPgColumn => users.id
    ),

    leadType: varchar("lead_type", { length: 100 }),

    assignmentStatus: assignmentStatusEnum("assignment_status")
      .default("not_assigned")
      .notNull(),

    progressStatus: progressStatusEnum("progress_status")
      .default("not_contacted")
      .notNull(),

    eligibilityStatus: eligibilityStatusEnum("eligibility_status"),

    leadQuality: leadQualityEnum("lead_quality"),

    leadSource: varchar("lead_source", { length: 100 }),

    /** FK to lead_references when lead source requires a referral selection. */
    referenceId: bigint("reference_id", { mode: "number" }).references(
      (): AnyPgColumn => leadReferences.id
    ),

    latestNote: text("latest_note"),
    dropReason: text("drop_reason"),

    nextFollowupAt: timestamp("next_followup_at"),
    /** When telecaller (or admin) transferred lead to counsellor/manager; updated on re-transfer. */
    transferredAt: timestamp("transferred_at"),
    convertedAt: timestamp("converted_at"),
    /** When counsellor/telecaller dropped the lead after handoff. */
    droppedAt: timestamp("dropped_at"),

    isJunk: boolean("is_junk").default(false).notNull(),

    isVerified: boolean("is_verified").default(false).notNull(),
    verifiedAt: timestamp("verified_at"),
    verifiedByFrontDeskId: bigint("verified_by_front_desk_id", { mode: "number" }).references(
      (): AnyPgColumn => users.id
    ),
  },

  (table) => ({
    phoneIdx: index("idx_leads_phone").on(table.phone),

    assignmentStatusIdx: index("idx_leads_assignment_status").on(
      table.assignmentStatus
    ),

    progressStatusIdx: index("idx_leads_progress_status").on(
      table.progressStatus
    ),

    eligibilityIdx: index("idx_leads_eligibility_status").on(
      table.eligibilityStatus
    ),

    qualityIdx: index("idx_leads_lead_quality").on(table.leadQuality),

    currentTelecallerIdx: index("idx_leads_current_telecaller").on(
      table.currentTelecallerId
    ),

    currentCounsellorIdx: index("idx_leads_current_counsellor").on(
      table.currentCounsellorId
    ),

    nextFollowupIdx: index("idx_leads_next_followup_at").on(
      table.nextFollowupAt
    ),

    createdAtIdx: index("idx_leads_created_at").on(table.createdAt),

    transferredAtIdx: index("idx_leads_transferred_at").on(table.transferredAt),
    droppedAtIdx: index("idx_leads_dropped_at").on(table.droppedAt),
  })
);