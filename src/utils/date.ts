/**
 * Frontend sends dates in DD-MM-YYYY or DD/MM/YYYY (day-month-year).
 * Returns YYYY-MM-DD for PostgreSQL `date` columns.
 */

const DD_MM_YYYY_REGEX = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const DD_MM_YYYY_SLASH_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const YYYY_MM_DD_REGEX = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

function toYmdString(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDmyParts(day: string, month: string, year: string): string | null {
  return toYmdString(parseInt(day, 10), parseInt(month, 10), parseInt(year, 10));
}

/**
 * Parse a date from the frontend (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) or Date.
 * Returns YYYY-MM-DD string for storage/API, or null if invalid/missing.
 */
export function parseFrontendDate(
  value: string | Date | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && !(value instanceof Date)) return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return toYmdString(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate()
    );
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const dmyHyphen = trimmed.match(DD_MM_YYYY_REGEX);
  if (dmyHyphen) {
    const [, day, month, year] = dmyHyphen;
    return parseDmyParts(day!, month!, year!);
  }

  const dmySlash = trimmed.match(DD_MM_YYYY_SLASH_REGEX);
  if (dmySlash) {
    const [, day, month, year] = dmySlash;
    return parseDmyParts(day!, month!, year!);
  }

  const ymd = trimmed.match(YYYY_MM_DD_REGEX);
  if (ymd) {
    const [, year, month, day] = ymd;
    return parseDmyParts(day!, month!, year!);
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return toYmdString(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate()
    );
  }
  return null;
}

/** Normalize lead DOB (or empty) to YYYY-MM-DD for DB; throws on invalid input. */
export function normalizeDateOfBirthForDb(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = parseFrontendDate(value);
  if (!parsed) {
    throw new Error("Invalid date of birth (use DD/MM/YYYY or DD-MM-YYYY)");
  }
  return parsed;
}

/** Normalize a DB `date` column or API string to YYYY-MM-DD for comparisons. */
export function normalizeDbDate(
  value: string | Date | null | undefined
): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return parseFrontendDate(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const datePart = trimmed.split("T")[0] ?? trimmed;
  if (YYYY_MM_DD_REGEX.test(datePart)) {
    return datePart;
  }
  return parseFrontendDate(trimmed);
}
