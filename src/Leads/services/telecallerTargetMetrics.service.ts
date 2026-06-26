import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { leads } from "../schemas/leads.schema";
import { transferOutcomeInPeriodFilter } from "./leadTransferredAt.service";

export type TelecallerAchievedCounts = {
  transferTargetAchieved: number;
  conversionTargetAchieved: number;
};

/** Month boundaries in IST (YYYY-MM). */
export function getIstMonthRange(monthYear: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthYear.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000+05:30`);
  const end =
    month === 12
      ? new Date(`${year + 1}-01-01T00:00:00.000+05:30`)
      : new Date(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00.000+05:30`);
  return { start, end };
}

export async function getTelecallerAchievedCountsForMonth(
  telecallerId: number,
  monthYear: string
): Promise<TelecallerAchievedCounts> {
  const range = getIstMonthRange(monthYear);
  if (!range) return { transferTargetAchieved: 0, conversionTargetAchieved: 0 };

  const base = and(
    eq(leads.currentTelecallerId, telecallerId),
    eq(leads.isJunk, false)
  );

  const transferFilter = transferOutcomeInPeriodFilter(true, range.start, range.end, {
    endExclusive: true,
  });

  const [row] = await db
    .select({
      transferred: sql<number>`COUNT(*) FILTER (WHERE ${transferFilter})`,
      converted: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${range.start} AND ${leads.convertedAt} < ${range.end} AND (${leads.progressStatus} = 'converted' OR ${leads.assignmentStatus} = 'converted'))`,
    })
    .from(leads)
    .where(base);

  return {
    transferTargetAchieved: Number(row?.transferred ?? 0),
    conversionTargetAchieved: Number(row?.converted ?? 0),
  };
}

export async function getTelecallerAchievedCountsMapForMonth(
  telecallerIds: number[],
  monthYear: string
): Promise<Map<number, TelecallerAchievedCounts>> {
  const map = new Map<number, TelecallerAchievedCounts>();
  if (telecallerIds.length === 0) return map;

  const range = getIstMonthRange(monthYear);
  if (!range) {
    for (const id of telecallerIds) {
      map.set(id, { transferTargetAchieved: 0, conversionTargetAchieved: 0 });
    }
    return map;
  }

  const transferFilter = transferOutcomeInPeriodFilter(true, range.start, range.end, {
    endExclusive: true,
  });

  const rows = await db
    .select({
      telecallerId: leads.currentTelecallerId,
      transferred: sql<number>`COUNT(*) FILTER (WHERE ${transferFilter})`,
      converted: sql<number>`COUNT(*) FILTER (WHERE ${leads.convertedAt} IS NOT NULL AND ${leads.convertedAt} >= ${range.start} AND ${leads.convertedAt} < ${range.end} AND (${leads.progressStatus} = 'converted' OR ${leads.assignmentStatus} = 'converted'))`,
    })
    .from(leads)
    .where(and(inArray(leads.currentTelecallerId, telecallerIds), eq(leads.isJunk, false)))
    .groupBy(leads.currentTelecallerId);

  for (const id of telecallerIds) {
    map.set(id, { transferTargetAchieved: 0, conversionTargetAchieved: 0 });
  }
  for (const row of rows) {
    const id = row.telecallerId != null ? Number(row.telecallerId) : null;
    if (id == null) continue;
    map.set(id, {
      transferTargetAchieved: Number(row.transferred ?? 0),
      conversionTargetAchieved: Number(row.converted ?? 0),
    });
  }
  return map;
}
