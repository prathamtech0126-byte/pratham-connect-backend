import { sql } from "drizzle-orm";
import { db } from "../../config/databaseConnection";

const dateRangeSql = (createdFrom?: Date, createdTo?: Date) => sql`
  ${createdFrom ? sql`AND created_at >= ${createdFrom}` : sql``}
  ${createdTo ? sql`AND created_at <= ${createdTo}` : sql``}
`;

export type TelecallerReportStats = {
  assigned: number;
  contacted: number;
  notContacted: number;
  transferred: number;
  converted: number;
  pendingFollowUp: number;
  junk: number;
};

export type TelecallerCategoryBreakdownRow = {
  type: string;
  assigned: number;
  transferred: number;
  converted: number;
  junk: number;
};

export type TelecallerSourceBreakdownRow = {
  source: string;
  assigned: number;
  transferred: number;
  converted: number;
};

export type TelecallerCounsellorBreakdownRow = {
  counsellorId: number;
  received: number;
  converted: number;
  dropped: number;
};

export type CounsellorReportStats = {
  total: number;
  inProgress: number;
  followUp: number;
  converted: number;
  dropped: number;
  notContacted: number;
  contacted: number;
};

export type CounsellorTypeBreakdownRow = {
  type: string;
  assigned: number;
  converted: number;
  dropped: number;
};

export type CounsellorSourceBreakdownRow = {
  source: string;
  assigned: number;
  converted: number;
  dropped: number;
};

const num = (r: Record<string, unknown>, camel: string, snake: string) =>
  Number(r[camel] ?? r[snake] ?? 0);

const mapRows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
};

