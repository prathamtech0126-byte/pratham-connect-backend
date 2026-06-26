import { sql } from "drizzle-orm";
import { leads } from "../schemas/leads.schema";

/** Counted as a telecaller transfer outcome on dashboard / targets. */
export const TELECALLER_TRANSFER_OUTCOME_STATUSES = [
  "transferred",
  "converted",
  "dropped",
] as const;

export type TelecallerTransferOutcomeStatus =
  (typeof TELECALLER_TRANSFER_OUTCOME_STATUSES)[number];

export function isTelecallerTransferOutcome(
  status: string | null | undefined
): status is TelecallerTransferOutcomeStatus {
  return (
    status != null &&
    (TELECALLER_TRANSFER_OUTCOME_STATUSES as readonly string[]).includes(status)
  );
}

/** Stamp transfer time when a lead is handed to counsellor/manager (incl. re-transfer). */
export function stampTransferredAtOnPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  if (patch.assignmentStatus === "transferred") {
    return { ...patch, transferredAt: new Date() };
  }
  return patch;
}

function outcomeTimestampInPeriod(
  column: typeof leads.transferredAt | typeof leads.convertedAt | typeof leads.droppedAt,
  hasPeriod: boolean,
  from?: Date,
  to?: Date,
  endExclusive?: boolean
) {
  const notNull = sql`${column} IS NOT NULL`;
  if (!hasPeriod || !from || !to) return notNull;
  if (endExclusive) {
    return sql`${notNull} AND ${column} >= ${from} AND ${column} < ${to}`;
  }
  return sql`${notNull} AND ${column} >= ${from} AND ${column} <= ${to}`;
}

/** SQL fragment for report "Transferred" counts (transferred_at in period). */
export function transferredAtInPeriodFilter(
  hasPeriod: boolean,
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) {
  const ex = options?.endExclusive;
  return sql`
    ${leads.isJunk} = false
    AND ${outcomeTimestampInPeriod(leads.transferredAt, hasPeriod, from, to, ex)}
  `;
}

/**
 * SQL fragment for telecaller transfer target counts.
 * A lead counts as a transfer in the period where transferredAt falls,
 * regardless of whether it was later converted or dropped.
 */
export function transferOutcomeInPeriodFilter(
  hasPeriod: boolean,
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) {
  const ex = options?.endExclusive;
  return sql`
    ${leads.isJunk} = false
    AND ${leads.assignmentStatus} IN ('transferred', 'converted', 'dropped')
    AND ${outcomeTimestampInPeriod(leads.transferredAt, hasPeriod, from, to, ex)}
  `;
}

/** Drops in period by dropped_at only. */
export function droppedInPeriodFilter(
  hasPeriod: boolean,
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) {
  const ex = options?.endExclusive;
  return sql`
    ${leads.isJunk} = false
    AND ${leads.assignmentStatus} = 'dropped'
    AND ${outcomeTimestampInPeriod(leads.droppedAt, hasPeriod, from, to, ex)}
  `;
}
