import { sql } from "drizzle-orm";
import { db } from "../../config/databaseConnection";
import { leads } from "../schemas/leads.schema";
import { users } from "../../schemas/users.schema";
import { indianPeriodBounds } from "../../utils/istTime";

export type LeadReportParams = {
  createdFrom?: Date;
  createdTo?: Date;
};

export type LeadReportStats = {
  summary: {
    assigned: number;
    unassigned: number;
    contacted: number;
    notContacted: number;
    transferred: number;
    converted: number;
    dropped: number;
    pendingFollowUp: number;
    junk: number;
  };
  telecallerStats: Array<{
    id: number;
    name: string;
    assigned: number;
    transferred: number;
    converted: number;
    dropped: number;
    totalFollowUp: number;
    pendingFollowUp: number;
    junk: number;
  }>;
  counsellorBreakdown: Array<{
    id: number;
    name: string;
    received: number;
    converted: number;
    dropped: number;
    pending: number;
  }>;
  sourceBreakdown: Array<{
    source: string;
    assigned: number;
    transferred: number;
    converted: number;
    dropped: number;
  }>;
  typeBreakdown: Array<{
    type: string;
    assigned: number;
    transferred: number;
    converted: number;
    dropped: number;
  }>;
};

const n = (v: unknown) => Number(v ?? 0);