export const getTelecallerIndividualReport = async (
  telecallerId: number,
  createdFrom?: Date,
  createdTo?: Date
) => {
  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE NOT is_junk)::int AS "assigned",
      COUNT(*) FILTER (
        WHERE NOT is_junk
        AND progress_status IN ('contacted', 'follow_up', 'converted')
      )::int AS "contacted",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'not_contacted'
      )::int AS "notContacted",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status IN ('transferred', 'dropped')
      )::int AS "transferred",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status = 'converted'
      )::int AS "converted",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'follow_up'
      )::int AS "pendingFollowUp",
      COUNT(*) FILTER (
        WHERE is_junk OR progress_status = 'junk'
      )::int AS "junk"
    FROM leads
    WHERE current_telecaller_id = ${telecallerId}
    ${dateRangeSql(createdFrom, createdTo)}
  `);

  const statsRow = mapRows(statsResult)[0] ?? {};
  const stats: TelecallerReportStats = {
    assigned: num(statsRow, "assigned", "assigned"),
    contacted: num(statsRow, "contacted", "contacted"),
    notContacted: num(statsRow, "notContacted", "notcontacted"),
    transferred: num(statsRow, "transferred", "transferred"),
    converted: num(statsRow, "converted", "converted"),
    pendingFollowUp: num(statsRow, "pendingFollowUp", "pendingfollowup"),
    junk: num(statsRow, "junk", "junk"),
  };

  const categoryResult = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(lead_type), ''), 'Unknown') AS "type",
      COUNT(*)::int AS "assigned",
      COUNT(*) FILTER (WHERE assignment_status IN ('transferred', 'dropped'))::int AS "transferred",
      COUNT(*) FILTER (WHERE assignment_status = 'converted')::int AS "converted",
      COUNT(*) FILTER (WHERE is_junk OR progress_status = 'junk')::int AS "junk"
    FROM leads
    WHERE current_telecaller_id = ${telecallerId}
    ${dateRangeSql(createdFrom, createdTo)}
    GROUP BY COALESCE(NULLIF(TRIM(lead_type), ''), 'Unknown')
    ORDER BY "assigned" DESC
  `);

  const sourceResult = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(lead_source), ''), 'Unknown') AS "source",
      COUNT(*)::int AS "assigned",
      COUNT(*) FILTER (WHERE assignment_status IN ('transferred', 'dropped'))::int AS "transferred",
      COUNT(*) FILTER (WHERE assignment_status = 'converted')::int AS "converted"
    FROM leads
    WHERE current_telecaller_id = ${telecallerId}
    ${dateRangeSql(createdFrom, createdTo)}
    GROUP BY COALESCE(NULLIF(TRIM(lead_source), ''), 'Unknown')
    ORDER BY "assigned" DESC
  `);

  const counsellorResult = await db.execute(sql`
    SELECT
      current_counsellor_id::int AS "counsellorId",
      COUNT(*)::int AS "received",
      COUNT(*) FILTER (WHERE assignment_status = 'converted')::int AS "converted",
      COUNT(*) FILTER (WHERE assignment_status = 'dropped')::int AS "dropped"
    FROM leads
    WHERE current_telecaller_id = ${telecallerId}
      AND current_counsellor_id IS NOT NULL
    ${dateRangeSql(createdFrom, createdTo)}
    GROUP BY current_counsellor_id
    ORDER BY "received" DESC
  `);

  const categoryBreakdown: TelecallerCategoryBreakdownRow[] = mapRows(categoryResult).map((r) => ({
    type: String(r.type ?? "Unknown"),
    assigned: num(r, "assigned", "assigned"),
    transferred: num(r, "transferred", "transferred"),
    converted: num(r, "converted", "converted"),
    junk: num(r, "junk", "junk"),
  }));

  const sourceBreakdown: TelecallerSourceBreakdownRow[] = mapRows(sourceResult).map((r) => ({
    source: String(r.source ?? "Unknown"),
    assigned: num(r, "assigned", "assigned"),
    transferred: num(r, "transferred", "transferred"),
    converted: num(r, "converted", "converted"),
  }));

  const counsellorBreakdown: TelecallerCounsellorBreakdownRow[] = mapRows(counsellorResult).map((r) => ({
    counsellorId: Number(r.counsellorId ?? r.counsellor_id ?? 0),
    received: num(r, "received", "received"),
    converted: num(r, "converted", "converted"),
    dropped: num(r, "dropped", "dropped"),
  }));

  return { stats, categoryBreakdown, sourceBreakdown, counsellorBreakdown };
};

export const getCounsellorIndividualReport = async (
  counsellorId: number,
  createdFrom?: Date,
  createdTo?: Date
) => {
  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE NOT is_junk)::int AS "total",
      COUNT(*) FILTER (
        WHERE NOT is_junk
        AND assignment_status NOT IN ('converted', 'dropped')
        AND progress_status NOT IN ('follow_up', 'converted', 'junk')
      )::int AS "inProgress",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'follow_up'
      )::int AS "followUp",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status = 'converted'
      )::int AS "converted",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND assignment_status = 'dropped'
      )::int AS "dropped",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'not_contacted'
      )::int AS "notContacted",
      COUNT(*) FILTER (
        WHERE NOT is_junk AND progress_status = 'contacted'
      )::int AS "contacted"
    FROM leads
    WHERE current_counsellor_id = ${counsellorId}
    ${dateRangeSql(createdFrom, createdTo)}
  `);

  const statsRow = mapRows(statsResult)[0] ?? {};
  const stats: CounsellorReportStats = {
    total: num(statsRow, "total", "total"),
    inProgress: num(statsRow, "inProgress", "inprogress"),
    followUp: num(statsRow, "followUp", "followup"),
    converted: num(statsRow, "converted", "converted"),
    dropped: num(statsRow, "dropped", "dropped"),
    notContacted: num(statsRow, "notContacted", "notcontacted"),
    contacted: num(statsRow, "contacted", "contacted"),
  };

  const typeResult = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(lead_type), ''), 'Unknown') AS "type",
      COUNT(*)::int AS "assigned",
      COUNT(*) FILTER (WHERE assignment_status = 'converted')::int AS "converted",
      COUNT(*) FILTER (WHERE assignment_status = 'dropped')::int AS "dropped"
    FROM leads
    WHERE current_counsellor_id = ${counsellorId}
    ${dateRangeSql(createdFrom, createdTo)}
    GROUP BY COALESCE(NULLIF(TRIM(lead_type), ''), 'Unknown')
    ORDER BY "assigned" DESC
  `);

  const sourceResult = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(lead_source), ''), 'Unknown') AS "source",
      COUNT(*)::int AS "assigned",
      COUNT(*) FILTER (WHERE assignment_status = 'converted')::int AS "converted",
      COUNT(*) FILTER (WHERE assignment_status = 'dropped')::int AS "dropped"
    FROM leads
    WHERE current_counsellor_id = ${counsellorId}
    ${dateRangeSql(createdFrom, createdTo)}
    GROUP BY COALESCE(NULLIF(TRIM(lead_source), ''), 'Unknown')
    ORDER BY "assigned" DESC
  `);

  const typeBreakdown: CounsellorTypeBreakdownRow[] = mapRows(typeResult).map((r) => ({
    type: String(r.type ?? "Unknown"),
    assigned: num(r, "assigned", "assigned"),
    converted: num(r, "converted", "converted"),
    dropped: num(r, "dropped", "dropped"),
  }));

  const sourceBreakdown: CounsellorSourceBreakdownRow[] = mapRows(sourceResult).map((r) => ({
    source: String(r.source ?? "Unknown"),
    assigned: num(r, "assigned", "assigned"),
    converted: num(r, "converted", "converted"),
    dropped: num(r, "dropped", "dropped"),
  }));

  return { stats, typeBreakdown, sourceBreakdown };
};
