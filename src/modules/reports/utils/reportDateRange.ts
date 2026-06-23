import type { BackendDashboardFilter } from "../constants/backendDashboard.constants";

export type ReportDateRange = {
  fromDate: string;
  toDate: string;
};

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, "0");

export const toDateStr = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseLocalDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const isValidDateStr = (value: string): boolean => {
  if (!YYYY_MM_DD.test(value)) return false;
  const date = parseLocalDate(value);
  return !Number.isNaN(date.getTime());
};

export const resolveReportDateRange = (
  filter: BackendDashboardFilter,
  fromDate?: string,
  toDate?: string
): ReportDateRange => {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  let start: Date;
  let end: Date = endOfToday;

  switch (filter) {
    case "today":
      start = new Date(today);
      end = new Date(endOfToday);
      break;
    case "weekly": {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      start = new Date(now);
      start.setDate(now.getDate() - diffToMonday);
      start.setHours(0, 0, 0, 0);

      const weekEndSunday = new Date(start);
      weekEndSunday.setDate(start.getDate() + 6);
      weekEndSunday.setHours(23, 59, 59, 999);
      end =
        weekEndSunday.getTime() > endOfToday.getTime()
          ? new Date(endOfToday)
          : weekEndSunday;
      break;
    }
    case "monthly":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "custom": {
      if (!fromDate || !toDate) {
        throw new Error("Custom filter requires fromDate and toDate (YYYY-MM-DD).");
      }
      if (!isValidDateStr(fromDate) || !isValidDateStr(toDate)) {
        throw new Error("fromDate and toDate must be valid dates in YYYY-MM-DD format.");
      }
      const startDate = parseLocalDate(fromDate);
      const endDate = parseLocalDate(toDate);
      if (startDate > endDate) {
        throw new Error("fromDate must be on or before toDate.");
      }
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      start = startDate;
      end = endDate;
      break;
    }
    default: {
      const exhaustive: never = filter;
      throw new Error(`Unsupported filter: ${String(exhaustive)}`);
    }
  }

  return {
    fromDate: toDateStr(start),
    toDate: toDateStr(end),
  };
};

/** Previous period of equal length immediately before the given range. */
export const resolvePreviousReportPeriod = (
  period: ReportDateRange
): ReportDateRange => {
  const start = parseLocalDate(period.fromDate);
  const end = parseLocalDate(period.toDate);
  const dayMs = 24 * 60 * 60 * 1000;
  const lengthDays =
    Math.round((end.getTime() - start.getTime()) / dayMs) + 1;

  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);

  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (lengthDays - 1));

  return {
    fromDate: toDateStr(prevStart),
    toDate: toDateStr(prevEnd),
  };
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const dayLabelForDate = (dateStr: string): string => {
  const date = parseLocalDate(dateStr);
  return DAY_LABELS[date.getDay()] ?? dateStr;
};

/** Inclusive list of YYYY-MM-DD strings from fromDate through toDate. */
export const enumerateDateRange = (period: ReportDateRange): string[] => {
  const dates: string[] = [];
  const cursor = parseLocalDate(period.fromDate);
  const end = parseLocalDate(period.toDate);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};
