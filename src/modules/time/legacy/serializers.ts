import {
  formatPgNaiveTimestampForDisplay,
  serializePgNaiveTimestampAsIst,
} from "./pgNaiveIst";

function formatInstantToIstOffsetString(instant: Date): string | null {
  if (isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
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
    return `${base}.${String(ms).padStart(3, "0")}+05:30`;
  }
  return `${base}+05:30`;
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

function getActivityLogLegacyUtcCutoffMs(): number {
  const raw = process.env.ACTIVITY_LOG_LEGACY_UTC_CUTOFF?.trim();
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return new Date("2026-06-01T00:00:00+05:30").getTime();
}

export function serializeActivityLogTimestampAsIst(
  value: Date | string | null | undefined,
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

export function serializeLeadActivityTimestampsForApi<T extends Record<string, unknown>>(
  row: T,
): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of LEAD_ACTIVITY_TIMESTAMP_KEYS) {
    if (key in out && out[key] != null) {
      out[key] = serializePgNaiveTimestampAsIst(out[key] as Date | string);
    }
  }
  return out as T;
}

export { formatPgNaiveTimestampForDisplay };
