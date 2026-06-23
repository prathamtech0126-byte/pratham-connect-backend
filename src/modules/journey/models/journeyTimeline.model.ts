import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import { invalidateModulesCachesOnWrite } from "../../cache/invalidate";

// ─── Raw row shapes from modules DB ──────────────────────────────────────────

export interface RawJourneyTimelineEvent {
  id: string;
  client_id: string;
  visa_case_id: string | null;
  event_type: string;
  phase: string;
  title: string;
  description: string | null;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: Date;
}

export interface RawAssignmentEvent {
  id: string;
  visa_case_id: string;
  assigned_team: string;
  assigned_user_id: number;
  previous_user_id: number | null;
  previous_team: string | null;
  assigned_by: number;
  assigned_by_role: string | null;
  assignment_type: string;
  notes: string | null;
  occurred_at: Date;
}

export interface RawStatusEvent {
  id: string;
  visa_case_id: string;
  from_stage: string | null;
  to_stage: string | null;
  from_sub_status: string | null;
  to_sub_status: string;
  changed_by: number;
  changed_by_role: string | null;
  notes: string | null;
  occurred_at: Date;
}

export interface RawClientTransferEvent {
  id: string;
  client_id: string;
  from_user_id: number | null;
  to_user_id: number | null;
  transferred_by: number | null;
  occurred_at: Date;
}

// ─── Journey timeline events ──────────────────────────────────────────────────

export async function getJourneyTimelineEventsForClient(
  clientId: string
): Promise<RawJourneyTimelineEvent[]> {
  const { rows } = await getPoolSecond().query<RawJourneyTimelineEvent>(
    `SELECT id, client_id, visa_case_id, event_type, phase,
            title, description, actor_id, actor_name, actor_role,
            metadata, occurred_at
       FROM journey_timeline_events
      WHERE client_id = $1::uuid
      ORDER BY occurred_at ASC`,
    [clientId]
  );
  return rows;
}

export interface InsertJourneyEventInput {
  clientId: string;
  visaCaseId?: string | null;
  eventType: string;
  phase: string;
  title: string;
  description?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date | null;
}

export async function insertJourneyTimelineEvent(
  event: InsertJourneyEventInput
): Promise<void> {
  await getPoolSecond().query(
    `INSERT INTO journey_timeline_events (
       client_id, visa_case_id, event_type, phase,
       title, description, actor_id, actor_name, actor_role,
       metadata, occurred_at
     ) VALUES (
       $1::uuid, $2::uuid,
       $3::journey_event_type_enum, $4::journey_phase_enum,
       $5, $6, $7, $8, $9,
       $10::jsonb, COALESCE($11, NOW())
     )`,
    [
      event.clientId,
      event.visaCaseId ?? null,
      event.eventType,
      event.phase,
      event.title,
      event.description ?? null,
      event.actorId ?? null,
      event.actorName ?? null,
      event.actorRole ?? null,
      event.metadata != null ? JSON.stringify(event.metadata) : null,
      event.occurredAt ?? null,
    ]
  );

  await invalidateModulesCachesOnWrite({ clientId: event.clientId });
}

// ─── Visa case assignment events ──────────────────────────────────────────────

/** All assignment audit rows for every visa case belonging to this client. */
export async function getAssignmentEventsForClient(
  clientId: string
): Promise<RawAssignmentEvent[]> {
  const { rows } = await getPoolSecond().query<RawAssignmentEvent>(
    `SELECT a.id, a.visa_case_id, a.assigned_team, a.assigned_user_id,
            a.previous_user_id, a.previous_team, a.assigned_by, a.assigned_by_role,
            a.assignment_type, a.notes, a.created_at AS occurred_at
       FROM visa_case_assignments a
       JOIN visa_cases vc ON vc.id = a.visa_case_id
      WHERE vc.client_id = $1::uuid
      ORDER BY a.created_at ASC`,
    [clientId]
  );
  return rows;
}

// ─── Visa case status events ──────────────────────────────────────────────────

/** All status-change audit rows for every visa case belonging to this client. */
export async function getStatusEventsForClient(
  clientId: string
): Promise<RawStatusEvent[]> {
  const { rows } = await getPoolSecond().query<RawStatusEvent>(
    `SELECT e.id, e.visa_case_id, e.from_stage, e.to_stage,
            e.from_sub_status, e.to_sub_status, e.changed_by, e.changed_by_role,
            e.notes, e.changed_at AS occurred_at
       FROM visa_case_status_events e
       JOIN visa_cases vc ON vc.id = e.visa_case_id
      WHERE vc.client_id = $1::uuid
      ORDER BY e.changed_at ASC`,
    [clientId]
  );
  return rows;
}

/** Counsellor handoffs recorded in modules `client_transfer_modules`. */
export async function getClientTransferEvents(
  clientId: string
): Promise<RawClientTransferEvent[]> {
  const { rows } = await getPoolSecond().query<RawClientTransferEvent>(
    `SELECT id, client_id, from_user_id, to_user_id, transferred_by,
            created_at AS occurred_at
       FROM client_transfer_modules
      WHERE client_id = $1::uuid
      ORDER BY created_at ASC`,
    [clientId]
  );
  return rows;
}
