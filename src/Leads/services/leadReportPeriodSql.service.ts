import { sql } from "drizzle-orm";

/** Leads created in period (assigned / contacted / pipeline counts). */
export const createdInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  return sql`
    ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
    ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
  `;
};

/** Leads transferred in period by transferred_at only (report "Transferred" KPI). */
export const transferredAtInPeriodSql = (
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) => {
  const hasPeriod = Boolean(from && to);
  if (!hasPeriod) {
    return sql`
      NOT is_junk
      AND transferred_at IS NOT NULL
    `;
  }

  if (options?.endExclusive) {
    return sql`
      NOT is_junk
      AND transferred_at IS NOT NULL
      AND transferred_at >= ${from} AND transferred_at < ${to}
    `;
  }

  return sql`
    NOT is_junk
    AND transferred_at IS NOT NULL
    AND transferred_at >= ${from} AND transferred_at <= ${to}
  `;
};

/**
 * Transfer outcomes in period: all 3 statuses (transferred/converted/dropped) use transferred_at.
 * Requires both current_telecaller_id AND current_counsellor_id to be set.
 */
export const transferOutcomeInPeriodSql = (
  from?: Date,
  to?: Date,
  options?: { endExclusive?: boolean }
) => {
  const hasPeriod = Boolean(from && to);
  if (!hasPeriod) {
    return sql`
      NOT is_junk
      AND assignment_status IN ('transferred', 'converted', 'dropped')
      AND transferred_at IS NOT NULL
      AND current_telecaller_id IS NOT NULL
      AND current_counsellor_id IS NOT NULL
    `;
  }

  if (options?.endExclusive) {
    return sql`
      NOT is_junk
      AND assignment_status IN ('transferred', 'converted', 'dropped')
      AND transferred_at IS NOT NULL
      AND transferred_at >= ${from} AND transferred_at < ${to}
      AND current_telecaller_id IS NOT NULL
      AND current_counsellor_id IS NOT NULL
    `;
  }

  return sql`
    NOT is_junk
    AND assignment_status IN ('transferred', 'converted', 'dropped')
    AND transferred_at IS NOT NULL
    AND transferred_at >= ${from} AND transferred_at <= ${to}
    AND current_telecaller_id IS NOT NULL
    AND current_counsellor_id IS NOT NULL
  `;
};

/** @deprecated alias */
export const transferredOutcomeInPeriodSql = transferOutcomeInPeriodSql;

/** Conversions in period by converted_at. */
export const convertedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  return sql`
    NOT is_junk
    AND converted_at IS NOT NULL
    AND assignment_status = 'converted'
    ${createdFrom ? sql`AND converted_at >= ${createdFrom}` : sql``}
    ${createdTo ? sql`AND converted_at <= ${createdTo}` : sql``}
  `;
};

/** Drops in period by dropped_at. */
export const droppedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  return sql`
    NOT is_junk
    AND dropped_at IS NOT NULL
    AND assignment_status = 'dropped'
    ${createdFrom ? sql`AND dropped_at >= ${createdFrom}` : sql``}
    ${createdTo ? sql`AND dropped_at <= ${createdTo}` : sql``}
  `;
};
