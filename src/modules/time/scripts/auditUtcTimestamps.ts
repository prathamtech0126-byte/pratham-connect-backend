/**
 * Audit and normalize created_at / updated_at (and all timestamp columns) to UTC.
 *
 * Old DB (DATABASE_URL): timestamps are `timestamp without time zone`, stored as IST wall-clock.
 * New DB (DATABASE_URL_SECOND): mostly `timestamptz`; migrated rows may have IST wall-clock
 * incorrectly stored as UTC (+05:30 offset error).
 *
 * Usage:
 *   npm run audit:utc-timestamps                          # audit both DBs (dry-run)
 *   npm run audit:utc-timestamps -- --db=old              # old DB only
 *   npm run audit:utc-timestamps -- --db=new              # new DB only
 *   npm run audit:utc-timestamps -- --apply               # apply fixes (both DBs)
 *   npm run audit:utc-timestamps -- --apply --db=old      # fix old DB only
 *
 * Env:
 *   DATABASE_URL          — old / main CRM database
 *   DATABASE_URL_SECOND   — new / modules database
 *   SOURCE_TIMEZONE       — timezone naive timestamps represent (default: Asia/Kolkata)
 */
import "dotenv/config";
import { Pool, PoolClient } from "pg";
import { CRM_TIMEZONE } from "../constants";

const SOURCE_TZ = process.env.SOURCE_TIMEZONE?.trim() || CRM_TIMEZONE;

type DbTarget = "old" | "new" | "both";

type TimestampColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
  udtName: string;
};

type ColumnAudit = TimestampColumn & {
  rowCount: number;
  nullCount: number;
  sampleRaw: string | null;
  sampleUtc: string | null;
  issue: string | null;
  fixSql: string | null;
};

function parseDbArg(): DbTarget {
  const arg = process.argv.find((a) => a.startsWith("--db="));
  if (!arg) return "both";
  const value = arg.split("=")[1] as DbTarget;
  if (!["old", "new", "both"].includes(value)) {
    throw new Error(`Invalid --db value: ${value}. Use old, new, or both.`);
  }
  return value;
}

function dbLabel(target: "old" | "new"): string {
  return target === "old" ? "OLD DB (DATABASE_URL)" : "NEW DB (DATABASE_URL_SECOND)";
}

async function discoverTimestampColumns(pool: Pool): Promise<TimestampColumn[]> {
  const { rows } = await pool.query<TimestampColumn>(
    `
    SELECT
      table_name AS "tableName",
      column_name AS "columnName",
      data_type AS "dataType",
      udt_name AS "udtName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
      AND (
        column_name IN ('created_at', 'updated_at')
        OR column_name LIKE '%_at'
      )
    ORDER BY table_name, column_name
    `,
  );
  return rows;
}

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return rows[0]?.exists ?? false;
}

async function auditColumn(
  pool: Pool,
  col: TimestampColumn,
  dbTarget: "old" | "new",
): Promise<ColumnAudit> {
  const qualified = `"${col.tableName}"."${col.columnName}"`;

  const countResult = await pool.query<{ total: string; nulls: string }>(
    `
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${qualified} IS NULL)::text AS nulls
    FROM "${col.tableName}"
    `,
  );

  const rowCount = Number(countResult.rows[0]?.total ?? 0);
  const nullCount = Number(countResult.rows[0]?.nulls ?? 0);

  if (rowCount === 0 || rowCount === nullCount) {
    const isNaive = col.dataType === "timestamp without time zone";
    return {
      ...col,
      rowCount,
      nullCount,
      sampleRaw: null,
      sampleUtc: null,
      issue: rowCount === 0 ? (isNaive ? `empty table (column still ${SOURCE_TZ} naive — needs timestamptz)` : "empty table") : null,
      fixSql: isNaive
        ? `ALTER TABLE "${col.tableName}" ALTER COLUMN "${col.columnName}" TYPE timestamptz USING ("${col.columnName}" AT TIME ZONE '${SOURCE_TZ}');`
        : null,
    };
  }

  const sampleResult = await pool.query<{
    raw: string;
    as_utc: string;
    corrected_utc: string;
  }>(
    `
    SELECT
      ${qualified}::text AS raw,
      (${qualified} AT TIME ZONE 'UTC')::text AS as_utc,
      (
        CASE
          WHEN pg_typeof(${qualified})::text = 'timestamp without time zone' THEN
            (${qualified} AT TIME ZONE '${SOURCE_TZ}') AT TIME ZONE 'UTC'
          ELSE
            ((${qualified} AT TIME ZONE 'UTC')::timestamp AT TIME ZONE '${SOURCE_TZ}') AT TIME ZONE 'UTC'
        END
      )::text AS corrected_utc
    FROM "${col.tableName}"
    WHERE ${qualified} IS NOT NULL
    ORDER BY ${qualified} DESC
    LIMIT 1
    `,
  );

  const sample = sampleResult.rows[0];
  const sampleRaw = sample?.raw ?? null;
  const sampleUtc = sample?.as_utc ?? null;
  const correctedUtc = sample?.corrected_utc ?? null;

  let issue: string | null = null;
  let fixSql: string | null = null;

  if (col.dataType === "timestamp without time zone") {
    issue = `naive timestamp (stored as ${SOURCE_TZ} wall-clock, not UTC)`;
    fixSql = `
      ALTER TABLE "${col.tableName}"
        ALTER COLUMN "${col.columnName}" TYPE timestamptz
        USING ("${col.columnName}" AT TIME ZONE '${SOURCE_TZ}');
    `.trim();
  } else if (dbTarget === "new" && col.dataType === "timestamp with time zone") {
    issue = null;
    fixSql = null;
  }

  return {
    ...col,
    rowCount,
    nullCount,
    sampleRaw,
    sampleUtc: correctedUtc ?? sampleUtc,
    issue,
    fixSql,
  };
}

