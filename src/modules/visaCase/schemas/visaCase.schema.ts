import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { countries } from "../../countries/schemas/countries.schema";
import { sales } from "../../sales/schemas/sale.schema";

export const reasonOfTravelEnum = pgEnum("reason_of_travel_enum", [
  "TOURISM",
  "FAMILY_VISIT",
  "BUSINESS_VISIT",
  "CONVOCATION",
  "WEDDING",
  "MEDICAL",
  "OTHER",
]);

export const sponsorRelationshipEnum = pgEnum("sponsor_relationship_enum", [
  "SON",
  "DAUGHTER",
  "BROTHER",
  "SISTER",
  "FRIEND",
  "SELF_SPONSORED",
]);

export const visaProcessingStageEnum = pgEnum("visa_processing_stage_enum", [
  "DOCUMENTATION",
  "FINANCIAL_ASSESSMENT",
  "CASE_PREPARATION",
  "FILING_PREPARATION",
  "SUBMISSION",
  "DECISION",
  "REFILING",
  "ON_HOLD",
  "CLIENT_DROP",
]);

export const visaProcessingSubStatusEnum = pgEnum(
  "visa_processing_sub_status_enum",
  [
    "CHECKLIST_SHARED",
    "PARTIALLY_RECEIVED",
    "FULLY_RECEIVED",
    "ADDITIONAL_DOCUMENTS_REQUESTED",
    "REVIEW_PENDING",
    "UNDER_REVIEW",
    "FINANCIAL_APPROVED",
    "DOCUMENTS_PENDING",
    "PROFILE_ASSESSMENT_COMPLETED",
    "SOP_COVER_LETTER_UNDER_PREPARATION",
    "SOP_COVER_LETTER_REVIEW",
    "SOP_APPROVED_BY_CLIENT",
    "APPLICATION_FORM_FILLING",
    "APPLICATION_REVIEW_PENDING",
    "READY_TO_FILE",
    "FILE_SUBMITTED",
    "DECISION_PENDING",
    "DECISION_APPROVED",
    "DECISION_REFUSED",
    "DECISION_WITHDRAWN",
    "REFUSAL_ANALYSIS",
    "REVISED_SOP_LOE_PREPARATION",
    "READY_TO_REFILE",
    "REFILED",
    "AWAITING_DOCUMENTS",
    "AWAITING_FUNDS",
    "CLIENT_REQUESTED_PAUSE",
    "VOLUNTARY_WITHDRAWAL",
    "REFUND_PROCESSED",
    "LOST_CONTACT",
  ]
);

export const visaAssignedTeamEnum = pgEnum("visa_assigned_team_enum", [
  "none",
  "cx",
  "binding",
  "application",
]);

export const visaDecisionEnum = pgEnum("visa_decision_enum", [
  "PENDING",
  "APPROVED",
  "REFUSED",
  "WITHDRAWN",
]);

/**
 * One visa case per sale engagement (client + sale type).
 * Ops fields live here; financials are computed from payment_balances / amounts.
 */
export const visaCases = pgTable(
  "visa_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    saleId: uuid("sale_id")
      .references(() => sales.id)
      .notNull(),

    /** Main CRM users.id — cross-DB, no FK */
    userId: bigint("user_id", { mode: "number" }).notNull(),

    assignedTeam: visaAssignedTeamEnum("assigned_team")
      .notNull()
      .default("cx"),

    assignedUserId: bigint("assigned_user_id", { mode: "number" }),

    reasonOfTravel: reasonOfTravelEnum("reason_of_travel"),
    destinationCountryId: uuid("destination_country_id").references(
      () => countries.id
    ),

    sponsorRelationship: sponsorRelationshipEnum("sponsor_relationship"),
    accompanyingMembersCount: integer("accompanying_members_count")
      .notNull()
      .default(0),

    currentStage: visaProcessingStageEnum("current_stage")
      .notNull()
      .default("DOCUMENTATION"),

    currentSubStatus: visaProcessingSubStatusEnum("current_sub_status")
      .notNull()
      .default("CHECKLIST_SHARED"),

    submissionDate: date("submission_date"),
    decision: visaDecisionEnum("decision").notNull().default("PENDING"),
    decisionDate: date("decision_date"),
    remarks: text("remarks"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniqSaleId: uniqueIndex("uniq_visa_cases_sale_id").on(table.saleId),
    clientIdIdx: index("idx_visa_cases_client_id").on(table.clientId),
    userIdIdx: index("idx_visa_cases_user_id").on(table.userId),
    assignedTeamIdx: index("idx_visa_cases_assigned_team").on(table.assignedTeam),
    assignedUserIdIdx: index("idx_visa_cases_assigned_user_id").on(
      table.assignedUserId
    ),
    assignedUserTeamIdx: index("idx_visa_cases_assigned_user_team").on(
      table.assignedUserId,
      table.assignedTeam
    ),
    currentStageIdx: index("idx_visa_cases_current_stage").on(table.currentStage),
    decisionIdx: index("idx_visa_cases_decision").on(table.decision),
    destinationCountryIdx: index("idx_visa_cases_destination_country_id").on(
      table.destinationCountryId
    ),
    createdAtIdx: index("idx_visa_cases_created_at").on(table.createdAt),
  })
);
