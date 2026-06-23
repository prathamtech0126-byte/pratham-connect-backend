/**
 * Legacy helpers for old `timestamp without time zone` columns that stored IST wall clock.
 * Prefer `getUtcNow()` and `utcTimestampColumns()` for new code and both databases.
 */
import { CRM_TIMEZONE } from "../constants";

const IST_OFFSET = "+05:30";

/** Current IST wall clock as a Date for inserting into legacy naive columns. */
export function getPgNaiveIndianNow(): Date {
  return pgNaiveIst(new Date());
}

/**
 * Convert any Date to an IST wall-clock representation suitable for storing in a
 * legacy `timestamp without time zone` column.
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
      get("second"),
    ),
  );
}

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

/** Serialize a legacy naive PG timestamp for API JSON (IST wall clock, explicit offset). */
export function serializePgNaiveTimestampAsIst(
  value: Date | string | null | undefined,
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

/** Convert a legacy naive IST wall-clock Date to the real UTC instant. */
export function pgNaiveIstWallClockToInstant(value: Date): Date {
  const iso = serializePgNaiveTimestampAsIst(value);
  if (!iso) return value;
  const instant = new Date(iso);
  return isNaN(instant.getTime()) ? value : instant;
}

/** Human-readable label in IST for a legacy naive PG timestamp. */
export function formatPgNaiveTimestampForDisplay(
  value: Date | string | null | undefined,
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
