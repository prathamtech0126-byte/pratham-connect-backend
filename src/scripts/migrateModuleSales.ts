/**
 * Migrate client_payment (main CRM) → sales (modules DB).
 * One sale per client + sale_type combination (client may have many sales over time).
 * sale_date comes from client_information.date → clients.enrollment_date.
 *
 * Prerequisite:
 *   npm run migrate:module-clients
 *   npm run migrate:module-sale-types
 *
 * Usage: npm run migrate:module-sales
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type ClientSaleRow = {
  client_id: number;
  sale_type_id: number;
  created_at: Date | null;
};

async function ensureMultiSaleSchema(): Promise<void> {
  await modulesPool.query("DROP INDEX IF EXISTS uniq_sales_client_id");
  await modulesPool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_client_sale_type ON sales(client_id, sale_type_id)"
  );

  await modulesPool.query(`
    ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS sale_date date
  `);

  await modulesPool.query(
    `UPDATE sales s
     SET sale_date = c.enrollment_date
     FROM clients c
     WHERE s.client_id = c.id
       AND s.sale_date IS NULL
       AND c.enrollment_date IS NOT NULL`
  );

  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date)"
  );
}

async function loadClientMap(): Promise<
  Map<number, { id: string; clientCode: string; enrollmentDate: string }>
> {
  const { rows } = await modulesPool.query<{
    legacy_client_id: number;
    id: string;
    client_code: string;
    enrollment_date: string;
  }>(
    `SELECT legacy_client_id, id, client_code, enrollment_date
     FROM clients
     WHERE legacy_client_id IS NOT NULL`
  );

  const map = new Map<
    number,
    { id: string; clientCode: string; enrollmentDate: string }
  >();
  for (const row of rows) {
    map.set(Number(row.legacy_client_id), {
      id: row.id,
      clientCode: row.client_code,
      enrollmentDate: row.enrollment_date,
    });
  }
  return map;
}

async function loadSaleTypeMap(): Promise<Map<number, string>> {
  const { rows } = await modulesPool.query<{
    legacy_sale_type_id: number;
    id: string;
  }>(
    `SELECT legacy_sale_type_id, id
     FROM sale_type
     WHERE legacy_sale_type_id IS NOT NULL`
  );

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(Number(row.legacy_sale_type_id), row.id);
  }
  return map;
}

async function main() {
  await ensureMultiSaleSchema();

  const clientMap = await loadClientMap();
  if (!clientMap.size) {
    throw new Error(
      "No migrated clients in modules DB. Run: npm run migrate:module-clients"
    );
  }

  const saleTypeMap = await loadSaleTypeMap();
  if (!saleTypeMap.size) {
    throw new Error(
      "No sale types in modules DB. Run: npm run migrate:module-sale-types"
    );
  }

  const { rows } = await mainPool.query<ClientSaleRow>(
    `SELECT client_id,
            sale_type_id,
            MIN(created_at) AS created_at
     FROM client_payment
     GROUP BY client_id, sale_type_id
     ORDER BY client_id, sale_type_id`
  );

  if (!rows.length) {
    console.log("No client_payment rows in main CRM.");
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const legacyClientId = Number(row.client_id);
    const legacySaleTypeId = Number(row.sale_type_id);

    const client = clientMap.get(legacyClientId);
    if (!client) {
      console.warn(`Skip: client ${legacyClientId} not in modules DB`);
      skipped++;
      continue;
    }

    const saleTypeUuid = saleTypeMap.get(legacySaleTypeId);
    if (!saleTypeUuid) {
      console.warn(
        `Skip: sale_type ${legacySaleTypeId} not in modules DB (client ${legacyClientId})`
      );
      skipped++;
      continue;
    }

    const businessSaleId = `${client.clientCode}-ST${legacySaleTypeId}`;

    const result = await modulesPool.query(
      `INSERT INTO sales (sale_id, client_id, sale_type_id, sale_date, created_at)
       VALUES ($1, $2::uuid, $3::uuid, $4::date, COALESCE($5, NOW()))
       ON CONFLICT (client_id, sale_type_id) DO UPDATE SET
         sale_id = EXCLUDED.sale_id,
         sale_date = EXCLUDED.sale_date
       RETURNING (xmax = 0) AS inserted`,
      [
        businessSaleId,
        client.id,
        saleTypeUuid,
        client.enrollmentDate,
        row.created_at,
      ]
    );

    if (result.rows[0]?.inserted) inserted++;
    else updated++;
  }

  console.log(
    `Sales: ${inserted} inserted, ${updated} updated, ${skipped} skipped (${rows.length} client+sale_type pairs).`
  );

  const { rows: summary } = await modulesPool.query<{
    client_code: string;
    sale_type: string;
    sale_date: string;
    country: string | null;
    visa_category: string | null;
  }>(
    `SELECT c.client_code, st.sale_type, s.sale_date, co.name AS country, vc.name AS visa_category
     FROM sales s
     JOIN clients c ON c.id = s.client_id
     JOIN sale_type st ON st.id = s.sale_type_id
     LEFT JOIN countries co ON co.id = st.country_id
     LEFT JOIN visa_categories vc ON vc.id = st.visa_category_id
     ORDER BY c.client_code
     LIMIT 10`
  );

  if (summary.length) {
    console.log("\nSample sales (first 10):");
    for (const row of summary) {
      console.log(
        `  ${row.client_code} → ${row.sale_type} | sale_date: ${String(row.sale_date ?? "—").slice(0, 10)} (${row.country ?? "—"} / ${row.visa_category ?? "—"})`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mainPool.end();
    await modulesPool.end();
  });
