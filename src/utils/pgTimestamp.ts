/**
 * PostgreSQL `timestamp without time zone` helpers.
 * node-pg reads/writes naive values using UTC Date components as wall clock.
 * CRM stores IST wall time in those columns.
 */

export const CRM_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** Current IST wall clock as a Date for inserting into `timestamp without time zone`. */
export function getPgNaiveIndianNow(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

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

const LEAD_TIMESTAMP_KEYS = [
  "createdAt",
  "updatedAt",
  "facebookCreatedAt",
  "nextFollowupAt",
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
