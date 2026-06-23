/**
 * Migrate master_only product payments (main CRM → modules DB).
 *
 * master_only rows store amount, date, invoice_no, remark directly on
 * client_product_payment — no separate entity table.
 *
 * Target per row:
 *   products (ensured from other_products) → product_transactions → payment_balances
 *   → amounts → dates → invoices → remarks
 *
 * Preserves original payment date and created_at from client_product_payment.
 *
 * Prerequisites: migrate:module-clients → migrate:module-sales
 *
 * Usage: npm run migrate:module-master-only-payments
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({
  connectionString: process.env.DATABASE_URL_SECOND,
});

type CppRow = {
  id: number;
  client_id: number;
  product_name: string;
  amount: string | null;
  payment_date: string | null;
  invoice_no: string | null;
  remark: string | null;
  handled_by: number | null;
  counsellor_id: number;
  created_at: Date | null;
};

type SaleLookupKey = string;

type OtherProductRow = {
  id: number;
  product_id: string;
  name: string;
  product_name: string;
  description: string | null;
  display_order: number | null;
  is_active: boolean;
};

function parseMoney(value: string | null | undefined): number {
  const n = parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function truncateRemark(text: string, max = 100): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + "...";
}

/** Negative legacy id — avoids collision with client_payment rows */
function legacyAmountId(cppId: number): number {
  return -(cppId * 10 + 1);
}

function amountCode(cppId: number): string {
  return `CPP-${cppId}`;
}

function invoiceNumber(
  cppId: number,
  explicit: string | null | undefined
): string {
  const no = explicit?.trim();
  if (no) return no;
  return `CPP-INV-${cppId}`;
}

function saleLookupKey(
  legacyClientId: number,
  legacySaleTypeId: number
): SaleLookupKey {
  return `${legacyClientId}:${legacySaleTypeId}`;
}

function rowCreatedAt(row: CppRow): Date {
  return row.created_at ?? new Date();
}

function rowIssuedAt(row: CppRow): Date {
  if (row.payment_date) return new Date(row.payment_date);
  return rowCreatedAt(row);
}

async function ensureSchema(): Promise<void> {
  await modulesPool.query(`
    ALTER TABLE amounts ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES sales(id)
  `);
}

async function ensureMasterOnlyProducts(): Promise<Map<string, string>> {
  const { rows: legacyProducts } = await mainPool.query<OtherProductRow>(
    `SELECT id, product_id, name, product_name, description, display_order, is_active
     FROM other_products
     WHERE form_type = 'masterOnly'
     ORDER BY id`
  );

  const map = new Map<string, string>();

  for (const row of legacyProducts) {
    const result = await modulesPool.query<{ id: string }>(
      `INSERT INTO products (
         legacy_other_product_id, product_id, name, product_name,
         description, display_order, is_active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (product_name) DO UPDATE SET
         legacy_other_product_id = EXCLUDED.legacy_other_product_id,
         product_id = EXCLUDED.product_id,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         display_order = EXCLUDED.display_order,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING id`,
      [
        row.id,
        row.product_id,
        row.name,
        row.product_name,
        row.description,
        row.display_order ?? 0,
        row.is_active,
      ]
    );
    map.set(row.product_name, result.rows[0].id);
  }

  return map;
}

async function loadClientUuidMap(): Promise<Map<number, string>> {
  const { rows } = await modulesPool.query<{
    legacy_client_id: number;
    id: string;
  }>(
    `SELECT legacy_client_id, id FROM clients WHERE legacy_client_id IS NOT NULL`
  );
  const map = new Map<number, string>();
  for (const row of rows) map.set(Number(row.legacy_client_id), row.id);
  return map;
}

async function loadSalesMap(): Promise<Map<SaleLookupKey, string>> {
  const { rows } = await modulesPool.query<{
    id: string;
    legacy_client_id: number;
    legacy_sale_type_id: number;
  }>(
    `SELECT s.id, c.legacy_client_id, st.legacy_sale_type_id
     FROM sales s
     JOIN clients c ON c.id = s.client_id
     JOIN sale_type st ON st.id = s.sale_type_id
     WHERE c.legacy_client_id IS NOT NULL
       AND st.legacy_sale_type_id IS NOT NULL`
  );

  const map = new Map<SaleLookupKey, string>();
  for (const row of rows) {
    map.set(
      saleLookupKey(
        Number(row.legacy_client_id),
        Number(row.legacy_sale_type_id)
      ),
      row.id
    );
  }
  return map;
}

