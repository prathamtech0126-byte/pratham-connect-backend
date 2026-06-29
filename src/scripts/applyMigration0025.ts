import "dotenv/config";
import { db, pool } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

/**
 * Migration 0025: naive IST wall-clock columns → timestamptz (UTC storage).
 *
 * Old data was stored as `timestamp without time zone` meaning India local time
 * (Asia/Kolkata). PostgreSQL converts each value to UTC on alter:
 *
 *   '2026-06-01 12:49:00' (IST wall) → '2026-06-01 07:19:00+00' (UTC)
 *
 * Safe to re-run: columns already `timestamptz` are skipped.
 */
const IST_ZONE = "Asia/Kolkata";

type ColumnTarget = { table: string; column: string; notNullDefault?: boolean };

const LEAD_COLUMNS: ColumnTarget[] = [
  { table: "leads", column: "created_at", notNullDefault: true },
  { table: "leads", column: "updated_at", notNullDefault: true },
  { table: "leads", column: "next_followup_at" },
  { table: "leads", column: "transferred_at" },
  { table: "leads", column: "converted_at" },
  { table: "leads", column: "dropped_at" },
  { table: "leads", column: "verified_at" },
];

const ACTIVITY_COLUMNS: ColumnTarget[] = [
  { table: "lead_activities", column: "followup_at" },
  { table: "lead_activities", column: "created_at", notNullDefault: true },
  { table: "lead_activities", column: "updated_at", notNullDefault: true },
];

const REFERENCE_COLUMNS: ColumnTarget[] = [
  { table: "lead_references", column: "created_at", notNullDefault: true },
];

/** Interpret naive column as IST wall clock → timestamptz (UTC). */
function istWallClockToUtcUsing(column: string): string {
  return `CASE
    WHEN ${column} IS NULL THEN NULL
    ELSE (${column}::timestamp AT TIME ZONE '${IST_ZONE}')
  END`;
}

async function getColumnDataType(table: string, column: string): Promise<string | null> {
  const { rows } = await pool.query<{ data_type: string }>(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [table, column]
  );
  return rows[0]?.data_type ?? null;
}

async function logSampleConversion(table: string, column: string): Promise<void> {
  const dataType = await getColumnDataType(table, column);
  if (!dataType) {
    console.log(`  (sample) ${table}.${column} — column not found`);
    return;
  }

  if (dataType === "timestamp without time zone") {
    const { rows } = await pool.query<{
      id: number;
      stored: string;
      utc: string;
      ist_check: string;
    }>(`
      SELECT
        id,
        ${column}::text AS stored,
        (${istWallClockToUtcUsing(column)})::text AS utc,
        ((${istWallClockToUtcUsing(column)}) AT TIME ZONE '${IST_ZONE}')::text AS ist_check
      FROM ${table}
      WHERE ${column} IS NOT NULL
      ORDER BY id DESC
      LIMIT 2
    `);
    if (!rows.length) {
      console.log(`  (sample) ${table}.${column} — no rows to preview`);
      return;
    }
    console.log(`  (sample) ${table}.${column} before migrate — IST wall → UTC:`);
    for (const row of rows) {
      console.log(
        `    id=${row.id} stored="${row.stored}" → utc="${row.utc}" (displays as IST "${row.ist_check}")`
      );
    }
    return;
  }

  if (dataType === "timestamp with time zone") {
    const { rows } = await pool.query<{ id: number; utc: string; ist: string }>(`
      SELECT
        id,
        ${column}::text AS utc,
        (${column} AT TIME ZONE '${IST_ZONE}')::text AS ist
      FROM ${table}
      WHERE ${column} IS NOT NULL
      ORDER BY id DESC
      LIMIT 2
    `);
    console.log(`  (sample) ${table}.${column} already timestamptz — UTC stored, IST display:`);
    for (const row of rows) {
      console.log(`    id=${row.id} utc="${row.utc}" → IST "${row.ist}"`);
    }
  }
}

async function migrateColumn(target: ColumnTarget): Promise<"migrated" | "skipped"> {
  const { table, column } = target;
  const dataType = await getColumnDataType(table, column);

  if (!dataType) {
    console.log(`  skip ${table}.${column} — column does not exist`);
    return "skipped";
  }

  if (dataType === "timestamp with time zone") {
    console.log(`  skip ${table}.${column} — already timestamptz`);
    return "skipped";
  }

  if (dataType !== "timestamp without time zone") {
    console.log(`  skip ${table}.${column} — unexpected type "${dataType}"`);
    return "skipped";
  }

  await db.execute(sql.raw(`
    ALTER TABLE ${table}
    ALTER COLUMN ${column} TYPE timestamptz
    USING (${istWallClockToUtcUsing(column)});
  `));

  if (target.notNullDefault) {
    await db.execute(sql.raw(`
      ALTER TABLE ${table}
      ALTER COLUMN ${column} SET DEFAULT now();
    `));
  }

  console.log(`  ✓ ${table}.${column} — IST wall clock converted to UTC (timestamptz)`);
  return "migrated";
}

async function apply() {
  console.log("Migration 0025: convert IST naive timestamps → timestamptz (UTC)");
  console.log(`Source zone: ${IST_ZONE}\n`);

  const allTargets = [...LEAD_COLUMNS, ...ACTIVITY_COLUMNS, ...REFERENCE_COLUMNS];

  console.log("Preview (latest rows):");
  await logSampleConversion("leads", "created_at");
  await logSampleConversion("lead_activities", "followup_at");
  console.log("");

  let migrated = 0;
  let skipped = 0;

  for (const target of allTargets) {
    const result = await migrateColumn(target);
    if (result === "migrated") migrated++;
    else skipped++;
  }

  console.log("");
  console.log("Post-migration verification:");
  await logSampleConversion("leads", "created_at");
  await logSampleConversion("lead_activities", "followup_at");

  console.log("");
  console.log(`✓ Migration 0025 finished (${migrated} column(s) converted, ${skipped} skipped).`);
  await pool.end();
  process.exit(0);
}

apply().catch(async (err) => {
  console.error("Migration 0025 failed:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
