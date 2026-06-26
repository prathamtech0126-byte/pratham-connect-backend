/**
 * Legacy IST helpers for modules still on naive `timestamp without time zone`
 * (activity_log, notifications). Leads use UTC `timestamptz` — do not use these there.
 */

export const CRM_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

function istPartsFromUtc(d: Date) {
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

  return {
    y: get("year"),
    mo: get("month"),
    day: get("day"),
    h: get("hour"),
    min: get("minute"),
    sec: get("second"),
    ms: d.getMilliseconds(),
  };
}

/** Map UTC instant to naive IST wall-clock Date (for legacy naive PG columns). */
export function utcToIndianWallClock(d: Date): Date {
  const { y, mo, day, h, min, sec } = istPartsFromUtc(d);
  return new Date(Date.UTC(y, mo - 1, day, h, min, sec));
}

export function getIndianNow(): Date {
  return utcToIndianWallClock(new Date());
}

function wallClockParts(d: Date) {
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

/** Serialize naive DB timestamp as IST offset string (legacy activity_log API). */
export function serializeAsIst(value: Date | string | null | undefined): string | null {
  if (value == null) return null;

  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;

  const { y, mo, day, h, min, sec, ms } = wallClockParts(d);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const base = `${y}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(min)}:${pad(sec)}`;
  if (ms > 0) return `${base}.${String(ms).padStart(3, "0")}${IST_OFFSET}`;
  return `${base}${IST_OFFSET}`;
}

export function formatIndianTimeForDisplay(
  value: Date | string | null | undefined
): string {
  const iso = serializeAsIst(value);
  if (!iso) return "";

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CRM_TIMEZONE,
  });
}

export function serializeActivityLogTimestampAsIst(
  value: Date | string | null | undefined
): string | null {
  return serializeAsIst(value);
}
