import { sql } from "drizzle-orm";

/** Leads created in period (assigned / contacted / pipeline counts). */
export const createdInPeriodSql = (createdFrom?: Date, createdTo?: Date) => sql`
  ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
  ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
`;

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
 * Transfer outcomes in period: transferred_at / converted_at / dropped_at by status.
 * Used for telecaller transfer targets (any outcome counts).
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
      AND (
        (assignment_status = 'transferred' AND transferred_at IS NOT NULL)
        OR (assignment_status = 'converted' AND converted_at IS NOT NULL)
        OR (assignment_status = 'dropped' AND dropped_at IS NOT NULL)
      )
    `;
  }

  if (options?.endExclusive) {
    return sql`
      NOT is_junk
      AND (
        (assignment_status = 'transferred' AND transferred_at IS NOT NULL AND transferred_at >= ${from} AND transferred_at < ${to})
        OR (assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${from} AND converted_at < ${to})
        OR (assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${from} AND dropped_at < ${to})
      )
    `;
  }

  return sql`
    NOT is_junk
    AND (
      (assignment_status = 'transferred' AND transferred_at IS NOT NULL AND transferred_at >= ${from} AND transferred_at <= ${to})
      OR (assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${from} AND converted_at <= ${to})
      OR (assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${from} AND dropped_at <= ${to})
    )
  `;
};

/** @deprecated alias */
export const transferredOutcomeInPeriodSql = transferOutcomeInPeriodSql;

/** Conversions in period by converted_at. */
export const convertedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => sql`
  NOT is_junk
  AND converted_at IS NOT NULL
  AND assignment_status = 'converted'
  ${createdFrom ? sql`AND converted_at >= ${createdFrom}` : sql``}
  ${createdTo ? sql`AND converted_at <= ${createdTo}` : sql``}
`;

/** Drops in period by dropped_at. */
export const droppedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => sql`
  NOT is_junk
  AND dropped_at IS NOT NULL
  AND assignment_status = 'dropped'
  ${createdFrom ? sql`AND dropped_at >= ${createdFrom}` : sql``}
  ${createdTo ? sql`AND dropped_at <= ${createdTo}` : sql``}
`;
