import { pool } from "../../../config/databaseConnection";
import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import {
  getClientJourneyTimeline,
  type JourneyPhase,
  type TimelineEvent,
} from "./journeyTimeline.service";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityLogRow = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  performed_by: string;
  created_at: Date;
};

export type ActivityFeedActor = {
  id: number;
  name: string;
  role: string | null;
};

export type ActivityFeedResult = {
  events: TimelineEvent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  actors: ActivityFeedActor[];
};

// ─── Entity config ────────────────────────────────────────────────────────────

const INCLUDED_ENTITY_TYPES = [
  "client",
  "client_information",
  "client_payment",
  "clientPayment",
  "client_product_payment",
  "clientProductPayment",
  "all_finance",
  "visa_case",
  "student_application",
];

function derivePhase(entityType: string): JourneyPhase {
  const et = entityType.toLowerCase();
  if (
    et === "client" ||
    et === "client_information" ||
    et === "client_payment" ||
    et === "clientpayment"
  ) {
    return "ENROLLMENT";
  }
  return "PROCESSING";
}

function deriveTitle(entityType: string, action: string): string {
  const et = entityType.toLowerCase();
  const a = action.toUpperCase();

  if (et === "client" || et === "client_information") {
    if (a === "CREATE") return "Client profile created";
    if (a === "UPDATE") return "Client details updated";
    if (a === "ARCHIVE") return "Client archived";
    if (a === "UNARCHIVE") return "Client restored";
    return "Client updated";
  }
  if (et === "client_payment" || et === "clientpayment") {
    if (a === "PAYMENT_ADDED") return "Payment added";
    if (a === "PAYMENT_UPDATED") return "Payment updated";
    if (a === "PAYMENT_DELETED") return "Payment deleted";
    return "Payment updated";
  }
  if (et === "client_product_payment" || et === "clientproductpayment") {
    if (a === "PRODUCT_ADDED") return "Product payment added";
    if (a === "PRODUCT_UPDATED") return "Product payment updated";
    if (a === "PRODUCT_DELETED") return "Product payment removed";
    return "Product payment updated";
  }
  if (et === "all_finance") {
    if (a === "STATUS_CHANGE") return "Finance payment status updated";
    return "Finance updated";
  }
  if (et === "visa_case") {
    if (a === "CREATE") return "Visa case created";
    if (a === "STATUS_CHANGE") return "Visa case status changed";
    if (a === "UPDATE") return "Visa case updated";
    return "Visa case updated";
  }
  if (et === "student_application") {
    if (a === "CREATE") return "Student application submitted";
    if (a === "STATUS_CHANGE") return "Student application status changed";
    return "Student application updated";
  }

  return `${entityType.replace(/_/g, " ")} ${action.replace(/_/g, " ")}`
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

function deriveType(entityType: string, action: string): string {
  return `${entityType.toUpperCase().replace(/-/g, "_")}_${action.toUpperCase()}`;
}

// ─── Resolve primary visa case ────────────────────────────────────────────────

/**
 * Returns the single visa case UUID for the client, or null if the client has
 * zero or multiple visa cases (in which case we can't reliably attribute
 * activity_log events to a specific case).
 */
async function resolvePrimaryVisaCaseId(
  clientUuid: string
): Promise<string | null> {
  try {
    const { rows } = await getPoolSecond().query<{ id: string }>(
      `SELECT id FROM visa_cases WHERE client_id = $1::uuid`,
      [clientUuid]
    );
    return rows.length === 1 ? rows[0].id : null;
  } catch {
    return null;
  }
}

// ─── Fetch & normalise activity_log rows ─────────────────────────────────────

async function fetchActivityLogEvents(
  legacyClientId: number,
  primaryVisaCaseId: string | null
): Promise<TimelineEvent[]> {
  const { rows } = await pool.query<ActivityLogRow>(
    `SELECT id, entity_type, entity_id, action, old_value, new_value,
            description, metadata, performed_by, created_at
       FROM activity_log
      WHERE client_id = $1
        AND entity_type = ANY($2::text[])
      ORDER BY created_at DESC`,
    [legacyClientId, INCLUDED_ENTITY_TYPES]
  );

  if (!rows.length) return [];

  // Batch-resolve user names from the main CRM DB.
  const actorIds = [
    ...new Set(rows.map((r) => Number(r.performed_by)).filter(Boolean)),
  ];
  const userMap = new Map<number, { name: string; role: string }>();

  if (actorIds.length) {
    try {
      const { rows: users } = await pool.query<{
        id: number;
        name: string;
        role: string;
      }>(
        `SELECT id, full_name AS name, role FROM users WHERE id = ANY($1::bigint[])`,
        [actorIds]
      );
      for (const u of users) {
        userMap.set(Number(u.id), { name: u.name, role: u.role });
      }
    } catch {
      // Degrade gracefully — actor names will fall back to "User #id".
    }
  }

  return rows.map((row) => {
    const actorId = Number(row.performed_by) || null;
    const userInfo = actorId != null ? userMap.get(actorId) : null;

    return {
      id: `al-${row.id}`,
      occurredAt: (row.created_at as Date).toISOString(),
      phase: derivePhase(row.entity_type),
      type: deriveType(row.entity_type, row.action),
      title: deriveTitle(row.entity_type, row.action),
      description: row.description?.replace(/\$/g, "₹") ?? null,
      actor: actorId
        ? {
            id: actorId,
            name: userInfo?.name ?? `User #${actorId}`,
            role: userInfo?.role ?? null,
          }
        : null,
      visaCaseId: primaryVisaCaseId,
      metadata: {
        entityType: row.entity_type,
        entityId: row.entity_id != null ? Number(row.entity_id) : null,
        action: row.action,
        oldValue: row.old_value ?? null,
        newValue: row.new_value ?? null,
        ...(row.metadata ?? {}),
      },
      source: "activity_log" as const,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ActivityFeedFilters = {
  actorId?: number;
  phase?: string;
};

export async function getClientActivityFeed(
  clientUuid: string,
  legacyClientId: number | null,
  page: number,
  pageSize: number,
  filters: ActivityFeedFilters = {}
): Promise<ActivityFeedResult> {
  // Resolve journey events and primary visa case ID in parallel (both modules DB).
  const [journeyTimeline, primaryVisaCaseId] = await Promise.all([
    getClientJourneyTimeline(clientUuid),
    resolvePrimaryVisaCaseId(clientUuid),
  ]);
  const journeyEvents = journeyTimeline.events;

  // Then fetch activity_log from the legacy DB, now armed with the visa case ID.
  const activityLogEvents =
    legacyClientId != null
      ? await fetchActivityLogEvents(legacyClientId, primaryVisaCaseId)
      : [];

  // Merge and sort newest-first.
  const allEvents = [...journeyEvents, ...activityLogEvents].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  // Collect unique actors from the FULL unfiltered list so the dropdown always
  // shows every actor regardless of the active filter.
  const actorMap = new Map<number, ActivityFeedActor>();
  for (const event of allEvents) {
    if (event.actor?.id && !actorMap.has(event.actor.id)) {
      actorMap.set(event.actor.id, {
        id: event.actor.id,
        name: event.actor.name,
        role: event.actor.role,
      });
    }
  }

  // Apply optional filters before paginating.
  const filteredEvents = allEvents.filter((event) => {
    if (filters.actorId != null && event.actor?.id !== filters.actorId) {
      return false;
    }
    if (filters.phase != null && event.phase !== filters.phase) {
      return false;
    }
    return true;
  });

  const total = filteredEvents.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  return {
    events: filteredEvents.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    actors: [...actorMap.values()],
  };
}
