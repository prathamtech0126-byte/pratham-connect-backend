/**
 * Read-side: merges all journey event sources into a single sorted timeline.
 *
 * Three sources (all in modules DB):
 *   1. journey_timeline_events  — enrollment, lead conversion, visa case creation, etc.
 *   2. visa_case_assignments    — admin→cx, cx→binding, binding→application handoffs
 *   3. visa_case_status_events  — processing stage / sub-status transitions
 *
 * User names are resolved in a single batch from the main CRM DB after the
 * modules-DB fetch, so no cross-DB JOINs are needed.
 */

import { pool } from "../../../config/databaseConnection";
import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import {
  getAssignmentEventsForClient,
  getClientTransferEvents,
  getJourneyTimelineEventsForClient,
  getStatusEventsForClient,
  type RawAssignmentEvent,
  type RawClientTransferEvent,
  type RawStatusEvent,
  type RawJourneyTimelineEvent,
} from "../models/journeyTimeline.model";

// ─── Public response shape ────────────────────────────────────────────────────

export type JourneyPhase =
  | "LEAD"
  | "ENROLLMENT"
  | "ASSIGNMENT"
  | "PROCESSING"
  | "DECISION";

export interface TimelineActor {
  id: number;
  name: string;
  role: string | null;
}

export interface TimelineEvent {
  id: string;
  occurredAt: string; // ISO-8601
  phase: JourneyPhase;
  type: string;
  title: string;
  description: string | null;
  actor: TimelineActor | null;
  visaCaseId: string | null;
  metadata: Record<string, unknown>;
  source: "journey_event" | "visa_assignment" | "visa_status_event" | "client_transfer";
}

