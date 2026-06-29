/**
 * Resolve lead date filters (today / weekly / monthly / custom) to UTC instants
 * for timestamptz DB comparison. Calendar bounds use CRM business timezone (IST).
 */

import { CRM_TIMEZONE } from "../../modules/time/constants";

export type LeadDateFilterPreset = "all" | "today" | "weekly" | "monthly" | "custom";

export type ResolvedLeadDateRange = {
  createdFrom?: Date;
  createdTo?: Date;
};

const PRESET_FILTERS = new Set<LeadDateFilterPreset>([
  "all",
  "today",
  "weekly",
  "monthly",
  "custom",
]);

function calendarYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TIMEZONE }).format(date);
}

function tzOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - at.getTime()) / 60_000;
}

function wallClockToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second: number,
  ms: number
): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, hour, minute, second, ms);
  const offsetMin = tzOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offsetMin * 60_000);
}

function inclusiveDayRange(fromYmd: string, toYmd: string): ResolvedLeadDateRange {
  return {
    createdFrom: wallClockToUtc(fromYmd, 0, 0, 0, 0),
    createdTo: wallClockToUtc(toYmd, 23, 59, 59, 999),
  };
}

function weekdayIndex(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: CRM_TIMEZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? 0;
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function normalizeYmd(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes("T")) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return calendarYmd(d);
  }
  return undefined;
}

function parsePresetFilter(query: Record<string, unknown>): LeadDateFilterPreset | undefined {
  const raw = query.dateFilter;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const normalized = raw.trim().toLowerCase() as LeadDateFilterPreset;
  return PRESET_FILTERS.has(normalized) ? normalized : undefined;
}

function parseExplicitIsoRange(query: Record<string, unknown>): ResolvedLeadDateRange | null {
  const fromRaw = query.createdFrom ?? query.created_from;
  const toRaw = query.createdTo ?? query.created_to;
  if (!fromRaw || !toRaw) return null;
  const createdFrom = new Date(String(fromRaw));
  const createdTo = new Date(String(toRaw));
  if (isNaN(createdFrom.getTime()) || isNaN(createdTo.getTime())) return null;
  return { createdFrom, createdTo };
}

function presetRange(
  filter: LeadDateFilterPreset,
  query: Record<string, unknown>
): ResolvedLeadDateRange {
  if (filter === "all") return {};

  const now = new Date();
  const todayYmd = calendarYmd(now);

  if (filter === "today") {
    return inclusiveDayRange(todayYmd, todayYmd);
  }

  if (filter === "weekly") {
    const dow = weekdayIndex(now);
    const mondayDelta = dow === 0 ? -6 : 1 - dow;
    const mondayYmd = addCalendarDaysYmd(todayYmd, mondayDelta);
    const sundayYmd = addCalendarDaysYmd(mondayYmd, 6);
    return inclusiveDayRange(mondayYmd, sundayYmd);
  }

  if (filter === "monthly") {
    const [yStr, mStr] = todayYmd.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const firstYmd = `${yStr}-${mStr}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastYmd = `${yStr}-${mStr.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return inclusiveDayRange(firstYmd, lastYmd);
  }

  const afterRaw =
    query.afterDate ?? query.after_date ?? query.customDateFrom ?? query.custom_date_from;
  const beforeRaw =
    query.beforeDate ?? query.before_date ?? query.customDateTo ?? query.custom_date_to;
  const fromYmd = typeof afterRaw === "string" ? normalizeYmd(afterRaw) : undefined;
  const toYmd = typeof beforeRaw === "string" ? normalizeYmd(beforeRaw) : undefined;
  if (!fromYmd || !toYmd) return {};
  return inclusiveDayRange(fromYmd, toYmd);
}

/**
 * Resolve `createdFrom` / `createdTo` from `dateFilter` (+ optional `afterDate`/`beforeDate`).
 * Legacy explicit `createdFrom`/`createdTo` ISO pair is still accepted.
 */
export function resolveLeadDateRangeFromQuery(
  query: Record<string, unknown>
): ResolvedLeadDateRange {
  const explicit = parseExplicitIsoRange(query);
  if (explicit) return explicit;

  const preset = parsePresetFilter(query);
  if (preset) return presetRange(preset, query);

  const afterRaw = query.afterDate ?? query.after_date;
  const beforeRaw = query.beforeDate ?? query.before_date;
  if (typeof afterRaw === "string" && typeof beforeRaw === "string") {
    return presetRange("custom", query);
  }

  return {};
}
