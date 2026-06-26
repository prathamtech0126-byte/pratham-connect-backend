/**
 * Targeted migration: syncs sales + visa_cases for specific client IDs only.
 * Does NOT touch any existing records for other clients.
 *
 * Prerequisite: npm run migrate:specific-clients  (persons/passports/clients must exist)
 *
 * Usage: npm run migrate:specific-clients:sales-cases
 */

import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

const TARGET_CLIENT_IDS = [1057, 1058, 1061, 1063, 1065, 1066, 1067];

/* ─────────────────────────────────────────────
   STEP 1 — Sales
───────────────────────────────────────────── */
async function migrateSales(
  clientMap: Map<number, { uuid: string; clientCode: string; enrollmentDate: string }>,
  saleTypeMap: Map<number, string>
): Promise<void> {
  console.log("\n── Step 1: Sales ──────────────────────────────");

  const legacyIds = [...clientMap.keys()];

  const { rows } = await mainPool.query<{
    client_id: number;
    sale_type_id: number;
    created_at: Date | null;
  }>(
    `SELECT client_id, sale_type_id, MIN(created_at) AS created_at
     FROM client_payment
     WHERE client_id = ANY($1::int[])
     GROUP BY client_id, sale_type_id
     ORDER BY client_id, sale_type_id`,
    [legacyIds]
  );

  if (!rows.length) {
    console.log("  No client_payment rows found for these clients.");
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const client = clientMap.get(Number(row.client_id));
    if (!client) {
      console.warn(`  ⚠ Skip: client ${row.client_id} not found in new DB`);
      skipped++;
      continue;
    }

    const saleTypeUuid = saleTypeMap.get(Number(row.sale_type_id));
    if (!saleTypeUuid) {
      console.warn(`  ⚠ Skip: sale_type ${row.sale_type_id} not in new DB (client ${row.client_id})`);
      skipped++;
      continue;
    }

    const businessSaleId = `${client.clientCode}-ST${row.sale_type_id}`;

    const result = await modulesPool.query(
      `INSERT INTO sales (sale_id, client_id, sale_type_id, sale_date, created_at)
       VALUES ($1, $2::uuid, $3::uuid, $4::date, COALESCE($5, NOW()))
       ON CONFLICT (client_id, sale_type_id) DO UPDATE SET
         sale_id = EXCLUDED.sale_id,
         sale_date = EXCLUDED.sale_date
       RETURNING (xmax = 0) AS inserted`,
      [businessSaleId, client.uuid, saleTypeUuid, client.enrollmentDate, row.created_at]
    );

    if (result.rows[0]?.inserted) {
      console.log(`  ✅ Sale inserted: client ${row.client_id} → sale_type ${row.sale_type_id} (${businessSaleId})`);
      inserted++;
    } else {
      console.log(`  ↻  Sale updated : client ${row.client_id} → sale_type ${row.sale_type_id} (${businessSaleId})`);
      updated++;
    }
  }

  console.log(`\n  Sales: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
}

/* ─────────────────────────────────────────────
   STEP 2 — Visa Cases
───────────────────────────────────────────── */
async function migrateVisaCases(
  clientMap: Map<number, { uuid: string; clientCode: string; enrollmentDate: string }>
): Promise<void> {
  console.log("\n── Step 2: Visa Cases ─────────────────────────");

  const clientUuids = [...clientMap.values()].map((c) => c.uuid);

  // Find sales for these clients that don't yet have a visa_case,
  // and whose sale_type is in visitor/spouse/student category
  const { rows: sales } = await modulesPool.query<{
    sale_uuid: string;
    client_uuid: string;
    legacy_client_id: number;
    sale_id_code: string;
  }>(
    `SELECT
       s.id AS sale_uuid,
       s.client_id AS client_uuid,
       c.legacy_client_id,
       s.sale_id AS sale_id_code
     FROM sales s
     INNER JOIN clients c ON c.id = s.client_id
     INNER JOIN sale_type st ON st.id = s.sale_type_id
     INNER JOIN visa_categories vc_cat ON vc_cat.id = st.visa_category_id
     LEFT JOIN visa_cases vc ON vc.sale_id = s.id
     WHERE s.client_id = ANY($1::uuid[])
       AND vc.id IS NULL
       AND vc_cat.slug IN ('visitor', 'spouse', 'student')
       AND c.enrollment_date IS NOT NULL`,
    [clientUuids]
  );

  if (!sales.length) {
    console.log("  No pending visa_case rows to create (all may already exist).");
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const row of sales) {
    if (!row.legacy_client_id) {
      console.warn(`  ⚠ Skip sale ${row.sale_uuid}: missing legacy_client_id`);
      skipped++;
      continue;
    }

    const counsellorLookup = await mainPool.query<{ counsellor_id: number }>(
      `SELECT counsellor_id FROM client_information WHERE id = $1 LIMIT 1`,
      [row.legacy_client_id]
    );
    const userId = counsellorLookup.rows[0]?.counsellor_id;
    if (!userId) {
      console.warn(`  ⚠ Skip sale ${row.sale_uuid}: counsellor not found for client ${row.legacy_client_id}`);
      skipped++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO visa_cases (
         client_id, sale_id, user_id, assigned_team,
         current_stage, current_sub_status, decision, accompanying_members_count
       ) VALUES ($1::uuid, $2::uuid, $3, 'cx', 'DOCUMENTATION', 'CHECKLIST_SHARED', 'PENDING', 0)
       ON CONFLICT (sale_id) DO NOTHING`,
      [row.client_uuid, row.sale_uuid, userId]
    );

    console.log(`  ✅ Visa case created: ${row.sale_id_code} (client ${row.legacy_client_id})`);
    created++;
  }

  console.log(`\n  Visa cases: ${created} created, ${skipped} skipped`);
}

