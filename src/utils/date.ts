/**
 * Frontend sends dates in DD-MM-YYYY (day-month-year), e.g. "09-02-2026".
 * This utility parses that format (and YYYY-MM-DD / Date) and returns YYYY-MM-DD for DB/API consistency.
 * Use parseFrontendDate() everywhere we consume date values from the frontend (req.body, entityData, etc.).
 */

const DD_MM_YYYY_REGEX = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const YYYY_MM_DD_REGEX = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Parse a date from the frontend (DD-MM-YYYY) or already ISO-like (YYYY-MM-DD) or Date.
 * Returns YYYY-MM-DD string for storage/API, or null if invalid/missing.
 */
export function parseFrontendDate(
  value: string | Date | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && !(value instanceof Date)) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().split("T")[0];
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // DD-MM-YYYY (frontend format)
  const dmy = trimmed.match(DD_MM_YYYY_REGEX);
  if (dmy) {
    const [, day, month, year] = dmy;
    const d = parseInt(day!, 10);
    const m = parseInt(month!, 10);
    const y = parseInt(year!, 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
      return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // YYYY-MM-DD (already standard)
  const ymd = trimmed.match(YYYY_MM_DD_REGEX);
  if (ymd) {
    const [, year, month, day] = ymd;
    const y = parseInt(year!, 10);
    const m = parseInt(month!, 10);
    const d = parseInt(day!, 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d)
      return null;
    return trimmed.split("T")[0];
  }

  // Fallback: try Date parse (e.g. ISO string)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return null;
}
