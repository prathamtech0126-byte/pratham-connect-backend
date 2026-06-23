/**
 * Migrate sale_type_category → visa_categories and sale_type → modules sale_type
 * with country_id + visa_category_id mapping (UUID ids + legacy_sale_type_id).
 *
 * Usage: npm run migrate:module-sale-types
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type LegacyCategory = {
  id: number;
  name: string;
  description: string | null;
  created_at: Date | null;
};

type LegacySaleType = {
  id: number;
  sale_type: string;
  category_id: number | null;
  is_core_product: boolean | null;
  created_at: Date | null;
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function parseCountryName(
  saleTypeName: string,
  countryNames: string[]
): string | null {
  const normalized = saleTypeName.trim();
  const sorted = [...countryNames].sort((a, b) => b.length - a.length);

  for (const country of sorted) {
    const prefix = `${country} `;
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      return country;
    }
    if (normalized.toLowerCase() === country.toLowerCase()) {
      return country;
    }
  }

  return null;
}

async function ensureSaleTypeUuidSchema(): Promise<void> {
  const { rows } = await modulesPool.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sale_type' AND column_name = 'id'`
  );

  if (rows[0]?.data_type === "uuid") {
    const { rows: legacyCol } = await modulesPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sale_type'
           AND column_name = 'legacy_sale_type_id'
       ) AS exists`
    );
    if (legacyCol[0]?.exists) return;
  }

  if (rows[0]?.data_type === "bigint") {
    console.log("Converting sale_type.id from bigint → uuid…");
    await modulesPool.query(`
      CREATE TABLE sale_type_new (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        legacy_sale_type_id bigint UNIQUE,
        sale_type varchar(100) NOT NULL UNIQUE,
        country_id uuid REFERENCES countries(id),
        visa_category_id uuid REFERENCES visa_categories(id),
        is_core_product boolean DEFAULT false,
        created_at timestamp DEFAULT now()
      )
    `);
    await modulesPool.query(`
      INSERT INTO sale_type_new (
        legacy_sale_type_id, sale_type, country_id, visa_category_id, is_core_product, created_at
      )
      SELECT id, sale_type, country_id, visa_category_id, is_core_product, created_at
      FROM sale_type
    `);
    await modulesPool.query("DROP TABLE sale_type CASCADE");
    await modulesPool.query("ALTER TABLE sale_type_new RENAME TO sale_type");
    await modulesPool.query(
      "CREATE INDEX IF NOT EXISTS idx_modules_sale_type_legacy_id ON sale_type(legacy_sale_type_id)"
    );
    await modulesPool.query(
      "CREATE INDEX IF NOT EXISTS idx_modules_sale_type_country_id ON sale_type(country_id)"
    );
    await modulesPool.query(
      "CREATE INDEX IF NOT EXISTS idx_modules_sale_type_visa_category_id ON sale_type(visa_category_id)"
    );
    await modulesPool.query(
      "CREATE INDEX IF NOT EXISTS idx_modules_sale_type_core ON sale_type(is_core_product)"
    );
    await modulesPool.query(
      "CREATE INDEX IF NOT EXISTS idx_modules_sale_type_created_at ON sale_type(created_at)"
    );
    return;
  }

  throw new Error('Unexpected sale_type.id type — run npm run db:push:modules');
}

async function ensureSalesSchema(): Promise<void> {
  await modulesPool.query(`
    ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS sale_type_id uuid REFERENCES sale_type(id)
  `);
  await modulesPool.query("DROP INDEX IF EXISTS uniq_sales_client_id");
  await modulesPool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_client_sale_type ON sales(client_id, sale_type_id)"
  );
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_sales_sale_type_id ON sales(sale_type_id)"
  );
  await modulesPool.query(`
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_date date
  `);
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date)"
  );
  await modulesPool.query("ALTER TABLE sales DROP COLUMN IF EXISTS action_by");
  await modulesPool.query("ALTER TABLE sales DROP COLUMN IF EXISTS created_by");
}

async function assertModulesTables(): Promise<void> {
  for (const table of ["visa_categories", "sale_type", "countries", "sales"]) {
    const { rows } = await modulesPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table]
    );
    if (!rows[0]?.exists) {
      throw new Error(
        `Table "${table}" not found in modules DB. Run: npm run db:push:modules`
      );
    }
  }
}

async function migrateVisaCategories(): Promise<Map<number, string>> {
  const { rows } = await mainPool.query<LegacyCategory>(
    `SELECT id, name, description, created_at
     FROM sale_type_category
     ORDER BY id`
  );

  const legacyToUuid = new Map<number, string>();

  for (const row of rows) {
    const name = titleCase(row.name.trim());
    const slug = row.name.trim().toLowerCase().replace(/\s+/g, "-");

    const result = await modulesPool.query<{ id: string }>(
      `INSERT INTO visa_categories
         (name, slug, description, legacy_category_id, display_order, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
       ON CONFLICT (legacy_category_id) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         description = EXCLUDED.description,
         display_order = EXCLUDED.display_order,
         updated_at = NOW()
       RETURNING id`,
      [name, slug, row.description, row.id, row.id, row.created_at]
    );

    legacyToUuid.set(row.id, result.rows[0].id);
  }

  console.log(`Visa categories: ${legacyToUuid.size} synced.`);
  return legacyToUuid;
}

async function loadCountryNameToId(): Promise<Map<string, string>> {
  const { rows } = await modulesPool.query<{ id: string; name: string }>(
    `SELECT id, name FROM countries WHERE is_active = true ORDER BY name`
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.name.trim().toLowerCase(), row.id);
  }
  return map;
}

async function migrateSaleTypes(
  categoryMap: Map<number, string>,
  countryMap: Map<string, string>
): Promise<void> {
  const { rows } = await mainPool.query<LegacySaleType>(
    `SELECT id, sale_type, category_id, is_core_product, created_at
     FROM sale_type
     ORDER BY id`
  );

  if (!rows.length) {
    console.log("No sale_type rows in main CRM.");
    return;
  }

  const { rows: countryRows } = await modulesPool.query<{ name: string }>(
    `SELECT name FROM countries WHERE is_active = true ORDER BY LENGTH(name) DESC`
  );
  const namesForParsing = countryRows.map((r) => r.name);

  let inserted = 0;
  let updated = 0;
  let unmappedCountry = 0;

  for (const row of rows) {
    const countryName = parseCountryName(row.sale_type, namesForParsing);
    const countryId = countryName
      ? (countryMap.get(countryName.toLowerCase()) ?? null)
      : null;

    if (countryName && !countryId) {
      unmappedCountry++;
      console.warn(
        `  ⚠ country "${countryName}" not in modules DB for "${row.sale_type}"`
      );
    }

    const visaCategoryId = row.category_id
      ? (categoryMap.get(row.category_id) ?? null)
      : null;

    const result = await modulesPool.query(
      `INSERT INTO sale_type
         (legacy_sale_type_id, sale_type, country_id, visa_category_id, is_core_product, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
       ON CONFLICT (legacy_sale_type_id) DO UPDATE SET
         sale_type = EXCLUDED.sale_type,
         country_id = EXCLUDED.country_id,
         visa_category_id = EXCLUDED.visa_category_id,
         is_core_product = EXCLUDED.is_core_product
       RETURNING (xmax = 0) AS inserted`,
      [
        row.id,
        row.sale_type,
        countryId,
        visaCategoryId,
        row.is_core_product ?? false,
        row.created_at,
      ]
    );

    if (result.rows[0]?.inserted) inserted++;
    else updated++;
  }

  console.log(
    `Sale types: ${inserted} inserted, ${updated} updated (${rows.length} total).`
  );
  if (unmappedCountry) {
    console.log(`  ${unmappedCountry} row(s) had a parsed country not in modules DB.`);
  }
}

async function printSummary(): Promise<void> {
  const { rows } = await modulesPool.query<{
    legacy_sale_type_id: number;
    sale_type: string;
    country: string | null;
    visa_category: string | null;
  }>(
    `SELECT st.legacy_sale_type_id,
            st.sale_type,
            c.name AS country,
            vc.name AS visa_category
     FROM sale_type st
     LEFT JOIN countries c ON c.id = st.country_id
     LEFT JOIN visa_categories vc ON vc.id = st.visa_category_id
     ORDER BY st.sale_type`
  );

  console.log("\nModules sale_type mapping:");
  for (const row of rows) {
    console.log(
      `  [${row.legacy_sale_type_id}] ${row.sale_type.padEnd(28)} → ${(row.country ?? "(no country)").padEnd(14)} | ${row.visa_category ?? "(no category)"}`
    );
  }
}

async function main() {
  await assertModulesTables();
  await ensureSaleTypeUuidSchema();
  await ensureSalesSchema();

  const categoryMap = await migrateVisaCategories();
  const countryMap = await loadCountryNameToId();
  await migrateSaleTypes(categoryMap, countryMap);
  await printSummary();
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
