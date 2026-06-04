import { sql } from "drizzle-orm";
import { getPgNaiveIndianNow } from "../../utils/pgTimestamp";
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
    return { ...patch, transferredAt: getPgNaiveIndianNow() };
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

/** SQL fragment for dashboard / target transfer counts (per-outcome timestamps). */
export function transferOutcomeInPeriodFilter(
  hasPeriod: boolean,
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) {
  const ex = options?.endExclusive;
  return sql`
    ${leads.isJunk} = false
    AND (
      (${leads.assignmentStatus} = 'transferred' AND ${outcomeTimestampInPeriod(leads.transferredAt, hasPeriod, from, to, ex)})
      OR (${leads.assignmentStatus} = 'converted' AND ${outcomeTimestampInPeriod(leads.convertedAt, hasPeriod, from, to, ex)})
      OR (${leads.assignmentStatus} = 'dropped' AND ${outcomeTimestampInPeriod(leads.droppedAt, hasPeriod, from, to, ex)})
    )
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
