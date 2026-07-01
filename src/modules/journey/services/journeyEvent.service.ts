/**
 * Write-side helpers that emit journey timeline events.
 * Called fire-and-forget from sync / visa-case services.
 * All failures are logged and swallowed — never blocks the caller.
 */

import { pool } from "../../../config/databaseConnection";
import {
  isModulesDbConfigured,
  getPoolSecond,
} from "../../../config/databaseConnectionSecond";
import {
  normalizeDbDate,
  resolveEnrollmentOccurredAt,
} from "../../../utils/date";
import { insertJourneyTimelineEvent } from "../models/journeyTimeline.model";

const log = (label: string, error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[journeyEvent] ${label}:`, msg);
};

const PAYMENT_STAGE_LABELS: Record<string, string> = {
  INITIAL: "Initial payment received",
  BEFORE_VISA: "Before visa payment received",
  AFTER_VISA: "After visa payment received",
};

const formatProductPaymentLabel = (productName: string): string => {
  const label = productName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  return `${label} payment received`;
};

const toNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseOccurredAt = (
  value: string | Date | null | undefined,
  sequenceOffsetMs = 0
): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (sequenceOffsetMs === 0) return date;
  return new Date(date.getTime() + sequenceOffsetMs);
};

/** Look up the modules-DB client UUID from a main-CRM client id. */
async function resolveClientId(legacyClientId: number): Promise<string | null> {
  const { rows } = await getPoolSecond().query<{ id: string }>(
    `SELECT id FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
    [legacyClientId]
  );
  return rows[0]?.id ?? null;
}

