import { sql } from "drizzle-orm";
import { indianPeriodBounds } from "../../utils/istTime";

/** Leads created in period (assigned / contacted / pipeline counts). */
export const createdInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  const { from, to } = indianPeriodBounds(createdFrom, createdTo);
  return sql`
    ${from ? sql`AND created_at >= ${from}` : sql``}
    ${to ? sql`AND created_at <= ${to}` : sql``}
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

  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(from, to);
  if (!naiveFrom || !naiveTo) {
    return sql`
      NOT is_junk
      AND transferred_at IS NOT NULL
    `;
  }

  if (options?.endExclusive) {
    return sql`
      NOT is_junk
      AND transferred_at IS NOT NULL
      AND transferred_at >= ${naiveFrom} AND transferred_at < ${naiveTo}
    `;
  }

  return sql`
    NOT is_junk
    AND transferred_at IS NOT NULL
    AND transferred_at >= ${naiveFrom} AND transferred_at <= ${naiveTo}
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

  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(from, to);
  if (!naiveFrom || !naiveTo) {
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
      AND transferred_at >= ${naiveFrom} AND transferred_at < ${naiveTo}
      AND current_telecaller_id IS NOT NULL
      AND current_counsellor_id IS NOT NULL
    `;
  }

  return sql`
    NOT is_junk
    AND assignment_status IN ('transferred', 'converted', 'dropped')
    AND transferred_at IS NOT NULL
    AND transferred_at >= ${naiveFrom} AND transferred_at <= ${naiveTo}
    AND current_telecaller_id IS NOT NULL
    AND current_counsellor_id IS NOT NULL
  `;
};

/** @deprecated alias */
export const transferredOutcomeInPeriodSql = transferOutcomeInPeriodSql;

/** Conversions in period by converted_at. */
export const convertedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(createdFrom, createdTo);
  return sql`
    NOT is_junk
    AND converted_at IS NOT NULL
    AND assignment_status = 'converted'
    ${naiveFrom ? sql`AND converted_at >= ${naiveFrom}` : sql``}
    ${naiveTo ? sql`AND converted_at <= ${naiveTo}` : sql``}
  `;
};

/** Drops in period by dropped_at. */
export const droppedInPeriodSql = (createdFrom?: Date, createdTo?: Date) => {
  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(createdFrom, createdTo);
  return sql`
    NOT is_junk
    AND dropped_at IS NOT NULL
    AND assignment_status = 'dropped'
    ${naiveFrom ? sql`AND dropped_at >= ${naiveFrom}` : sql``}
    ${naiveTo ? sql`AND dropped_at <= ${naiveTo}` : sql``}
  `;
};
