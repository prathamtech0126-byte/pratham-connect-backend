/**
 * Migrate other_products (main CRM) → products + product_sale_types (modules DB).
 *
 * - Upserts by product_id (stable slug)
 * - Stores legacy other_products.id in legacy_other_product_id
 * - Maps category → sale_type rows in product_sale_types
 *
 * Usage: npm run migrate:module-products
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type OtherProductRow = {
  id: number;
  product_id: string;
  name: string;
  category: string;
  product_name: string;
  form_type: string;
  description: string | null;
  is_active: boolean;
  display_order: number | null;
  metadata: string | null;
  created_at: Date;
  updated_at: Date;
};

type SaleTypeRow = {
  id: number;
  sale_type: string;
};

/** Map other_products.category → which sale_type names qualify */
function saleTypeIdsForCategory(
  category: string,
  saleTypes: SaleTypeRow[]
): number[] {
  const name = (s: SaleTypeRow) => s.sale_type.toLowerCase();

  switch (category) {
    case "Student":
      return saleTypes
        .filter((s) => name(s).includes("student"))
        .map((s) => s.id);
    case "Spouse":
      return saleTypes
        .filter(
          (s) =>
            name(s).includes("spouse") || name(s).includes("spousal")
        )
        .map((s) => s.id);
    case "Visitor":
      return saleTypes
        .filter(
          (s) =>
            name(s).includes("visitor") || name(s).includes("schengen")
        )
        .map((s) => s.id);
    case "Finance":
      return saleTypes
        .filter(
          (s) =>
            name(s).includes("student") || name(s).includes("spouse")
        )
        .map((s) => s.id);
    case "Common":
    case "Other":
      return saleTypes.map((s) => s.id);
    default:
      return saleTypes.map((s) => s.id);
  }
}

async function main() {
  const { rows: otherProducts } = await mainPool.query<OtherProductRow>(
    `SELECT id, product_id, name, category, product_name, form_type,
            description, is_active, display_order, metadata, created_at, updated_at
     FROM other_products
     ORDER BY id`
  );

  if (!otherProducts.length) {
    console.log("No other_products rows in main CRM.");
    return;
  }

  const { rows: saleTypes } = await modulesPool.query<SaleTypeRow>(
    `SELECT id, sale_type FROM sale_type ORDER BY id`
  );

  if (!saleTypes.length) {
    throw new Error(
      "No sale_type in modules DB. Run: npm run migrate:module-sale-types"
    );
  }

  let productsInserted = 0;
  let productsUpdated = 0;
  let mappingsInserted = 0;

  for (const row of otherProducts) {
    const result = await modulesPool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO products (
         legacy_other_product_id, product_id, name, category, product_name,
         form_type, description, metadata, display_order, is_active,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (product_id) DO UPDATE SET
         legacy_other_product_id = EXCLUDED.legacy_other_product_id,
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         product_name = EXCLUDED.product_name,
         form_type = EXCLUDED.form_type,
         description = EXCLUDED.description,
         metadata = EXCLUDED.metadata,
         display_order = EXCLUDED.display_order,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at
       RETURNING id, (xmax = 0) AS inserted`,
      [
        row.id,
        row.product_id,
        row.name,
        row.category,
        row.product_name,
        row.form_type,
        row.description,
        row.metadata,
        row.display_order ?? 0,
        row.is_active,
        row.created_at,
        row.updated_at,
      ]
    );

    const productUuid = result.rows[0].id;
    if (result.rows[0].inserted) productsInserted++;
    else productsUpdated++;

    const saleTypeIds = saleTypeIdsForCategory(row.category, saleTypes);

    for (const saleTypeId of saleTypeIds) {
      const mapResult = await modulesPool.query(
        `INSERT INTO product_sale_types (product_id, sale_type_id, country_id, is_active)
         SELECT $1::uuid, $2::bigint, NULL, true
         WHERE NOT EXISTS (
           SELECT 1 FROM product_sale_types
           WHERE product_id = $1::uuid
             AND sale_type_id = $2::bigint
             AND country_id IS NULL
         )
         RETURNING id`,
        [productUuid, saleTypeId]
      );
      if (mapResult.rowCount) mappingsInserted++;
    }
  }

  console.log(
    `Products: ${productsInserted} inserted, ${productsUpdated} updated (${otherProducts.length} total).`
  );
  console.log(`Product ↔ sale_type mappings: ${mappingsInserted} new rows.`);
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
