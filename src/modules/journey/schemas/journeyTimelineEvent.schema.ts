import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "../../clients/schemas/client_convert.schema";
import { visaCases } from "../../visaCase/schemas/visaCase.schema";

/**
 * Events that do NOT have a natural home in visa_case_assignments or
 * visa_case_status_events. This fills the gaps:
 *   - Lead converted to client         (LEAD phase)
 *   - Client enrolled in modules DB    (ENROLLMENT phase)
 *   - Visa case created                (ENROLLMENT phase)
 *   - Payment milestone received       (ENROLLMENT phase)
 *   - Visa decision recorded           (DECISION phase)
 *   - Free-text note by staff          (any phase)
 *
 * visa_case_assignments  → covers team handoffs (admin→cx, cx→binding, etc.)
 * visa_case_status_events → covers processing stage/sub-status changes
 * journey_timeline_events → everything else
 */
export const journeyEventTypeEnum = pgEnum("journey_event_type_enum", [
  "LEAD_CONVERTED",
  "CLIENT_ENROLLED",
  "CLIENT_TRANSFERRED",
  "VISA_CASE_CREATED",
  "PAYMENT_MILESTONE",
  "TEAM_ROUTED",
  "VISA_DECISION",
  "NOTE_ADDED",
]);

export const journeyPhaseEnum = pgEnum("journey_phase_enum", [
  "LEAD",
  "ENROLLMENT",
  "ASSIGNMENT",
  "PROCESSING",
  "DECISION",
]);

/** Append-only event log for notable journey milestones. Never updated, only inserted. */
export const journeyTimelineEvents = pgTable(
  "journey_timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The client this event belongs to */
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),

    /** Set for post-enrollment events tied to a specific visa case */
    visaCaseId: uuid("visa_case_id").references(() => visaCases.id),

    eventType: journeyEventTypeEnum("event_type").notNull(),

    /** Broad phase for grouping in the UI timeline */
    phase: journeyPhaseEnum("phase").notNull(),

    /** Short human-readable label shown in the timeline */
    title: varchar("title", { length: 200 }).notNull(),

    /** Optional supporting detail */
    description: text("description"),

    /** Main CRM users.id — cross-DB, no FK */
    actorId: bigint("actor_id", { mode: "number" }),

    /** Denormalized for offline / cross-DB display */
    actorName: varchar("actor_name", { length: 100 }),
    actorRole: varchar("actor_role", { length: 50 }),

    /** Flexible payload: leadId, saleTypeId, amount, etc. */
    metadata: jsonb("metadata"),

    /** When the real-world event happened (may differ from created_at for backfills) */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientIdIdx: index("idx_journey_tl_events_client_id").on(table.clientId),
    visaCaseIdIdx: index("idx_journey_tl_events_visa_case_id").on(table.visaCaseId),
    eventTypeIdx: index("idx_journey_tl_events_event_type").on(table.eventType),
    phaseIdx: index("idx_journey_tl_events_phase").on(table.phase),
    occurredAtIdx: index("idx_journey_tl_events_occurred_at").on(table.occurredAt),
  })
);