export interface JourneySummary {
  clientId: string;
  currentJourneyStage: string | null;
  currentProcessingStage: string | null;
  currentProcessingSubStatus: string | null;
  activeVisaCases: Array<{
    id: string;
    currentStage: string;
    currentSubStatus: string;
    decision: string;
    assignedTeam: string;
    assignedUserId: number | null;
  }>;
  totalEvents: number;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

type UserInfo = { name: string; role: string };

const toActorId = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function batchResolveUsers(
  ids: number[]
): Promise<Map<number, UserInfo>> {
  const map = new Map<number, UserInfo>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return map;

  try {
    const { rows } = await pool.query<{ id: number; name: string; role: string }>(
      `SELECT id, full_name AS name, role FROM users WHERE id = ANY($1::bigint[])`,
      [unique]
    );
    for (const row of rows) {
      map.set(Number(row.id), { name: row.name, role: row.role });
    }
  } catch {
    // Main DB unreachable — degrade gracefully; IDs will show as fallback labels.
  }
  return map;
}

function titleCase(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function assignmentTitle(e: RawAssignmentEvent): string {
  const team = titleCase(e.assigned_team);
  switch (e.assignment_type) {
    case "admin_initial":
      return `Assigned to ${team} team`;
    case "admin_reassign":
      return `Reassigned to ${team} team`;
    case "cx_to_binding":
      return "Handed off to Binding / Application team";
    case "cx_to_application":
      return "Handed off to Binding / Application team";
    case "binding_to_application":
      return "Reassigned within Binding / Application team";
    case "ops_reassign":
      return "Reassigned within Binding / Application team";
    default:
      return `Case assigned to ${team} team`;
  }
}

function assignmentDescription(
  e: RawAssignmentEvent,
  users: Map<number, UserInfo>
): string | null {
  const assignee = users.get(toActorId(e.assigned_user_id) ?? -1);
  const assigner = users.get(toActorId(e.assigned_by) ?? -1);
  if (!assignee && !assigner) return e.notes ?? null;

  const parts: string[] = [];
  if (assignee) parts.push(`Assigned to ${assignee.name}`);
  if (assigner) parts.push(`by ${assigner.name}`);
  if (e.notes) parts.push(`— ${e.notes}`);
  return parts.join(" ") || null;
}

function statusTitle(e: RawStatusEvent): string {
  const stageChanged = e.from_stage !== e.to_stage && e.to_stage;
  if (stageChanged) {
    return `Stage: ${titleCase(e.from_stage ?? "Start")} → ${titleCase(e.to_stage!)}`;
  }
  return `Status: ${titleCase(e.to_sub_status)}`;
}

function phaseFromProcessingStage(stage: string | null): JourneyPhase {
  if (stage === "SUBMISSION") return "DECISION";
  return "PROCESSING";
}

function actorFromIds(
  id: unknown,
  role: string | null,
  users: Map<number, UserInfo>
): TimelineActor {
  const actorId = toActorId(id);
  if (actorId == null) {
    return { id: 0, name: "Unknown", role };
  }
  const info = users.get(actorId);
  return {
    id: actorId,
    name: info?.name ?? `User #${actorId}`,
    role: role ?? info?.role ?? null,
  };
}

function transferTitle(e: RawClientTransferEvent, users: Map<number, UserInfo>): string {
  const fromName = users.get(toActorId(e.from_user_id) ?? -1)?.name;
  const toName = users.get(toActorId(e.to_user_id) ?? -1)?.name;
  if (fromName && toName) return `Client transferred from ${fromName} to ${toName}`;
  if (toName) return `Client transferred to ${toName}`;
  return "Client transferred";
}

function transferDescription(
  e: RawClientTransferEvent,
  users: Map<number, UserInfo>
): string | null {
  const fromName = users.get(toActorId(e.from_user_id) ?? -1)?.name;
  const toName = users.get(toActorId(e.to_user_id) ?? -1)?.name;
  const byName = users.get(toActorId(e.transferred_by) ?? -1)?.name;
  const parts: string[] = [];
  if (fromName && toName) parts.push(`${fromName} → ${toName}`);
  if (byName) parts.push(`by ${byName}`);
  return parts.length ? parts.join(" ") : null;
}

function hasMatchingTransferEvent(
  events: TimelineEvent[],
  transfer: RawClientTransferEvent
): boolean {
  const fromId = toActorId(transfer.from_user_id);
  const toId = toActorId(transfer.to_user_id);
  return events.some((event) => {
    if (event.type !== "CLIENT_TRANSFERRED") return false;
    const meta = event.metadata ?? {};
    return (
      toActorId(meta.fromUserId) === fromId && toActorId(meta.toUserId) === toId
    );
  });
}

/** Higher rank = later in the business flow (used to break timestamp ties). */
function timelineBusinessRank(event: TimelineEvent): number {
  switch (event.type) {
    case "LEAD_CONVERTED":
      return 10;
    case "CLIENT_ENROLLED":
      return 20;
    case "CLIENT_TRANSFERRED":
      return 25;
    case "PAYMENT_MILESTONE": {
      if (event.metadata?.paymentKind === "product") return 36;
      const stage = event.metadata?.paymentStage;
      if (stage === "INITIAL") return 30;
      if (stage === "BEFORE_VISA") return 40;
      if (stage === "AFTER_VISA") return 50;
      return 35;
    }
    case "VISA_CASE_CREATED":
      return 60;
    case "TEAM_ROUTED":
      return 70;
    case "VISA_DECISION":
      return 200;
    default:
      break;
  }

  if (event.type.startsWith("ASSIGNMENT_")) {
    if (event.type === "ASSIGNMENT_ADMIN_INITIAL") return 80;
    if (event.type === "ASSIGNMENT_CX_TO_BINDING") return 90;
    if (event.type === "ASSIGNMENT_BINDING_TO_APPLICATION") return 100;
    return 85;
  }

  if (event.type.startsWith("STATUS_")) return 110;

  return 50;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getClientJourneyTimeline(
  clientId: string
): Promise<TimelineEvent[]> {
  const [ownEvents, assignments, statusEvents, transferRows] = await Promise.all([
    getJourneyTimelineEventsForClient(clientId),
    getAssignmentEventsForClient(clientId),
    getStatusEventsForClient(clientId),
    getClientTransferEvents(clientId),
  ]);

  // Collect all actor IDs for a single batch lookup.
  const actorIds: number[] = [];
  for (const e of ownEvents) {
    const actorId = toActorId(e.actor_id);
    if (actorId != null) actorIds.push(actorId);
    const meta = (e.metadata as Record<string, unknown> | null) ?? {};
    const fromId = toActorId(meta.fromUserId);
    const toId = toActorId(meta.toUserId);
    if (fromId != null) actorIds.push(fromId);
    if (toId != null) actorIds.push(toId);
  }
  for (const e of assignments) {
    const assignedUserId = toActorId(e.assigned_user_id);
    const assignedBy = toActorId(e.assigned_by);
    const previousUserId = toActorId(e.previous_user_id);
    if (assignedUserId != null) actorIds.push(assignedUserId);
    if (assignedBy != null) actorIds.push(assignedBy);
    if (previousUserId != null) actorIds.push(previousUserId);
  }
  for (const e of statusEvents) {
    const changedBy = toActorId(e.changed_by);
    if (changedBy != null) actorIds.push(changedBy);
  }
  for (const e of transferRows) {
    const fromId = toActorId(e.from_user_id);
    const toId = toActorId(e.to_user_id);
    const byId = toActorId(e.transferred_by);
    if (fromId != null) actorIds.push(fromId);
    if (toId != null) actorIds.push(toId);
    if (byId != null) actorIds.push(byId);
  }

  const users = await batchResolveUsers(actorIds);

  const events: TimelineEvent[] = [];

  // 1. Own journey events (enrollment, lead conversion, visa case creation, …)
  for (const e of ownEvents) {
    const actorId = toActorId(e.actor_id);
    const userInfo = actorId != null ? users.get(actorId) : null;
    const actorName = e.actor_name ?? userInfo?.name ?? null;
    events.push({
      id: e.id,
      occurredAt: (e.occurred_at as Date).toISOString(),
      phase: e.phase as JourneyPhase,
      type: e.event_type,
      title: e.title,
      description:
        e.event_type === "CLIENT_ENROLLED"
          ? (e.description ?? (actorName ? `Enrolled by ${actorName}` : null))
          : (e.description ?? null),
      actor: actorId
        ? {
            id: actorId,
            name: actorName ?? `User #${actorId}`,
            role: e.actor_role ?? userInfo?.role ?? null,
          }
        : null,
      visaCaseId: e.visa_case_id ?? null,
      metadata: (e.metadata as Record<string, unknown>) ?? {},
      source: "journey_event",
    });
  }

  // 2. Assignment handoffs
  for (const e of assignments) {
    events.push({
      id: e.id,
      occurredAt: (e.occurred_at as Date).toISOString(),
      phase: "ASSIGNMENT",
      type: `ASSIGNMENT_${e.assignment_type.toUpperCase()}`,
      title: assignmentTitle(e),
      description: assignmentDescription(e, users),
      actor: actorFromIds(e.assigned_by, e.assigned_by_role ?? null, users),
      visaCaseId: e.visa_case_id,
      metadata: {
        assignedTeam: e.assigned_team,
        assignedUserId: toActorId(e.assigned_user_id),
        assignedUserName:
          users.get(toActorId(e.assigned_user_id) ?? -1)?.name ?? null,
        previousTeam: e.previous_team ?? null,
        previousUserId: toActorId(e.previous_user_id),
        assignmentType: e.assignment_type,
        notes: e.notes ?? null,
      },
      source: "visa_assignment",
    });
  }

  // 3. Processing stage / sub-status changes
  for (const e of statusEvents) {
    events.push({
      id: e.id,
      occurredAt: (e.occurred_at as Date).toISOString(),
      phase: phaseFromProcessingStage(e.to_stage),
      type: `STATUS_${e.to_sub_status}`,
      title: statusTitle(e),
      description: e.notes ?? null,
      actor: actorFromIds(e.changed_by, e.changed_by_role ?? null, users),
      visaCaseId: e.visa_case_id,
      metadata: {
        fromStage: e.from_stage ?? null,
        toStage: e.to_stage ?? null,
        fromSubStatus: e.from_sub_status ?? null,
        toSubStatus: e.to_sub_status,
      },
      source: "visa_status_event",
    });
  }

  // 4. Historical transfers from client_transfer_modules (migration / pre-timeline rows)
  for (const e of transferRows) {
    if (hasMatchingTransferEvent(events, e)) continue;

    const fromId = toActorId(e.from_user_id);
    const toId = toActorId(e.to_user_id);
    const byId = toActorId(e.transferred_by);

    events.push({
      id: e.id,
      occurredAt: (e.occurred_at as Date).toISOString(),
      phase: "ENROLLMENT",
      type: "CLIENT_TRANSFERRED",
      title: transferTitle(e, users),
      description: transferDescription(e, users),
      actor: byId != null ? actorFromIds(byId, null, users) : null,
      visaCaseId: null,
      metadata: {
        fromUserId: fromId,
        toUserId: toId,
        fromUserName: fromId != null ? users.get(fromId)?.name ?? null : null,
        toUserName: toId != null ? users.get(toId)?.name ?? null : null,
        transferredBy: byId,
        transferredByName: byId != null ? users.get(byId)?.name ?? null : null,
      },
      source: "client_transfer",
    });
  }

  // Newest first; break ties using business-flow rank (payment after enrollment, etc.).
  events.sort((a, b) => {
    const timeDiff =
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return timelineBusinessRank(b) - timelineBusinessRank(a);
  });

  return events;
}

export async function getClientJourneySummary(
  clientId: string
): Promise<JourneySummary> {
  const db = getPoolSecond();

  const [journeyRow, visaCaseRows, eventCountRow] = await Promise.all([
    db
      .query<{
        current_stage: string;
        current_processing_stage: string | null;
        current_processing_sub_status: string | null;
      }>(
        `SELECT current_stage, current_processing_stage, current_processing_sub_status
           FROM client_journey
          WHERE client_id = $1::uuid
          LIMIT 1`,
        [clientId]
      )
      .then((r) => r.rows[0] ?? null),

    db
      .query<{
        id: string;
        current_stage: string;
        current_sub_status: string;
        decision: string;
        assigned_team: string;
        assigned_user_id: number | null;
      }>(
        `SELECT id, current_stage, current_sub_status, decision,
                assigned_team, assigned_user_id
           FROM visa_cases
          WHERE client_id = $1::uuid`,
        [clientId]
      )
      .then((r) => r.rows),

    db
      .query<{ cnt: string }>(
        `SELECT
           (SELECT COUNT(*) FROM journey_timeline_events WHERE client_id = $1::uuid)
           + (SELECT COUNT(*) FROM client_transfer_modules t
                WHERE t.client_id = $1::uuid
                  AND NOT EXISTS (
                    SELECT 1 FROM journey_timeline_events j
                     WHERE j.client_id = t.client_id
                       AND j.event_type = 'CLIENT_TRANSFERRED'
                       AND (j.metadata->>'fromUserId')::bigint = t.from_user_id
                       AND (j.metadata->>'toUserId')::bigint = t.to_user_id
                  ))
           + (SELECT COUNT(*) FROM visa_case_assignments a
                JOIN visa_cases vc ON vc.id = a.visa_case_id
               WHERE vc.client_id = $1::uuid)
           + (SELECT COUNT(*) FROM visa_case_status_events e
                JOIN visa_cases vc ON vc.id = e.visa_case_id
               WHERE vc.client_id = $1::uuid)
           AS cnt`,
        [clientId]
      )
      .then((r) => parseInt(r.rows[0]?.cnt ?? "0", 10)),
  ]);

  return {
    clientId,
    currentJourneyStage: journeyRow?.current_stage ?? null,
    currentProcessingStage: journeyRow?.current_processing_stage ?? null,
    currentProcessingSubStatus: journeyRow?.current_processing_sub_status ?? null,
    activeVisaCases: visaCaseRows.map((r) => ({
      id: r.id,
      currentStage: r.current_stage,
      currentSubStatus: r.current_sub_status,
      decision: r.decision,
      assignedTeam: r.assigned_team,
      assignedUserId: r.assigned_user_id ?? null,
    })),
    totalEvents: eventCountRow,
  };
}
