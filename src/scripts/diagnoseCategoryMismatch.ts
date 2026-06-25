/**
 * Diagnostic script: finds clients whose visitor/spouse category differs
 * between the Backend Dashboard (new DB - visa_cases) and the
 * Counsellor Dashboard (old DB - client_payment).
 *
 * Usage:
 *   ts-node src/scripts/diagnoseCategoryMismatch.ts [fromDate] [toDate]
 *   ts-node src/scripts/diagnoseCategoryMismatch.ts 2026-06-01 2026-06-30
 *
 * Defaults to the current calendar month if no dates are provided.
 */

import "dotenv/config";
import { Pool } from "pg";

const useSSL = process.env.DB_SSL === "true";
const sslOpts = useSSL ? { rejectUnauthorized: false } : false;

const oldPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslOpts });
const newPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND, ssl: sslOpts });

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}` };
}

async function fetchNewDbClients(
  from: string,
  to: string
): Promise<Map<number, { category: string; name: string; enrollmentDate: string }>> {
  const { rows } = await newPool.query<{
    legacy_client_id: number;
    category: string;
    client_name: string;
    enrollment_date: string;
  }>(
    `
    SELECT
      c.legacy_client_id,
      COALESCE(vcat.slug, 'unknown') AS category,
      COALESCE(p.full_name, '') AS client_name,
      c.enrollment_date::text AS enrollment_date
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
    LEFT JOIN persons p ON p.id = c.person_id
    INNER JOIN sales s ON s.id = vc.sale_id
    INNER JOIN sale_type st ON st.id = s.sale_type_id
    LEFT JOIN visa_categories vcat ON vcat.id = st.visa_category_id
    WHERE c.enrollment_date >= $1::date
      AND c.enrollment_date <= $2::date
      AND COALESCE(vcat.slug, '') IN ('visitor', 'spouse')
    `,
    [from, to]
  );

  const map = new Map<number, { category: string; name: string; enrollmentDate: string }>();
  for (const r of rows) {
    if (r.legacy_client_id != null) {
      map.set(Number(r.legacy_client_id), {
        category: r.category,
        name: r.client_name,
        enrollmentDate: r.enrollment_date,
      });
    }
  }
  return map;
}

async function fetchOldDbClients(
  from: string,
  to: string
): Promise<Map<number, { category: string; name: string; enrollmentDate: string; allCategories: string }>> {
  // Replicates getSaleTypeCategoryCounts ranking logic, but returns per-client category
  const { rows } = await oldPool.query<{
    client_id: number;
    category_name: string;
    client_name: string;
    enrollment_date: string;
    all_categories: string;
  }>(
    `
    WITH clients_in_period AS (
      SELECT ci.id AS client_id, ci.fullname AS client_name, ci.date AS enrollment_date
      FROM client_information ci
      WHERE ci.archived = false
        AND ci.date >= $1::date
        AND ci.date <= $2::date
        AND EXISTS (
          SELECT 1 FROM client_payment cp0
          WHERE cp0.client_id = ci.id
            AND cp0.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
        )
    ),
    eligible_payments AS (
      SELECT
        cp.client_id,
        st.category_id,
        stc.name AS category_name,
        cp.stage,
        cp.payment_date,
        cp.created_at,
        cp.id AS payment_id
      FROM client_payment cp
      INNER JOIN clients_in_period cip ON cip.client_id = cp.client_id
      LEFT JOIN sale_type st ON st.id = cp.sale_type_id
      LEFT JOIN sale_type_category stc ON stc.id = st.category_id
      WHERE cp.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
    ),
    ranked AS (
      SELECT
        client_id,
        category_name,
        ROW_NUMBER() OVER (
          PARTITION BY client_id
          ORDER BY
            CASE stage
              WHEN 'AFTER_VISA'  THEN 0
              WHEN 'BEFORE_VISA' THEN 1
              WHEN 'INITIAL'     THEN 2
              ELSE 3
            END,
            COALESCE(payment_date::timestamp, created_at) DESC NULLS LAST,
            payment_id DESC
        ) AS rn
      FROM eligible_payments
    ),
    client_category AS (
      SELECT client_id, category_name FROM ranked WHERE rn = 1
    ),
    all_categories_per_client AS (
      SELECT client_id, string_agg(DISTINCT LOWER(category_name), ', ' ORDER BY LOWER(category_name)) AS all_cats
      FROM eligible_payments
      GROUP BY client_id
    )
    SELECT
      cc.client_id,
      LOWER(cc.category_name) AS category_name,
      cip.client_name,
      cip.enrollment_date::text AS enrollment_date,
      COALESCE(apc.all_cats, '') AS all_categories
    FROM client_category cc
    INNER JOIN clients_in_period cip ON cip.client_id = cc.client_id
    LEFT JOIN all_categories_per_client apc ON apc.client_id = cc.client_id
    WHERE LOWER(cc.category_name) IN ('visitor', 'spouse')
    `,
    [from, to]
  );

  const map = new Map<number, { category: string; name: string; enrollmentDate: string; allCategories: string }>();
  for (const r of rows) {
    map.set(Number(r.client_id), {
      category: r.category_name,
      name: r.client_name,
      enrollmentDate: r.enrollment_date,
      allCategories: r.all_categories,
    });
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const from = args[0] ?? currentMonthRange().from;
  const to = args[1] ?? currentMonthRange().to;

  console.log(`\n=== Category Mismatch Diagnostic ===`);
  console.log(`Period: ${from} → ${to}\n`);

  const [newMap, oldMap] = await Promise.all([
    fetchNewDbClients(from, to),
    fetchOldDbClients(from, to),
  ]);

  console.log(`Backend Dashboard  (new DB via visa_cases): ${newMap.size} visitor/spouse clients`);
  console.log(`Counsellor Dashboard (old DB via client_payment): ${oldMap.size} visitor/spouse clients\n`);

  const mismatches: Array<{
    oldDbId: number;
    name: string;
    oldCategory: string;
    newCategory: string;
    allPaymentCategories: string;
  }> = [];

  const onlyInOld: number[] = [];
  const onlyInNew: number[] = [];

  // Check all clients in old DB
  for (const [clientId, oldData] of oldMap) {
    const newData = newMap.get(clientId);
    if (!newData) {
      onlyInOld.push(clientId);
    } else if (newData.category !== oldData.category) {
      mismatches.push({
        oldDbId: clientId,
        name: oldData.name || newData.name,
        oldCategory: oldData.category,
        newCategory: newData.category,
        allPaymentCategories: oldData.allCategories,
      });
    }
  }

  // Check clients in new DB that are missing from old DB
  for (const [legacyId] of newMap) {
    if (!oldMap.has(legacyId)) {
      onlyInNew.push(legacyId);
    }
  }

  if (mismatches.length === 0) {
    console.log("✅ No category mismatches found — both dashboards agree on all clients.");
  } else {
    console.log(`❌ Found ${mismatches.length} client(s) with different categories:\n`);
    console.log(
      "  #  | Old DB ID | Name                           | Counsellor Dashboard | Backend Dashboard | All Payment Categories"
    );
    console.log(
      "  ---|-----------|--------------------------------|----------------------|-------------------|-------------------------"
    );
    mismatches.forEach((m, i) => {
      const name = m.name.padEnd(30).slice(0, 30);
      const oldCat = m.oldCategory.padEnd(20);
      const newCat = m.newCategory.padEnd(17);
      console.log(
        `  ${String(i + 1).padStart(2)} | ${String(m.oldDbId).padEnd(9)} | ${name} | ${oldCat} | ${newCat} | ${m.allPaymentCategories}`
      );
    });
  }

  if (onlyInOld.length > 0) {
    console.log(`\n⚠️  ${onlyInOld.length} client(s) in Counsellor Dashboard but NOT in Backend Dashboard:`);
    console.log(`   Old DB client IDs: ${onlyInOld.join(", ")}`);
    console.log(`   (Check if their legacy_client_id is set on the clients table in the new DB)`);
  }

  if (onlyInNew.length > 0) {
    console.log(`\n⚠️  ${onlyInNew.length} client(s) in Backend Dashboard but NOT in Counsellor Dashboard:`);
    console.log(`   Legacy client IDs: ${onlyInNew.join(", ")}`);
    console.log(`   (Their enrollment date in the new DB may differ from ci.date in the old DB)`);
  }

  // Show date details for clients that exist in one DB but not the other
  if (onlyInOld.length > 0) {
    const { rows: oldRows } = await oldPool.query<{
      id: number; fullname: string; date: string;
    }>(
      `SELECT id, fullname, date::text FROM client_information WHERE id = ANY($1::int[]) ORDER BY id`,
      [onlyInOld]
    );
    const { rows: newRows } = await newPool.query<{
      legacy_client_id: number; enrollment_date: string;
    }>(
      `SELECT legacy_client_id, enrollment_date::text FROM clients WHERE legacy_client_id = ANY($1::bigint[]) ORDER BY legacy_client_id`,
      [onlyInOld]
    );
    const newDates = new Map(newRows.map(r => [Number(r.legacy_client_id), r.enrollment_date]));

    console.log("\n--- Clients only in Counsellor Dashboard (old ci.date in June, new enrollment_date outside June or missing) ---");
    console.log("  Old DB ID | Name                           | ci.date (old DB) | enrollment_date (new DB)");
    console.log("  ----------|--------------------------------|------------------|-------------------------");
    for (const r of oldRows) {
      const newDate = newDates.get(r.id) ?? "NOT FOUND in new DB";
      console.log(`  ${String(r.id).padEnd(9)} | ${(r.fullname ?? "").padEnd(30).slice(0, 30)} | ${r.date}       | ${newDate}`);
    }
  }

  if (onlyInNew.length > 0) {
    const { rows: newRows } = await newPool.query<{
      legacy_client_id: number; enrollment_date: string; full_name: string;
    }>(
      `SELECT c.legacy_client_id, c.enrollment_date::text, COALESCE(p.full_name, '') AS full_name
       FROM clients c LEFT JOIN persons p ON p.id = c.person_id
       WHERE c.legacy_client_id = ANY($1::bigint[]) ORDER BY c.legacy_client_id`,
      [onlyInNew]
    );
    const { rows: oldRows } = await oldPool.query<{
      id: number; fullname: string; date: string;
    }>(
      `SELECT id, fullname, date::text FROM client_information WHERE id = ANY($1::int[]) ORDER BY id`,
      [onlyInNew]
    );
    const oldDates = new Map(oldRows.map(r => [r.id, { date: r.date, name: r.fullname }]));

    console.log("\n--- Clients only in Backend Dashboard (new enrollment_date in June, old ci.date outside June or missing) ---");
    console.log("  Old DB ID | Name                           | enrollment_date (new DB) | ci.date (old DB)");
    console.log("  ----------|--------------------------------|--------------------------|------------------");
    for (const r of newRows) {
      const old = oldDates.get(Number(r.legacy_client_id));
      const oldDate = old?.date ?? "NOT FOUND in old DB";
      const name = (r.full_name || old?.name || "").padEnd(30).slice(0, 30);
      console.log(`  ${String(r.legacy_client_id).padEnd(9)} | ${name} | ${r.enrollment_date}             | ${oldDate}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Category mismatches : ${mismatches.length}`);
  console.log(`Only in old DB      : ${onlyInOld.length}`);
  console.log(`Only in new DB      : ${onlyInNew.length}`);

  await Promise.all([oldPool.end(), newPool.end()]);
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