async function countRowsNeedingFix(
  pool: Pool,
  col: TimestampColumn,
  dbTarget: "old" | "new",
): Promise<number> {
  if (col.dataType === "timestamp without time zone") {
    return 1;
  }

  if (dbTarget === "new") {
    return 0;
  }

  return 0;
}

async function compareMigratedSample(oldPool: Pool, newPool: Pool): Promise<void> {
  if (!(await tableExists(oldPool, "client_information"))) return;
  if (!(await tableExists(newPool, "persons"))) return;

  const oldRows = await oldPool.query<{ id: string; old_raw: string; old_utc: string }>(
    `
    SELECT
      id::text,
      created_at::text AS old_raw,
      (created_at AT TIME ZONE '${SOURCE_TZ}')::text AS old_utc
    FROM client_information
    WHERE created_at IS NOT NULL
    ORDER BY id
    LIMIT 5
    `,
  );

  const ids = oldRows.rows.map((r) => Number(r.id));
  if (ids.length === 0) return;

  const newRows = await newPool.query<{
    legacy_client_id: string;
    new_raw: string;
    new_fixed: string;
  }>(
    `
    SELECT
      legacy_client_id::text,
      created_at::text AS new_raw,
      (
        ((created_at AT TIME ZONE 'UTC')::timestamp AT TIME ZONE '${SOURCE_TZ}')
      )::text AS new_fixed
    FROM persons
    WHERE legacy_client_id = ANY($1::bigint[])
      AND created_at IS NOT NULL
    ORDER BY legacy_client_id
    `,
    [ids],
  );

  const newByLegacy = new Map(newRows.rows.map((r) => [r.legacy_client_id, r]));

  console.log("  Migration spot-check (client_information → persons):");
  for (const o of oldRows.rows) {
    const n = newByLegacy.get(o.id);
    const alreadyOk = n
      ? Math.abs(new Date(n.new_raw).getTime() - new Date(o.old_raw).getTime()) < 2000
      : null;
    console.log(
      `    legacy #${o.id}: OLD=${o.old_raw} | NEW=${n?.new_raw ?? "not migrated"} | match=${alreadyOk}`,
    );
  }
}

async function applyFix(client: PoolClient, col: TimestampColumn, dbTarget: "old" | "new"): Promise<number> {
  if (col.dataType === "timestamp without time zone") {
    const result = await client.query(
      `
      ALTER TABLE "${col.tableName}"
        ALTER COLUMN "${col.columnName}" TYPE timestamptz
        USING ("${col.columnName}" AT TIME ZONE '${SOURCE_TZ}')
      `,
    );
    return result.rowCount ?? 0;
  }

  if (dbTarget === "new") {
    const result = await client.query(
      `
      UPDATE "${col.tableName}"
      SET "${col.columnName}" = (
        (("${col.columnName}" AT TIME ZONE 'UTC')::timestamp AT TIME ZONE '${SOURCE_TZ}')
      )
      WHERE "${col.columnName}" IS NOT NULL
        AND (("${col.columnName}" AT TIME ZONE 'UTC')::time >= '09:00'::time)
        AND "${col.columnName}" IS DISTINCT FROM (
          (("${col.columnName}" AT TIME ZONE 'UTC')::timestamp AT TIME ZONE '${SOURCE_TZ}')
        )
      `,
    );
    return result.rowCount ?? 0;
  }

  return 0;
}