/* ─────────────────────────────────────────────
   MAIN
───────────────────────────────────────────── */
async function main() {
  console.log(`\nTargeted sales + visa_cases migration for client IDs: ${TARGET_CLIENT_IDS.join(", ")}`);

  // Verify all 7 clients exist in new DB first
  const { rows: clientRows } = await modulesPool.query<{
    legacy_client_id: number;
    id: string;
    client_code: string;
    enrollment_date: string;
  }>(
    `SELECT legacy_client_id, id, client_code, enrollment_date
     FROM clients
     WHERE legacy_client_id = ANY($1::bigint[])`,
    [TARGET_CLIENT_IDS]
  );

  if (!clientRows.length) {
    console.error("❌ None of the target clients exist in the new DB. Run: npm run migrate:specific-clients");
    process.exit(1);
  }

  const missingIds = TARGET_CLIENT_IDS.filter(
    (id) => !clientRows.some((r) => Number(r.legacy_client_id) === id)
  );
  if (missingIds.length) {
    console.warn(`⚠️  These IDs are missing from the new DB (skipping): ${missingIds.join(", ")}`);
    console.warn(`   Run npm run migrate:specific-clients first.`);
  }

  const clientMap = new Map(
    clientRows.map((r) => [
      Number(r.legacy_client_id),
      { uuid: r.id, clientCode: r.client_code, enrollmentDate: r.enrollment_date },
    ])
  );

  // Load sale type map from new DB
  const { rows: saleTypeRows } = await modulesPool.query<{
    legacy_sale_type_id: number;
    id: string;
  }>(`SELECT legacy_sale_type_id, id FROM sale_type WHERE legacy_sale_type_id IS NOT NULL`);

  const saleTypeMap = new Map(
    saleTypeRows.map((r) => [Number(r.legacy_sale_type_id), r.id])
  );

  if (!saleTypeMap.size) {
    console.error("❌ No sale types found in new DB. Run: npm run migrate:module-sale-types");
    process.exit(1);
  }

  await migrateSales(clientMap, saleTypeMap);
  await migrateVisaCases(clientMap);

  console.log("\n=== Done ===");
}

main()
  .catch((err) => {
    console.error("Migration error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await mainPool.end();
    await modulesPool.end();
  });
