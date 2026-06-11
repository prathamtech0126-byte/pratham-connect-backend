import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";

/**
 * Represents where a client currently sits in the end-to-end visa process.
 *
 * Student Visa path (no consultancy fees):
 *   ENROLLED → DOCUMENTS_IN_PROGRESS → DOCUMENTS_SUBMITTED → VISA_FILED
 *   → VISA_RESULT_PENDING → VISA_APPROVED / VISA_REJECTED → COMPLETED
 *
 * Spouse / Visitor Visa path:
 *   ENROLLED → INITIAL_PAYMENT_PENDING → INITIAL_PAYMENT_DONE
 *   → DOCUMENTS_IN_PROGRESS → DOCUMENTS_SUBMITTED
 *   → BEFORE_VISA_PAYMENT_PENDING → BEFORE_VISA_PAYMENT_DONE
 *   → VISA_FILED → VISA_RESULT_PENDING
 *   → AFTER_VISA_PAYMENT_PENDING → AFTER_VISA_PAYMENT_DONE
 *   → VISA_APPROVED / VISA_REJECTED → COMPLETED
 */
export const journeyStageEnum = pgEnum("journey_stage_enum", [
  "ENROLLED",
  "INITIAL_PAYMENT_PENDING",
  "INITIAL_PAYMENT_DONE",
  "DOCUMENTS_IN_PROGRESS",
  "DOCUMENTS_SUBMITTED",
  "BEFORE_VISA_PAYMENT_PENDING",
  "BEFORE_VISA_PAYMENT_DONE",
  "VISA_FILED",
  "VISA_RESULT_PENDING",
  "AFTER_VISA_PAYMENT_PENDING",
  "AFTER_VISA_PAYMENT_DONE",
  "VISA_APPROVED",
  "VISA_REJECTED",
  "COMPLETED",
  "ON_HOLD",
]);

export const visaResultEnum = pgEnum("visa_result_enum", [
  "APPROVED",
  "REJECTED",
  "PENDING",
]);

/**
 * One row per client — represents the current state of the client's journey.
 * Full history lives in client_journey_events.
 */
export const clientJourney = pgTable(
  "client_journey",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** One journey per client */
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    currentStage: journeyStageEnum("current_stage")
      .notNull()
      .default("ENROLLED"),

    /** Set once the embassy decision is received */
    visaResult: visaResultEnum("visa_result"),

    /** Expected date of final visa outcome or service completion */
    targetCompletionDate: date("target_completion_date"),

    /** Timestamp the client's journey was marked as complete */
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Timestamp the current stage was set */
    stageUpdatedAt: timestamp("stage_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** Main CRM users.id — staff who last updated the stage (cross-DB, no FK) */
    stageUpdatedBy: bigint("stage_updated_by", { mode: "number" }).notNull(),

    /** Optional free-text notes about the current stage */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    /** Enforces exactly one journey per client */
    uniqClientId: uniqueIndex("uniq_client_journey_client_id").on(table.clientId),

    currentStageIdx:    index("idx_client_journey_current_stage").on(table.currentStage),
    visaResultIdx:      index("idx_client_journey_visa_result").on(table.visaResult),
    stageUpdatedAtIdx:  index("idx_client_journey_stage_updated_at").on(table.stageUpdatedAt),
    createdAtIdx:       index("idx_client_journey_created_at").on(table.createdAt),
  })
);

/**
 * Immutable audit log of every stage transition for a client.
 * Never updated — only inserted.
 */
export const clientJourneyEvents = pgTable(
  "client_journey_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    fromStage: journeyStageEnum("from_stage"),

    toStage: journeyStageEnum("to_stage").notNull(),

    /** Main CRM users.id — who triggered this transition (cross-DB, no FK) */
    changedBy: bigint("changed_by", { mode: "number" }).notNull(),

    /** Optional context note recorded at the time of transition */
    notes: text("notes"),

    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx:   index("idx_client_journey_events_client_id").on(table.clientId),
    toStageIdx:    index("idx_client_journey_events_to_stage").on(table.toStage),
    changedAtIdx:  index("idx_client_journey_events_changed_at").on(table.changedAt),
    changedByIdx:  index("idx_client_journey_events_changed_by").on(table.changedBy),
  })
);