async function loadClientLegacySaleTypeMap(): Promise<Map<number, number>> {
  const { rows } = await mainPool.query<{
    client_id: number;
    sale_type_id: number;
  }>(
    `SELECT DISTINCT ON (client_id) client_id, sale_type_id
     FROM client_payment
     ORDER BY client_id, id DESC`
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(Number(row.client_id), Number(row.sale_type_id));
  }
  return map;
}

function resolveSaleUuid(
  legacyClientId: number,
  legacySaleTypeMap: Map<number, number>,
  salesMap: Map<SaleLookupKey, string>
): string | null {
  const legacySaleTypeId = legacySaleTypeMap.get(legacyClientId);
  if (legacySaleTypeId) {
    const found = salesMap.get(saleLookupKey(legacyClientId, legacySaleTypeId));
    if (found) return found;
  }
  for (const [key, saleUuid] of salesMap) {
    if (key.startsWith(`${legacyClientId}:`)) return saleUuid;
  }
  return null;
}

async function upsertProductTransaction(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  amount: number,
  actionBy: number
): Promise<string> {
  const createdAt = rowCreatedAt(row);

  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM product_transactions WHERE legacy_product_payment_id = $1 LIMIT 1`,
    [row.id]
  );

  const status = amount > 0 ? "COMPLETED" : "ACTIVE";

  if (existing.rows[0]) {
    await modulesPool.query(
      `UPDATE product_transactions SET
         client_id = $2::uuid, product_id = $3::uuid, status = $4::product_transaction_status_enum,
         event_date = $5, remarks = $6, handled_by = $7,
         legacy_entity_type = 'master_only', legacy_entity_id = NULL, updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        existing.rows[0].id,
        clientUuid,
        productUuid,
        status,
        row.payment_date,
        row.remark,
        actionBy,
      ]
    );
    return existing.rows[0].id;
  }

  const inserted = await modulesPool.query<{ id: string }>(
    `INSERT INTO product_transactions (
       client_id, product_id, status, event_date, remarks, handled_by,
       legacy_product_payment_id, legacy_entity_type, legacy_entity_id,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::product_transaction_status_enum, $4, $5, $6,
       $7, 'master_only', NULL, $8, NOW()
     )
     RETURNING id`,
    [
      clientUuid,
      productUuid,
      status,
      row.payment_date,
      row.remark,
      actionBy,
      row.id,
      createdAt,
    ]
  );
  return inserted.rows[0].id;
}