async function auditDatabase(
  pool: Pool,
  dbTarget: "old" | "new",
  apply: boolean,
): Promise<{ columns: number; issues: number; fixed: number }> {
  const label = dbLabel(dbTarget);
  console.log(`\n${"=".repeat(72)}`);
  console.log(label);
  console.log("=".repeat(72));

  const tzResult = await pool.query<{ TimeZone: string }>("SHOW timezone");
  const dbResult = await pool.query<{ name: string }>("SELECT current_database() AS name");
  console.log(`Database: ${dbResult.rows[0]?.name}`);
  console.log(`Session timezone: ${tzResult.rows[0]?.TimeZone}`);
  console.log(`Source timezone (naive → UTC): ${SOURCE_TZ}`);
  console.log("");

  const columns = await discoverTimestampColumns(pool);
  console.log(`Timestamp columns found: ${columns.length}`);

  const createdUpdated = columns.filter((c) =>
    ["created_at", "updated_at"].includes(c.columnName),
  );
  console.log(`  created_at / updated_at: ${createdUpdated.length}`);
  console.log(`  other *_at columns:     ${columns.length - createdUpdated.length}`);
  console.log("");

  let issueCount = 0;
  let fixedCount = 0;
  const audits: ColumnAudit[] = [];

  for (const col of columns) {
    const audit = await auditColumn(pool, col, dbTarget);
    audits.push(audit);
    if (audit.issue && audit.issue !== "empty table") issueCount++;
  }

  const priority = audits.filter((a) =>
    ["created_at", "updated_at"].includes(a.columnName),
  );
  const other = audits.filter(
    (a) => !["created_at", "updated_at"].includes(a.columnName),
  );

  function printAudit(a: ColumnAudit) {
    const typeLabel =
      a.dataType === "timestamp with time zone" ? "timestamptz" : "timestamp (no tz)";
    console.log(`  ${a.tableName}.${a.columnName}`);
    console.log(`    type: ${typeLabel} | rows: ${a.rowCount} | nulls: ${a.nullCount}`);
    if (a.sampleRaw) {
      console.log(`    sample stored:  ${a.sampleRaw}`);
      console.log(`    sample as UTC:  ${a.sampleUtc}`);
    }
    if (a.issue) console.log(`    ⚠ ${a.issue}`);
    else if (a.rowCount > 0) console.log(`    ✓ OK`);
  }

  console.log("--- created_at / updated_at ---");
  for (const a of priority) printAudit(a);

  console.log("\n--- other timestamp columns ---");
  for (const a of other) printAudit(a);

  if (apply) {
    console.log("\n--- applying fixes ---");
    for (const col of columns) {
      const audit = audits.find(
        (a) => a.tableName === col.tableName && a.columnName === col.columnName,
      );
      if (!audit?.fixSql) continue;

      const needsFix = await countRowsNeedingFix(pool, col, dbTarget);
      if (needsFix === 0) continue;

      const client = await pool.connect();
      try {
        console.log(`  fixing ${col.tableName}.${col.columnName} (${needsFix} rows)...`);
        await client.query("BEGIN");
        const updated = await applyFix(client, col, dbTarget);
        await client.query("COMMIT");
        const action =
          col.dataType === "timestamp without time zone"
            ? "column altered to timestamptz"
            : `${updated} rows updated`;
        console.log(`    → done (${action})`);
        fixedCount += needsFix;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    if (fixedCount > 0) {
      console.log("\n✅ All fixes committed.");
    } else {
      console.log("\n✅ Nothing to fix (already normalized).");
    }
  } else if (issueCount > 0) {
    console.log(`\n⚠ ${issueCount} column(s) need UTC normalization.`);
    console.log("  Run with --apply to fix.");
  } else {
    console.log("\n✅ All timestamp columns look correct.");
  }

  return { columns: columns.length, issues: issueCount, fixed: fixedCount };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dbTarget = parseDbArg();

  const oldUrl = process.env.DATABASE_URL?.trim();
  const newUrl = process.env.DATABASE_URL_SECOND?.trim();

  if (!oldUrl && (dbTarget === "old" || dbTarget === "both")) {
    throw new Error("DATABASE_URL missing");
  }
  if (!newUrl && (dbTarget === "new" || dbTarget === "both")) {
    throw new Error("DATABASE_URL_SECOND missing");
  }

  console.log(
    apply
      ? "=== APPLY: normalize timestamps to UTC ==="
      : "=== AUDIT: timestamp format check (dry-run) ===",
  );
  console.log(`Mode: ${apply ? "APPLY" : "AUDIT ONLY"}`);
  console.log(`Target: ${dbTarget}`);

  let totalIssues = 0;
  let totalFixed = 0;

  const oldPool = oldUrl ? new Pool({ connectionString: oldUrl }) : null;
  const newPool = newUrl ? new Pool({ connectionString: newUrl }) : null;

  try {
    if ((dbTarget === "old" || dbTarget === "both") && oldPool) {
      const result = await auditDatabase(oldPool, "old", apply);
      totalIssues += result.issues;
      totalFixed += result.fixed;
    }

    if ((dbTarget === "new" || dbTarget === "both") && newPool) {
      const result = await auditDatabase(newPool, "new", apply);
      totalIssues += result.issues;
      totalFixed += result.fixed;
    }

    if (dbTarget === "both" && oldPool && newPool) {
      console.log(`\n${"=".repeat(72)}`);
      console.log("Cross-database migration check");
      console.log("=".repeat(72));
      await compareMigratedSample(oldPool, newPool);
    }

    console.log(`\n${"=".repeat(72)}`);
    console.log("Summary");
    console.log("=".repeat(72));
    console.log(`Issues found: ${totalIssues}`);
    if (apply) console.log(`Rows/columns fixed: ${totalFixed}`);
    else if (totalIssues > 0) {
      console.log("Next step: npm run audit:utc-timestamps -- --apply");
    }
  } finally {
    await oldPool?.end();
    await newPool?.end();
  }
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
