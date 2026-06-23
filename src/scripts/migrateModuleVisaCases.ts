/**
 * Backfill visa_cases for existing sales in modules DB.
 *
 * Prerequisite:
 *   npm run migrate:module-sales
 *   npm run db:push:modules
 *
 * Usage: npm run migrate:module-visa-cases
 */
import "dotenv/config";
import { Pool } from "pg";

const modulesPool = new Pool({
  connectionString: process.env.DATABASE_URL_SECOND,
});

async function main() {
  const { rows: sales } = await modulesPool.query<{
    sale_uuid: string;
    client_uuid: string;
    legacy_client_id: number | null;
  }>(
    `
    SELECT
      s.id AS sale_uuid,
      s.client_id AS client_uuid,
      c.legacy_client_id
    FROM sales s
    INNER JOIN clients c ON c.id = s.client_id
    INNER JOIN sale_type st ON st.id = s.sale_type_id
    INNER JOIN visa_categories vc_cat ON vc_cat.id = st.visa_category_id
    LEFT JOIN visa_cases vc ON vc.sale_id = s.id
    WHERE vc.id IS NULL
      AND vc_cat.slug IN ('visitor', 'spouse', 'student')
      AND c.enrollment_date IS NOT NULL
    `
  );

  if (!sales.length) {
    console.log("No sales without visa_cases.");
    return;
  }

  const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let created = 0;

  for (const row of sales) {
    if (!row.legacy_client_id) {
      console.warn(`  ⚠ skip sale ${row.sale_uuid}: missing legacy_client_id`);
      continue;
    }

    const counsellorLookup = await mainPool.query<{ counsellor_id: number }>(
      `SELECT counsellor_id FROM client_information WHERE id = $1 LIMIT 1`,
      [row.legacy_client_id]
    );
    const userId = counsellorLookup.rows[0]?.counsellor_id;
    if (!userId) {
      console.warn(`  ⚠ skip sale ${row.sale_uuid}: user not found`);
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
    created++;
  }

  await mainPool.end();
  console.log(`✅ visa_cases backfill complete (${created} row(s) processed).`);
}

main()
  .catch((error) => {
    console.error("migrateModuleVisaCases failed:", error);
    process.exit(1);
  })
  .finally(() => modulesPool.end());
