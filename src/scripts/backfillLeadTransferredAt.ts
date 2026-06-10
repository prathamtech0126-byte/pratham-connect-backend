/**
 * Backfill leads.transferred_at from lead_activities (activity_type = 'counselor_assign').
 *
 * Before transferred_at existed, transfers were only recorded as counselor_assign activities.
 * Migration 0020 used leads.updated_at as a fallback — this script sets the real transfer time
 * from the latest counselor_assign activity per lead.
 *
 * Usage:
 *   npx ts-node src/scripts/backfillLeadTransferredAt.ts           # dry-run (preview only)
 *   npx ts-node src/scripts/backfillLeadTransferredAt.ts --apply   # write to DB
 *   npx ts-node src/scripts/backfillLeadTransferredAt.ts --apply --lead-id=123
 */
import "dotenv/config";
import { pool } from "../config/databaseConnection";

const ACTIVITY_TYPE = "counselor_assign";

type StatsRow = {
  leads_with_counselor_assign: string;
  needs_update: string;
  already_correct: string;
  null_before: string;
};

type PreviewRow = {
  lead_id: string;
  assignment_status: string;
  current_transferred_at: Date | null;
  activity_transferred_at: Date;
  activity_count: string;
};

function parseLeadIdArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--lead-id="));
  if (!arg) return null;
  const id = Number(arg.split("=")[1]);
  return Number.isFinite(id) ? id : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const leadId = parseLeadIdArg();

  console.log(
    apply
      ? "=== APPLY: backfill leads.transferred_at from lead_activities ==="
      : "=== DRY RUN: preview only (pass --apply to write) ===",
  );
  console.log(`Activity type: ${ACTIVITY_TYPE}`);
  if (leadId != null) console.log(`Filter: lead_id = ${leadId}`);
  console.log("");

  const leadFilter = leadId != null ? "AND la.lead_id = $1" : "";
  const params = leadId != null ? [leadId] : [];

  const { rows: statsRows } = await pool.query<StatsRow>(
    `
    WITH latest_transfer AS (
      SELECT
        la.lead_id,
        MAX(la.created_at) AS transferred_at,
        COUNT(*)::int AS activity_count
      FROM lead_activities la
      WHERE la.activity_type = $${leadId != null ? 2 : 1}
        ${leadFilter}
      GROUP BY la.lead_id
    )
    SELECT
      COUNT(*)::text AS leads_with_counselor_assign,
      COUNT(*) FILTER (
        WHERE l.transferred_at IS DISTINCT FROM lt.transferred_at
      )::text AS needs_update,
      COUNT(*) FILTER (
        WHERE l.transferred_at IS NOT DISTINCT FROM lt.transferred_at
      )::text AS already_correct,
      COUNT(*) FILTER (WHERE l.transferred_at IS NULL)::text AS null_before
    FROM latest_transfer lt
    INNER JOIN leads l ON l.id = lt.lead_id
    `,
    leadId != null ? [leadId, ACTIVITY_TYPE] : [ACTIVITY_TYPE],
  );

  const stats = statsRows[0];
  console.log("Summary:");
  console.log(`  Leads with ${ACTIVITY_TYPE} activity: ${stats.leads_with_counselor_assign}`);
  console.log(`  transferred_at already matches activity:  ${stats.already_correct}`);
  console.log(`  transferred_at currently NULL:            ${stats.null_before}`);
  console.log(`  Will update (mismatch or NULL):           ${stats.needs_update}`);
  console.log("");

  const { rows: preview } = await pool.query<PreviewRow>(
    `
    WITH latest_transfer AS (
      SELECT
        la.lead_id,
        MAX(la.created_at) AS transferred_at,
        COUNT(*)::int AS activity_count
      FROM lead_activities la
      WHERE la.activity_type = $${leadId != null ? 2 : 1}
        ${leadFilter}
      GROUP BY la.lead_id
    )
    SELECT
      l.id::text AS lead_id,
      l.assignment_status,
      l.transferred_at AS current_transferred_at,
      lt.transferred_at AS activity_transferred_at,
      lt.activity_count::text AS activity_count
    FROM latest_transfer lt
    INNER JOIN leads l ON l.id = lt.lead_id
    WHERE l.transferred_at IS DISTINCT FROM lt.transferred_at
    ORDER BY lt.transferred_at DESC
    LIMIT 25
    `,
    leadId != null ? [leadId, ACTIVITY_TYPE] : [ACTIVITY_TYPE],
  );

  if (preview.length === 0) {
    console.log("No leads need updating.");
  } else {
    console.log(`Sample of up to 25 leads to update (${preview.length} shown):`);
    for (const row of preview) {
      console.log(
        `  lead #${row.lead_id} [${row.assignment_status}] ` +
          `${row.activity_count} activity(ies) → ` +
          `${row.current_transferred_at?.toISOString() ?? "NULL"} → ${row.activity_transferred_at.toISOString()}`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to update the database.");
    await pool.end();
    process.exit(0);
  }

  const { rowCount } = await pool.query(
    `
    UPDATE leads l
    SET transferred_at = lt.transferred_at
    FROM (
      SELECT
        la.lead_id,
        MAX(la.created_at) AS transferred_at
      FROM lead_activities la
      WHERE la.activity_type = $${leadId != null ? 2 : 1}
        ${leadFilter}
      GROUP BY la.lead_id
    ) lt
    WHERE l.id = lt.lead_id
      AND l.transferred_at IS DISTINCT FROM lt.transferred_at
    `,
    leadId != null ? [leadId, ACTIVITY_TYPE] : [ACTIVITY_TYPE],
  );

  console.log(`\n✓ Updated ${rowCount ?? 0} lead(s).`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
