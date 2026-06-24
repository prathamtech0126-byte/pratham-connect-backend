/**
 * Server-side IST time helpers.
 * Flow: server UTC instant → Asia/Kolkata wall clock → store/read naive PG timestamps.
 */

export const CRM_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

/** Current IST calendar date as yyyy-MM-dd (from server clock). */
export function istCalendarYmdNow(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TIMEZONE }).format(new Date());
}

export function istDayStartStr(ymd: string): string {
  return `${ymd} 00:00:00`;
}

export function istDayEndStr(ymd: string): string {
  return `${ymd} 23:59:59.999`;
}

export function istFilterBounds(
  filter: "today" | "weekly" | "monthly"
): { from: string; to: string } {
  const ymd = istCalendarYmdNow();
  if (filter === "today") {
    return { from: istDayStartStr(ymd), to: istDayEndStr(ymd) };
  }
  if (filter === "monthly") {
    const [y, m] = ymd.split("-");
    const first = `${y}-${m.padStart(2, "0")}-01`;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    const last = `${y}-${m.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { from: istDayStartStr(first), to: istDayEndStr(last) };
  }
  const anchor = new Date(`${ymd}T12:00:00${IST_OFFSET}`);
  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: CRM_TIMEZONE,
    weekday: "long",
  }).format(anchor);
  const daysSinceMonday: Record<string, number> = {
    Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
  };
  const offset = daysSinceMonday[weekdayLong] ?? 0;
  const mondayMs = anchor.getTime() - offset * 86_400_000;
  const mondayYmd = new Date(mondayMs).toLocaleDateString("en-CA", { timeZone: CRM_TIMEZONE });
  const sundayYmd = new Date(mondayMs + 6 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: CRM_TIMEZONE,
  });
  return { from: istDayStartStr(mondayYmd), to: istDayEndStr(sundayYmd) };
}

/** Extract IST wall-clock parts from a UTC instant (server time). */
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

/**
 * Map a UTC instant to a Date whose UTC components equal IST wall clock.
 * node-pg writes those components into `timestamp without time zone` columns.
 */
export function utcToIndianWallClock(d: Date): Date {
  const { y, mo, day, h, min, sec } = istPartsFromUtc(d);
  return new Date(Date.UTC(y, mo - 1, day, h, min, sec));
}

/** Current server time as IST wall clock for DB inserts. */
export function getIndianNow(): Date {
  return utcToIndianWallClock(new Date());
}

/** Format UTC instant as naive IST string for SQL comparisons. */
export function utcToIndianWallClockStr(d: Date): string {
  const wall = utcToIndianWallClock(d);
  const y = wall.getUTCFullYear();
  const mo = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const day = String(wall.getUTCDate()).padStart(2, "0");
  const h = String(wall.getUTCHours()).padStart(2, "0");
  const min = String(wall.getUTCMinutes()).padStart(2, "0");
  const sec = String(wall.getUTCSeconds()).padStart(2, "0");
  const ms = wall.getUTCMilliseconds();
  if (ms > 0) return `${y}-${mo}-${day} ${h}:${min}:${sec}.${String(ms).padStart(3, "0")}`;
  return `${y}-${mo}-${day} ${h}:${min}:${sec}`;
}

/** Map API period instants to naive IST wall-clock Dates for DB filters. */
export function indianPeriodBounds(
  from?: Date,
  to?: Date
): { from?: Date; to?: Date } {
  return {
    from: from != null && !Number.isNaN(from.getTime()) ? utcToIndianWallClock(from) : undefined,
    to: to != null && !Number.isNaN(to.getTime()) ? utcToIndianWallClock(to) : undefined,
  };
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

/** Serialize naive DB timestamp as IST offset string for API JSON. */
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

/** Convert naive IST wall-clock Date from DB to real UTC instant. */
export function indianWallClockToInstant(value: Date): Date {
  const iso = serializeAsIst(value);
  if (!iso) return value;
  const instant = new Date(iso);
  return isNaN(instant.getTime()) ? value : instant;
}

/** Human-readable IST label for notifications. */
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

const LEAD_TIMESTAMP_KEYS = [
  "createdAt",
  "updatedAt",
  "facebookCreatedAt",
  "nextFollowupAt",
  "transferredAt",
  "convertedAt",
  "droppedAt",
] as const;

export function serializeLeadTimestampsForApi<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of LEAD_TIMESTAMP_KEYS) {
    if (key in out && out[key] != null) {
      out[key] = serializeAsIst(out[key] as Date | string);
    }
  }
  return out as T;
}

const LEAD_ACTIVITY_TIMESTAMP_KEYS = ["followupAt", "createdAt", "updatedAt"] as const;

export function serializeLeadActivityTimestampsForApi<T extends Record<string, unknown>>(
  row: T
): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of LEAD_ACTIVITY_TIMESTAMP_KEYS) {
    if (key in out && out[key] != null) {
      out[key] = serializeAsIst(out[key] as Date | string);
    }
  }
  return out as T;
}

export function serializeActivityLogTimestampAsIst(
  value: Date | string | null | undefined
): string | null {
  return serializeAsIst(value);
}
