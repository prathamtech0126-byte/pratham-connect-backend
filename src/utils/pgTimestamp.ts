/**
 * PostgreSQL `timestamp without time zone` helpers.
 * node-pg reads/writes naive values using UTC Date components as wall clock.
 * CRM stores IST wall time in those columns.
 */

export const CRM_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** Current IST wall clock as a Date for inserting into `timestamp without time zone`. */
export function getPgNaiveIndianNow(): Date {
  return pgNaiveIst(new Date());
}

/**
 * Convert any Date to an IST wall-clock representation suitable for storing in a
 * `timestamp without time zone` column that the CRM treats as IST wall clock.
 *
 * e.g. new Date("2026-05-29T18:23:00+05:30") → Date whose UTC parts read 18:23
 *      so node-pg writes "2026-05-29T18:23:00" into the naive column.
 */
export function pgNaiveIst(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    )
  );
}

/** Wall-clock parts from a Date returned by node-pg for a naive PG timestamp. */
function utcWallClockParts(d: Date) {
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    sec: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * Serialize a naive PG timestamp for API JSON (IST wall clock, explicit offset).
 */
export function serializePgNaiveTimestampAsIst(
  value: Date | string | null | undefined
): string | null {
  if (value == null) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;

  const { y, mo, day, h, min, sec, ms } = utcWallClockParts(d);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const base = `${y}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(min)}:${pad(sec)}`;
  if (ms > 0) {
    return `${base}.${String(ms).padStart(3, "0")}${IST_OFFSET}`;
  }
  return `${base}${IST_OFFSET}`;
}

/**
 * Convert a naive PG IST wall-clock Date to the real UTC instant for scheduling/comparisons.
 */
export function pgNaiveIstWallClockToInstant(value: Date): Date {
  const iso = serializePgNaiveTimestampAsIst(value);
  if (!iso) return value;
  const instant = new Date(iso);
  return isNaN(instant.getTime()) ? value : instant;
}

/** Human-readable label in IST for a naive PG timestamp (notification copy, etc.). */
export function formatPgNaiveTimestampForDisplay(
  value: Date | string | null | undefined
): string {
  const iso = serializePgNaiveTimestampAsIst(value);
  if (!iso) return "";

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CRM_TIMEZONE,
  });
}

/** Format a real instant as IST offset string (e.g. for API JSON). */
function formatInstantToIstOffsetString(instant: Date): string | null {
  if (isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const pad = (n: string) => n.padStart(2, "0");
  const ms = instant.getMilliseconds();
  const base = `${get("year")}-${pad(get("month"))}-${pad(get("day"))}T${pad(get("hour"))}:${pad(get("minute"))}:${pad(get("second"))}`;
  if (ms > 0) {
    return `${base}.${String(ms).padStart(3, "0")}${IST_OFFSET}`;
  }
  return `${base}${IST_OFFSET}`;
}

/**
 * Cutoff for activity_log rows stored via DB `defaultNow()` as server/UTC wall clock.
 * Before: treat naive wall parts as UTC and display in IST.
 * After: standard IST naive wall (`getPgNaiveIndianNow` on insert).
 */
function getActivityLogLegacyUtcCutoffMs(): number {
  const raw = process.env.ACTIVITY_LOG_LEGACY_UTC_CUTOFF?.trim();
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return new Date("2026-06-01T00:00:00+05:30").getTime();
}

export function serializeActivityLogTimestampAsIst(
  value: Date | string | null | undefined
): string | null {
  if (value == null) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;

  if (d.getTime() < getActivityLogLegacyUtcCutoffMs()) {
    const { y, mo, day, h, min, sec, ms } = utcWallClockParts(d);
    const instant = new Date(Date.UTC(y, mo - 1, day, h, min, sec, ms));
    return formatInstantToIstOffsetString(instant);
  }

  return serializePgNaiveTimestampAsIst(d);
}

const LEAD_TIMESTAMP_KEYS = [
  "createdAt",
  "updatedAt",
  "facebookCreatedAt",
  "nextFollowupAt",
  "transferredAt",
  "convertedAt",
  "droppedAt",
] as const;

/** Serialize naive PG timestamps on a lead row for API JSON. */
export function serializeLeadTimestampsForApi<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of LEAD_TIMESTAMP_KEYS) {
    if (key in out && out[key] != null) {
      out[key] = serializePgNaiveTimestampAsIst(out[key] as Date | string);
    }
  }
  return out as T;
}

const LEAD_ACTIVITY_TIMESTAMP_KEYS = ["followupAt", "createdAt", "updatedAt"] as const;

/** Serialize naive PG timestamps on a lead activity row for API JSON. */
export function serializeLeadActivityTimestampsForApi<T extends Record<string, unknown>>(
  row: T
): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of LEAD_ACTIVITY_TIMESTAMP_KEYS) {
    if (key in out && out[key] != null) {
      out[key] = serializePgNaiveTimestampAsIst(out[key] as Date | string);
    }
  }
  return out as T;
}