async function upsertTransactionBalance(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  transactionId: string,
  saleUuid: string,
  amount: number
): Promise<string> {
  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM payment_balances
     WHERE product_transaction_id = $1::uuid AND scope = 'PRODUCT'
     LIMIT 1`,
    [transactionId]
  );

  let balanceId: string;
  const total = amount.toFixed(2);
  const paid = amount.toFixed(2);

  if (existing.rows[0]) {
    balanceId = existing.rows[0].id;
    await modulesPool.query(
      `UPDATE payment_balances SET
         sale_id = $2::uuid, total_amount = $3, paid_amount = $4, updated_at = NOW()
       WHERE id = $1::uuid`,
      [balanceId, saleUuid, total, paid]
    );
  } else {
    const inserted = await modulesPool.query<{ id: string }>(
      `INSERT INTO payment_balances (
         scope, client_id, sale_id, product_id, product_transaction_id,
         total_amount, paid_amount, created_at, updated_at
       ) VALUES (
         'PRODUCT'::payment_balance_scope_enum, $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5, $6, $7, NOW()
       )
       RETURNING id`,
      [
        clientUuid,
        saleUuid,
        productUuid,
        transactionId,
        total,
        paid,
        rowCreatedAt(row),
      ]
    );
    balanceId = inserted.rows[0].id;
  }

  await modulesPool.query(
    `UPDATE product_transactions SET balance_id = $2::uuid, updated_at = NOW()
     WHERE id = $1::uuid`,
    [transactionId, balanceId]
  );

  return balanceId;
}

async function upsertAmount(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  transactionId: string,
  balanceId: string,
  saleUuid: string,
  amount: number,
  actionBy: number
): Promise<string> {
  const legacyId = legacyAmountId(row.id);
  const code = amountCode(row.id);
  const createdAt = rowCreatedAt(row);

  const amountResult = await modulesPool.query<{ id: string }>(
    `INSERT INTO amounts (
       client_id, sale_id, legacy_client_payment_id, amount_code, amount_id,
       type, amount, balance_id, product_id, action_by, created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::uuid, 'PRODUCT'::amount_type_enum, $6,
       $7::uuid, $8::uuid, $9, $10, NOW()
     )
     ON CONFLICT (legacy_client_payment_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       sale_id = EXCLUDED.sale_id,
       amount_code = EXCLUDED.amount_code,
       amount_id = EXCLUDED.amount_id,
       amount = EXCLUDED.amount,
       balance_id = EXCLUDED.balance_id,
       product_id = EXCLUDED.product_id,
       action_by = EXCLUDED.action_by,
       updated_at = NOW()
     RETURNING id`,
    [
      clientUuid,
      saleUuid,
      legacyId,
      code,
      transactionId,
      amount.toFixed(2),
      balanceId,
      productUuid,
      actionBy,
      createdAt,
    ]
  );

  return amountResult.rows[0].id;
}

async function upsertDate(
  row: CppRow,
  clientUuid: string,
  amountUuid: string,
  actionBy: number
): Promise<boolean> {
  if (!row.payment_date) return false;

  const legacyId = legacyAmountId(row.id);
  const createdAt = rowCreatedAt(row);

  await modulesPool.query(
    `INSERT INTO dates (
       client_id, amount_id, legacy_client_payment_id, date, action_by,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::date, $5, $6, NOW()
     )
     ON CONFLICT (legacy_client_payment_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       amount_id = EXCLUDED.amount_id,
       date = EXCLUDED.date,
       action_by = EXCLUDED.action_by,
       updated_at = NOW()`,
    [clientUuid, amountUuid, legacyId, row.payment_date, actionBy, createdAt]
  );

  return true;
}

async function upsertRemark(
  row: CppRow,
  clientUuid: string,
  amountUuid: string,
  actionBy: number
): Promise<string | null> {
  const remarkText = row.remark?.trim();
  if (!remarkText) return null;

  const createdAt = rowCreatedAt(row);
  const existingRemark = await modulesPool.query<{ id: string }>(
    `SELECT id FROM remarks WHERE amount_id = $1::uuid LIMIT 1`,
    [amountUuid]
  );

  if (existingRemark.rows[0]) {
    await modulesPool.query(
      `UPDATE remarks SET remark = $2, action_by = $3, updated_at = NOW()
       WHERE id = $1::uuid`,
      [existingRemark.rows[0].id, truncateRemark(remarkText), actionBy]
    );
    return existingRemark.rows[0].id;
  }

  const remarkResult = await modulesPool.query<{ id: string }>(
    `INSERT INTO remarks (client_id, amount_id, remark, action_by, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, NOW())
     RETURNING id`,
    [clientUuid, amountUuid, truncateRemark(remarkText), actionBy, createdAt]
  );
  return remarkResult.rows[0].id;
}

async function upsertInvoice(
  row: CppRow,
  clientUuid: string,
  amountUuid: string,
  amount: number,
  remarkUuid: string | null,
  actionBy: number
): Promise<void> {
  const invNo = invoiceNumber(row.id, row.invoice_no);
  const issuedAt = rowIssuedAt(row);
  const createdAt = rowCreatedAt(row);

  await modulesPool.query(
    `INSERT INTO invoices (
       client_id, invoice_number, invoice_status, invoice_category,
       amount_id, total_amount, remark_id, action_by, issued_at,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2, 'PAID'::invoice_status_enum, 'PRODUCT'::invoice_category_enum,
       $3::uuid, $4, $5::uuid, $6, $7::timestamptz, $8, NOW()
     )
     ON CONFLICT (invoice_number) DO UPDATE SET
       amount_id = EXCLUDED.amount_id,
       total_amount = EXCLUDED.total_amount,
       remark_id = EXCLUDED.remark_id,
       action_by = EXCLUDED.action_by,
       issued_at = EXCLUDED.issued_at,
       updated_at = NOW()`,
    [
      clientUuid,
      invNo,
      amountUuid,
      amount.toFixed(2),
      remarkUuid,
      actionBy,
      issuedAt,
      createdAt,
    ]
  );
}

async function recomputeClientRollups(clientUuids: string[]): Promise<number> {
  if (!clientUuids.length) return 0;
  const result = await modulesPool.query(
    `UPDATE clients c SET
       total_amount = COALESCE(agg.total_sum, 0),
       paid_amount = COALESCE(agg.paid_sum, 0),
       updated_at = NOW()
     FROM (
       SELECT client_id, SUM(total_amount) AS total_sum, SUM(paid_amount) AS paid_sum
       FROM payment_balances WHERE client_id = ANY($1::uuid[])
       GROUP BY client_id
     ) agg
     WHERE c.id = agg.client_id`,
    [clientUuids]
  );
  return result.rowCount ?? 0;
}

async function main() {
  await ensureSchema();

  const clientMap = await loadClientUuidMap();
  if (!clientMap.size) {
    throw new Error(
      "No migrated clients. Run: npm run migrate:module-clients"
    );
  }

  const productMap = await ensureMasterOnlyProducts();
  console.log(`Master-only products ensured: ${productMap.size}`);

  const salesMap = await loadSalesMap();
  if (!salesMap.size) {
    throw new Error(
      "No sales in modules DB. Run: npm run migrate:module-sales"
    );
  }

  const legacySaleTypeMap = await loadClientLegacySaleTypeMap();

  const { rows: payments } = await mainPool.query<CppRow>(
    `SELECT cpp.id, cpp.client_id, cpp.product_name, cpp.amount, cpp.date AS payment_date,
            cpp.invoice_no, cpp.remark, cpp.handled_by, cpp.created_at, ci.counsellor_id
     FROM client_product_payment cpp
     JOIN client_information ci ON ci.id = cpp.client_id
     WHERE cpp.entity_type = 'master_only'
     ORDER BY cpp.id`
  );

  if (!payments.length) {
    console.log("No master_only client_product_payment rows.");
    return;
  }

  let transactionsCreated = 0;
  let balancesUpserted = 0;
  let amountsUpserted = 0;
  let datesUpserted = 0;
  let invoicesUpserted = 0;
  let remarksUpserted = 0;
  let skipped = 0;

  const touchedClients = new Set<string>();
  const productCounts = new Map<string, number>();

  for (const row of payments) {
    const clientUuid = clientMap.get(Number(row.client_id));
    if (!clientUuid) {
      console.warn(`Skip cpp ${row.id}: client ${row.client_id} not migrated`);
      skipped++;
      continue;
    }

    const productUuid = productMap.get(row.product_name);
    if (!productUuid) {
      console.warn(
        `Skip cpp ${row.id}: product ${row.product_name} not in other_products (masterOnly)`
      );
      skipped++;
      continue;
    }

    const saleUuid = resolveSaleUuid(
      Number(row.client_id),
      legacySaleTypeMap,
      salesMap
    );
    if (!saleUuid) {
      console.warn(
        `Skip cpp ${row.id}: no sale for client ${row.client_id} (run migrate:module-sales)`
      );
      skipped++;
      continue;
    }

    const amount = parseMoney(row.amount);
    if (amount <= 0) {
      console.warn(`Skip cpp ${row.id}: amount is zero or missing`);
      skipped++;
      continue;
    }

    const actionBy = Number(row.handled_by ?? row.counsellor_id);

    const isNewTxn = !(await modulesPool.query(
      `SELECT 1 FROM product_transactions WHERE legacy_product_payment_id = $1`,
      [row.id]
    )).rows.length;

    const transactionId = await upsertProductTransaction(
      row,
      clientUuid,
      productUuid,
      amount,
      actionBy
    );
    if (isNewTxn) transactionsCreated++;

    const balanceId = await upsertTransactionBalance(
      row,
      clientUuid,
      productUuid,
      transactionId,
      saleUuid,
      amount
    );
    balancesUpserted++;

    const amountUuid = await upsertAmount(
      row,
      clientUuid,
      productUuid,
      transactionId,
      balanceId,
      saleUuid,
      amount,
      actionBy
    );
    amountsUpserted++;

    if (await upsertDate(row, clientUuid, amountUuid, actionBy)) {
      datesUpserted++;
    }

    const remarkUuid = await upsertRemark(row, clientUuid, amountUuid, actionBy);
    if (remarkUuid) remarksUpserted++;

    await upsertInvoice(
      row,
      clientUuid,
      amountUuid,
      amount,
      remarkUuid,
      actionBy
    );
    invoicesUpserted++;

    touchedClients.add(clientUuid);
    productCounts.set(
      row.product_name,
      (productCounts.get(row.product_name) ?? 0) + 1
    );
  }

  const rollupCount = await recomputeClientRollups([...touchedClients]);

  console.log(`Transactions: ${transactionsCreated} new.`);
  console.log(`Balances: ${balancesUpserted}. Amounts: ${amountsUpserted}.`);
  console.log(`Dates: ${datesUpserted}. Invoices: ${invoicesUpserted}. Remarks: ${remarksUpserted}.`);
  console.log(`Client rollups: ${rollupCount}.`);
  console.log(`Skipped: ${skipped}. Source rows: ${payments.length}.`);
  console.log("By product:");
  for (const [name, count] of [...productCounts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    console.log(`  ${name}: ${count}`);
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