export async function getAdminLeadReportStats(
  params: LeadReportParams
): Promise<LeadReportStats> {
  // Convert UTC instants to naive IST wall-clock Dates for `timestamp without time zone` comparison.
  const { from: naiveFrom, to: naiveTo } = indianPeriodBounds(params.createdFrom, params.createdTo);
  const createdFrom = naiveFrom;
  const createdTo = naiveTo;
  const hp = Boolean(createdFrom && createdTo);

  const [summaryRow, teleCreation, teleOutcome, counsRows, sourceRows, typeRows, teleNames, counsNames] =
    await Promise.all([
      // ── 1. Summary ───────────────────────────────────────────────────────────
      db
        .select({
          assigned: hp
            ? sql<number>`COUNT(*) FILTER (WHERE created_at >= ${createdFrom} AND created_at <= ${createdTo} AND assignment_status != 'not_assigned')`
            : sql<number>`COUNT(*) FILTER (WHERE assignment_status != 'not_assigned')`,
          unassigned: hp
            ? sql<number>`COUNT(*) FILTER (WHERE created_at >= ${createdFrom} AND created_at <= ${createdTo} AND assignment_status = 'not_assigned')`
            : sql<number>`COUNT(*) FILTER (WHERE assignment_status = 'not_assigned')`,
          contacted: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND created_at >= ${createdFrom} AND created_at <= ${createdTo} AND (progress_status IN ('contacted','follow_up') OR assignment_status IN ('transferred','converted','dropped')))`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND (progress_status IN ('contacted','follow_up') OR assignment_status IN ('transferred','converted','dropped')))`,
          notContacted: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'not_contacted' AND created_at >= ${createdFrom} AND created_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'not_contacted')`,
          pendingFollowUp: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'follow_up' AND created_at >= ${createdFrom} AND created_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'follow_up')`,
          junk: hp
            ? sql<number>`COUNT(*) FILTER (WHERE (is_junk OR progress_status = 'junk') AND created_at >= ${createdFrom} AND created_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE is_junk OR progress_status = 'junk')`,
          transferred: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND transferred_at IS NOT NULL)`,
          converted: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${createdFrom} AND converted_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL)`,
          dropped: hp
            ? sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${createdFrom} AND dropped_at <= ${createdTo})`
            : sql<number>`COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL)`,
        })
        .from(leads),

      // ── 2. Telecaller creation stats (current_telecaller_id scoped) ──────────
      db.execute<{
        tele_id: number;
        assigned: number;
        total_follow_up: number;
        pending_follow_up: number;
        junk: number;
      }>(
        hp
          ? sql`
              SELECT current_telecaller_id AS tele_id,
                COUNT(*) FILTER (WHERE created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND next_followup_at IS NOT NULL AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS total_follow_up,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'follow_up' AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS pending_follow_up,
                COUNT(*) FILTER (WHERE (is_junk OR progress_status = 'junk') AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS junk
              FROM leads
              WHERE current_telecaller_id IS NOT NULL
              GROUP BY current_telecaller_id
            `
          : sql`
              SELECT current_telecaller_id AS tele_id,
                COUNT(*) AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND next_followup_at IS NOT NULL) AS total_follow_up,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status = 'follow_up') AS pending_follow_up,
                COUNT(*) FILTER (WHERE is_junk OR progress_status = 'junk') AS junk
              FROM leads
              WHERE current_telecaller_id IS NOT NULL
              GROUP BY current_telecaller_id
            `
      ),

      // ── 3. Telecaller outcome stats ───────────────────────────────────────────
      // Requires both current_telecaller_id AND current_counsellor_id.
      // All three outcome statuses use transferred_at for the period filter.
      db.execute<{
        tele_id: number;
        transferred: number;
        converted: number;
        dropped: number;
      }>(
        hp
          ? sql`
              SELECT current_telecaller_id AS tele_id,
                COUNT(*) FILTER (WHERE assignment_status IN ('transferred','converted','dropped') AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo}) AS transferred,
                COUNT(*) FILTER (WHERE assignment_status = 'converted' AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo}) AS converted,
                COUNT(*) FILTER (WHERE assignment_status = 'dropped' AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo}) AS dropped
              FROM leads
              WHERE NOT is_junk
                AND current_telecaller_id IS NOT NULL
                AND current_counsellor_id IS NOT NULL
              GROUP BY current_telecaller_id
            `
          : sql`
              SELECT current_telecaller_id AS tele_id,
                COUNT(*) FILTER (WHERE assignment_status IN ('transferred','converted','dropped') AND transferred_at IS NOT NULL) AS transferred,
                COUNT(*) FILTER (WHERE assignment_status = 'converted' AND transferred_at IS NOT NULL) AS converted,
                COUNT(*) FILTER (WHERE assignment_status = 'dropped' AND transferred_at IS NOT NULL) AS dropped
              FROM leads
              WHERE NOT is_junk
                AND current_telecaller_id IS NOT NULL
                AND current_counsellor_id IS NOT NULL
              GROUP BY current_telecaller_id
            `
      ),

      // ── 4. Counsellor breakdown ───────────────────────────────────────────────
      db.execute<{
        couns_id: number;
        received: number;
        converted: number;
        dropped: number;
        pending: number;
      }>(
        hp
          ? sql`
              SELECT current_counsellor_id AS couns_id,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS received,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${createdFrom} AND converted_at <= ${createdTo}) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${createdFrom} AND dropped_at <= ${createdTo}) AS dropped,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND created_at >= ${createdFrom} AND created_at <= ${createdTo} AND assignment_status NOT IN ('converted','dropped')) AS pending
              FROM leads
              WHERE current_counsellor_id IS NOT NULL
              GROUP BY current_counsellor_id
            `
          : sql`
              SELECT current_counsellor_id AS couns_id,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk') AS received,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL) AS dropped,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND assignment_status NOT IN ('converted','dropped')) AS pending
              FROM leads
              WHERE current_counsellor_id IS NOT NULL
              GROUP BY current_counsellor_id
            `
      ),

      // ── 5. Source breakdown ───────────────────────────────────────────────────
      db.execute<{
        source: string;
        assigned: number;
        transferred: number;
        converted: number;
        dropped: number;
      }>(
        hp
          ? sql`
              SELECT COALESCE(lead_source, 'Unknown') AS source,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo}) AS transferred,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${createdFrom} AND converted_at <= ${createdTo}) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${createdFrom} AND dropped_at <= ${createdTo}) AS dropped
              FROM leads
              GROUP BY COALESCE(lead_source, 'Unknown')
              ORDER BY assigned DESC
            `
          : sql`
              SELECT COALESCE(lead_source, 'Unknown') AS source,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk') AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND transferred_at IS NOT NULL) AS transferred,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL) AS dropped
              FROM leads
              GROUP BY COALESCE(lead_source, 'Unknown')
              ORDER BY assigned DESC
            `
      ),

      // ── 6. Type breakdown ─────────────────────────────────────────────────────
      db.execute<{
        type: string;
        assigned: number;
        transferred: number;
        converted: number;
        dropped: number;
      }>(
        hp
          ? sql`
              SELECT COALESCE(lead_type, 'Unknown') AS type,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk' AND created_at >= ${createdFrom} AND created_at <= ${createdTo}) AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND transferred_at IS NOT NULL AND transferred_at >= ${createdFrom} AND transferred_at <= ${createdTo}) AS transferred,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL AND converted_at >= ${createdFrom} AND converted_at <= ${createdTo}) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL AND dropped_at >= ${createdFrom} AND dropped_at <= ${createdTo}) AS dropped
              FROM leads
              GROUP BY COALESCE(lead_type, 'Unknown')
              ORDER BY assigned DESC
            `
          : sql`
              SELECT COALESCE(lead_type, 'Unknown') AS type,
                COUNT(*) FILTER (WHERE NOT is_junk AND progress_status != 'junk') AS assigned,
                COUNT(*) FILTER (WHERE NOT is_junk AND transferred_at IS NOT NULL) AS transferred,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'converted' AND converted_at IS NOT NULL) AS converted,
                COUNT(*) FILTER (WHERE NOT is_junk AND assignment_status = 'dropped' AND dropped_at IS NOT NULL) AS dropped
              FROM leads
              GROUP BY COALESCE(lead_type, 'Unknown')
              ORDER BY assigned DESC
            `
      ),

      // ── 7. Telecaller names ───────────────────────────────────────────────────
      db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(sql`${users.role} = 'telecaller'`),

      // ── 8. Counsellor names ───────────────────────────────────────────────────
      db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(sql`${users.role} = 'counsellor'`),
    ]);

  const sr = summaryRow[0];

  // ── Merge telecaller creation + outcome rows ──
  const teleCreationMap = new Map<number, (typeof teleCreation.rows)[number]>(
    teleCreation.rows.map((r) => [Number(r.tele_id), r])
  );
  const teleOutcomeMap = new Map<number, (typeof teleOutcome.rows)[number]>(
    teleOutcome.rows.map((r) => [Number(r.tele_id), r])
  );
  const allTeleIds = new Set([...teleCreationMap.keys(), ...teleOutcomeMap.keys()]);

  const teleNameMap = new Map(teleNames.map((u) => [u.id, u.name]));
  const telecallerStats = Array.from(allTeleIds)
    .map((id) => {
      const cr = teleCreationMap.get(id);
      const or = teleOutcomeMap.get(id);
      const transferred = n(or?.transferred);
      const converted = n(or?.converted);
      const dropped = n(or?.dropped);
      if (!cr && transferred === 0 && converted === 0 && dropped === 0) return null;
      return {
        id,
        name: teleNameMap.get(id) ?? `Telecaller #${id}`,
        assigned: n(cr?.assigned),
        transferred,
        converted,
        dropped,
        totalFollowUp: n(cr?.total_follow_up),
        pendingFollowUp: n(cr?.pending_follow_up),
        junk: n(cr?.junk),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b!.transferred - a!.transferred ||
        b!.converted - a!.converted ||
        b!.assigned - a!.assigned
    ) as LeadReportStats["telecallerStats"];

  // ── Merge counsellor rows ──
  const counsNameMap = new Map(counsNames.map((u) => [u.id, u.name]));
  const counsellorBreakdown = counsRows.rows
    .map((r) => {
      const received = n(r.received);
      if (received === 0) return null;
      return {
        id: Number(r.couns_id),
        name: counsNameMap.get(Number(r.couns_id)) ?? `Counsellor #${r.couns_id}`,
        received,
        converted: n(r.converted),
        dropped: n(r.dropped),
        pending: n(r.pending),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.received - a!.received) as LeadReportStats["counsellorBreakdown"];

  return {
    summary: {
      assigned: n(sr?.assigned),
      unassigned: n(sr?.unassigned),
      contacted: n(sr?.contacted),
      notContacted: n(sr?.notContacted),
      transferred: n(sr?.transferred),
      converted: n(sr?.converted),
      dropped: n(sr?.dropped),
      pendingFollowUp: n(sr?.pendingFollowUp),
      junk: n(sr?.junk),
    },
    telecallerStats,
    counsellorBreakdown,
    sourceBreakdown: sourceRows.rows
      .filter((r) => n(r.assigned) > 0 || n(r.transferred) > 0)
      .map((r) => ({
        source: String(r.source),
        assigned: n(r.assigned),
        transferred: n(r.transferred),
        converted: n(r.converted),
        dropped: n(r.dropped),
      })),
    typeBreakdown: typeRows.rows
      .filter((r) => n(r.assigned) > 0 || n(r.transferred) > 0)
      .map((r) => ({
        type: String(r.type),
        assigned: n(r.assigned),
        transferred: n(r.transferred),
        converted: n(r.converted),
        dropped: n(r.dropped),
      })),
  };
}