async function resolveActorProfile(
  actorId: number
): Promise<{ name: string; role: string } | null> {
  try {
    const { rows } = await pool.query<{ name: string; role: string }>(
      `SELECT full_name AS name, role FROM users WHERE id = $1 LIMIT 1`,
      [actorId]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function hasTimelineEvent(input: {
  clientId: string;
  eventType: string;
  visaCaseId?: string | null;
}): Promise<boolean> {
  const { rows } = await getPoolSecond().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM journey_timeline_events
        WHERE client_id = $1::uuid
          AND event_type = $2::journey_event_type_enum
          AND ($3::uuid IS NULL OR visa_case_id = $3::uuid)
     ) AS exists`,
    [input.clientId, input.eventType, input.visaCaseId ?? null]
  );
  return rows[0]?.exists === true;
}

async function resolveVisaCaseId(input: {
  clientId: string;
  legacySaleTypeId?: number | null;
}): Promise<string | null> {
  if (input.legacySaleTypeId == null) return null;

  const { rows } = await getPoolSecond().query<{ id: string }>(
    `SELECT vc.id
       FROM visa_cases vc
       JOIN sales s ON s.id = vc.sale_id
       JOIN sale_type st ON st.id = s.sale_type_id
      WHERE vc.client_id = $1::uuid
        AND st.legacy_sale_type_id = $2
      ORDER BY vc.created_at DESC
      LIMIT 1`,
    [input.clientId, input.legacySaleTypeId]
  );

  return rows[0]?.id ?? null;
}

// ─── Emitters ─────────────────────────────────────────────────────────────────

/**
 * Idempotent — creates CLIENT_ENROLLED timeline row if missing.
 * Uses real enrollment date from main CRM when provided.
 */
export async function ensureClientEnrolledTimelineEvent(input: {
  clientId: string;
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  legacyClientId: number;
  enrolledAt?: string | Date | null;
  enrollmentDate?: string | Date | null;
  createdAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  try {
    const exists = await hasTimelineEvent({
      clientId: input.clientId,
      eventType: "CLIENT_ENROLLED",
    });
    if (exists) return;

    const actor =
      input.actorName != null
        ? { name: input.actorName, role: input.actorRole ?? "counsellor" }
        : await resolveActorProfile(input.actorId);

    const enrollmentDate =
      normalizeDbDate(input.enrollmentDate ?? input.enrolledAt) ??
      (input.createdAt ? normalizeDbDate(input.createdAt) : null);
    const createdAt = input.createdAt
      ? new Date(input.createdAt).toISOString()
      : null;
    const storedOccurredAt =
      parseOccurredAt(input.enrolledAt ?? input.enrollmentDate, 0) ??
      parseOccurredAt(input.createdAt, 0);
    const occurredAt =
      storedOccurredAt != null
        ? new Date(
            resolveEnrollmentOccurredAt({
              occurredAt: storedOccurredAt,
              enrollmentDate,
              createdAt,
            })
          )
        : null;

    await insertJourneyTimelineEvent({
      clientId: input.clientId,
      eventType: "CLIENT_ENROLLED",
      phase: "ENROLLMENT",
      title: "Client enrolled",
      description: actor?.name ? `Enrolled by ${actor.name}` : null,
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? input.actorRole ?? "counsellor",
      metadata: {
        legacyClientId: input.legacyClientId,
        enrollmentDate,
        createdAt,
      },
      occurredAt,
    });
  } catch (error) {
    log("ensureClientEnrolledTimelineEvent", error);
  }
}

/**
 * Emitted once when a client record is first created in the modules DB.
 * Called from syncClientFromMain after the INSERT.
 */
export async function emitClientEnrolledEvent(input: {
  clientId: string;
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  legacyClientId: number;
  enrolledAt?: string | Date | null;
  enrollmentDate?: string | Date | null;
  createdAt?: string | Date | null;
}): Promise<void> {
  await ensureClientEnrolledTimelineEvent(input);
}

/**
 * Emitted when a counsellor converts a lead → client.
 */
export async function emitLeadConvertedEvent(input: {
  legacyClientId: number;
  leadId?: number | null;
  actorId: number;
  actorName?: string | null;
  convertedAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;
  try {
    const clientId = await resolveClientId(input.legacyClientId);
    if (!clientId) return;

    const actor =
      input.actorName != null
        ? { name: input.actorName, role: "counsellor" }
        : await resolveActorProfile(input.actorId);

    await insertJourneyTimelineEvent({
      clientId,
      eventType: "LEAD_CONVERTED",
      phase: "LEAD",
      title: "Lead converted to client",
      description: actor?.name ? `Converted by ${actor.name}` : null,
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: "counsellor",
      metadata: {
        leadId: input.leadId ?? null,
        legacyClientId: input.legacyClientId,
      },
      occurredAt: parseOccurredAt(input.convertedAt),
    });
  } catch (error) {
    log("emitLeadConvertedEvent", error);
  }
}

/**
 * Emitted when a visa case is first created for a sale.
 */
export async function emitVisaCaseCreatedEvent(input: {
  clientId: string;
  visaCaseId: string;
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  createdAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;
  try {
    const exists = await hasTimelineEvent({
      clientId: input.clientId,
      eventType: "VISA_CASE_CREATED",
      visaCaseId: input.visaCaseId,
    });
    if (exists) return;

    const actor =
      input.actorName != null
        ? { name: input.actorName, role: input.actorRole ?? "counsellor" }
        : await resolveActorProfile(input.actorId);

    await insertJourneyTimelineEvent({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId,
      eventType: "VISA_CASE_CREATED",
      phase: "ENROLLMENT",
      title: "Visa case created",
      description: "Visa processing case opened",
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? input.actorRole ?? "counsellor",
      occurredAt: parseOccurredAt(input.createdAt),
    });
  } catch (error) {
    log("emitVisaCaseCreatedEvent", error);
  }
}

/** Emitted right after visa case creation — case queued for CX team. */
export async function emitVisaCaseTeamRoutedEvent(input: {
  clientId: string;
  visaCaseId: string;
  team: "cx" | "binding" | "application";
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  occurredAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  const teamLabel =
    input.team === "cx"
      ? "CX"
      : input.team === "binding"
        ? "Binding"
        : "Application";

  try {
    const exists = await hasTimelineEvent({
      clientId: input.clientId,
      eventType: "TEAM_ROUTED",
      visaCaseId: input.visaCaseId,
    });
    if (exists) return;

    const actor =
      input.actorName != null
        ? { name: input.actorName, role: input.actorRole ?? "counsellor" }
        : await resolveActorProfile(input.actorId);

    await insertJourneyTimelineEvent({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId,
      eventType: "TEAM_ROUTED",
      phase: "ASSIGNMENT",
      title: `Routed to ${teamLabel} team`,
      description: `Visa case queued for ${teamLabel} processing`,
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? input.actorRole ?? "counsellor",
      metadata: { team: input.team },
      occurredAt: parseOccurredAt(input.occurredAt),
    });
  } catch (error) {
    log("emitVisaCaseTeamRoutedEvent", error);
  }
}

/**
 * Emitted when a payment milestone is recorded (initial payment, before-visa, etc.).
 */
export async function emitPaymentMilestoneEvent(input: {
  clientId: string;
  visaCaseId?: string | null;
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  milestoneLabel: string;
  paymentStage?: string | null;
  paymentId?: number | null;
  productPaymentId?: number | null;
  productName?: string | null;
  paymentKind?: "core" | "product";
  amount?: number | string | null;
  currency?: string | null;
  occurredAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;
  try {
    const actor =
      input.actorName != null
        ? { name: input.actorName, role: input.actorRole ?? "counsellor" }
        : await resolveActorProfile(input.actorId);

    await insertJourneyTimelineEvent({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId ?? null,
      eventType: "PAYMENT_MILESTONE",
      phase: "ENROLLMENT",
      title: input.milestoneLabel,
      description:
        input.amount != null
          ? `Amount: ${input.currency ?? "INR"} ${input.amount}`
          : null,
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? input.actorRole ?? null,
      metadata: {
        paymentKind: input.paymentKind ?? "core",
        paymentStage: input.paymentStage ?? null,
        paymentId: input.paymentId ?? null,
        productPaymentId: input.productPaymentId ?? null,
        productName: input.productName ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? "INR",
      },
      occurredAt: parseOccurredAt(input.occurredAt),
    });
  } catch (error) {
    log("emitPaymentMilestoneEvent", error);
  }
}

/** Wire payment save → journey timeline (modules DB). */
export async function syncJourneyTimelineOnPayment(input: {
  legacyClientId: number;
  paymentStage: string;
  paymentId?: number | null;
  legacySaleTypeId?: number | null;
  amount?: number | string | null;
  paymentDate?: string | Date | null;
  actorId: number;
  actorRole?: string | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  const label =
    PAYMENT_STAGE_LABELS[input.paymentStage] ?? "Payment received";

  try {
    const clientId = await resolveClientId(input.legacyClientId);
    if (!clientId) return;

    const visaCaseId = await resolveVisaCaseId({
      clientId,
      legacySaleTypeId: input.legacySaleTypeId ?? null,
    });

    await emitPaymentMilestoneEvent({
      clientId,
      visaCaseId,
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      milestoneLabel: label,
      paymentKind: "core",
      paymentStage: input.paymentStage,
      paymentId: input.paymentId ?? null,
      amount: input.amount ?? null,
      occurredAt: parseOccurredAt(input.paymentDate, 60_000),
    });
  } catch (error) {
    log("syncJourneyTimelineOnPayment", error);
  }
}

/** Wire product payment save → journey timeline (modules DB). */
export async function syncJourneyTimelineOnProductPayment(input: {
  legacyClientId: number;
  productName: string;
  productPaymentId?: number | null;
  amount?: number | string | null;
  paymentDate?: string | Date | null;
  actorId: number;
  actorRole?: string | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  try {
    const clientId = await resolveClientId(input.legacyClientId);
    if (!clientId) return;

    await emitPaymentMilestoneEvent({
      clientId,
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      milestoneLabel: formatProductPaymentLabel(input.productName),
      paymentKind: "product",
      productName: input.productName,
      productPaymentId: input.productPaymentId ?? null,
      amount: input.amount ?? null,
      occurredAt: parseOccurredAt(input.paymentDate, 90_000),
    });
  } catch (error) {
    log("syncJourneyTimelineOnProductPayment", error);
  }
}

/**
 * Emitted when the visa decision is recorded on the case.
 */
export async function emitVisaDecisionEvent(input: {
  clientId: string;
  visaCaseId: string;
  decision: string;
  actorId: number;
  actorName?: string | null;
  actorRole?: string | null;
  decidedAt?: string | Date | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;
  try {
    const actor =
      input.actorName != null
        ? { name: input.actorName, role: input.actorRole ?? null }
        : await resolveActorProfile(input.actorId);

    await insertJourneyTimelineEvent({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId,
      eventType: "VISA_DECISION",
      phase: "DECISION",
      title: `Visa decision: ${input.decision}`,
      actorId: input.actorId,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? null,
      metadata: { decision: input.decision },
      occurredAt: parseOccurredAt(input.decidedAt),
    });
  } catch (error) {
    log("emitVisaDecisionEvent", error);
  }
}

export type ClientTransferType = "full_transfer" | "owner_only_transfer_flag";

/**
 * Record counsellor handoff in modules DB + journey timeline.
 * Safe to call only when modules DB is configured; no-ops otherwise.
 */
export async function syncClientTransferToModules(input: {
  legacyClientId: number;
  fromUserId: number;
  toUserId: number;
  transferredBy: number;
  transferType: ClientTransferType;
  fromUserName?: string | null;
  toUserName?: string | null;
  transferredByName?: string | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;
  if (!Number.isFinite(input.fromUserId) || !Number.isFinite(input.toUserId)) return;
  if (input.fromUserId === input.toUserId) return;

  try {
    const clientId = await resolveClientId(input.legacyClientId);
    if (!clientId) return;

    const [fromUser, toUser, byUser] = await Promise.all([
      input.fromUserName
        ? Promise.resolve({ name: input.fromUserName, role: "counsellor" })
        : resolveActorProfile(input.fromUserId),
      input.toUserName
        ? Promise.resolve({ name: input.toUserName, role: "counsellor" })
        : resolveActorProfile(input.toUserId),
      input.transferredByName
        ? Promise.resolve({ name: input.transferredByName, role: "admin" })
        : resolveActorProfile(input.transferredBy),
    ]);

    await getPoolSecond().query(
      `INSERT INTO client_transfer_modules (
         client_id, from_user_id, to_user_id, transferred_by, created_at, updated_at
       )
       SELECT $1::uuid, $2::bigint, $3::bigint, $4::bigint, NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM client_transfer_modules
          WHERE client_id = $1::uuid
            AND from_user_id = $2::bigint
            AND to_user_id = $3::bigint
       )`,
      [clientId, input.fromUserId, input.toUserId, input.transferredBy]
    );

    const isFullTransfer = input.transferType === "full_transfer";
    const fromName = fromUser?.name ?? `User #${input.fromUserId}`;
    const toName = toUser?.name ?? `User #${input.toUserId}`;
    const title = isFullTransfer
      ? `Client transferred to ${toName}`
      : `Client shared with ${toName}`;
    const description = isFullTransfer
      ? `Permanent transfer from ${fromName} to ${toName}`
      : `Owner ${fromName} — handling assigned to ${toName}`;

    await insertJourneyTimelineEvent({
      clientId,
      eventType: "CLIENT_TRANSFERRED",
      phase: "ENROLLMENT",
      title,
      description,
      actorId: input.transferredBy,
      actorName: byUser?.name ?? null,
      actorRole: byUser?.role ?? "admin",
      metadata: {
        transferType: input.transferType,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        fromUserName: fromName,
        toUserName: toName,
        transferredBy: input.transferredBy,
        transferredByName: byUser?.name ?? null,
        legacyClientId: input.legacyClientId,
      },
    });
  } catch (error) {
    log("syncClientTransferToModules", error);
  }
}
