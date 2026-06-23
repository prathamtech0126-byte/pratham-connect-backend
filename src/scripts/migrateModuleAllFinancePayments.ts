/**
 * Migrate ALL_FINANCE product payments only (main CRM → modules DB).
 *
 * Source: client_product_payment (entity_type = allFinance_id) + all_finance table.
 * Target: product_transactions, payment_balances, amounts, dates, invoices,
 *         remarks, amount_approved.
 *
 * Up to 4 payment slots per row — only slots with amount > 0 are migrated.
 * Does NOT require migrate:module-products (ensures ALL_FINANCE_EMPLOYEMENT product).
 *
 * Prerequisites:
 *   migrate:module-clients → migrate:module-sales → migrate:module-payments (optional)
 *
 * Usage: npm run migrate:module-all-finance-payments
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({
  connectionString: process.env.DATABASE_URL_SECOND,
});

const ALL_FINANCE_PRODUCT_NAME = "ALL_FINANCE_EMPLOYEMENT";
const ALL_FINANCE_PRODUCT_ID = "allFinanceEmployement";

type CppRow = {
  id: number;
  client_id: number;
  amount: string | null;
  payment_date: string | null;
  invoice_no: string | null;
  remark: string | null;
  handled_by: number | null;
  entity_id: number | null;
  counsellor_id: number;
  created_at: Date | null;
};

type PaymentSlot = {
  slot: number;
  amount: number;
  paymentDate: string | null;
  invoiceNo: string | null;
  remark: string | null;
};

type AllFinanceExtract = {
  eventDate: string | null;
  remarks: string | null;
  paymentSlots: PaymentSlot[];
  totalAmount: number;
  paidSum: number;
  approval?: {
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    approvedBy: number | null;
    approvedAt: Date | null;
    requestedBy: number;
    requestedAmount: number;
    approvedAmount: number | null;
  };
};

type SaleLookupKey = string;

function parseMoney(value: string | null | undefined): number {
  const n = parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function truncateRemark(text: string, max = 100): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + "...";
}

function legacyAmountId(cppId: number, slot: number): number {
  return -(cppId * 10 + slot);
}

function amountCode(cppId: number, slot: number): string {
  return slot === 1 ? `CPP-${cppId}` : `CPP-${cppId}-P${slot}`;
}

function invoiceNumber(
  cppId: number,
  slot: number,
  explicit: string | null | undefined
): string {
  const no = explicit?.trim();
  if (no) return no;
  return slot === 1 ? `CPP-INV-${cppId}` : `CPP-INV-${cppId}-P${slot}`;
}

function saleLookupKey(
  legacyClientId: number,
  legacySaleTypeId: number
): SaleLookupKey {
  return `${legacyClientId}:${legacySaleTypeId}`;
}

function mapFinanceApproval(
  status: string | null,
  partialPayment: boolean | null
): "PENDING_APPROVAL" | "APPROVED" | "REJECTED" {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  if (partialPayment === true) return "PENDING_APPROVAL";
  return "APPROVED";
}

function slotFromFinance(
  slot: number,
  amount: string | null,
  paymentDate: string | null,
  invoiceNo: string | null,
  remark: string | null
): PaymentSlot | null {
  const amt = parseMoney(amount);
  if (amt <= 0) return null;
  return { slot, amount: amt, paymentDate, invoiceNo, remark };
}

async function ensureAllFinanceProduct(): Promise<string> {
  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM products WHERE product_name = $1 LIMIT 1`,
    [ALL_FINANCE_PRODUCT_NAME]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows } = await mainPool.query<{
    id: number;
    name: string;
    description: string | null;
    display_order: number | null;
    is_active: boolean;
  }>(
    `SELECT id, name, description, display_order, is_active
     FROM other_products WHERE product_name = $1 LIMIT 1`,
    [ALL_FINANCE_PRODUCT_NAME]
  );
  const legacy = rows[0];

  const inserted = await modulesPool.query<{ id: string }>(
    `INSERT INTO products (
       legacy_other_product_id, product_id, name, product_name,
       description, display_order, is_active, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (product_name) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [
      legacy?.id ?? null,
      ALL_FINANCE_PRODUCT_ID,
      legacy?.name ?? "All Finance & Employment",
      ALL_FINANCE_PRODUCT_NAME,
      legacy?.description ?? "Core finance and employment package",
      legacy?.display_order ?? 100,
      legacy?.is_active ?? true,
    ]
  );
  return inserted.rows[0].id;
}

async function ensureSchema(): Promise<void> {
  await modulesPool.query(`
    ALTER TABLE amounts ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES sales(id)
  `);

  const { rows: amountCols } = await modulesPool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'amounts'
       AND column_name IN ('sale_type_id', 'sale_id')`
  );
  const amountColSet = new Set(amountCols.map((r) => r.column_name));
  if (amountColSet.has("sale_type_id")) {
    await modulesPool.query(
      `UPDATE amounts a
       SET sale_id = s.id
       FROM sales s
       JOIN clients c ON c.id = s.client_id
       JOIN sale_type st ON st.id = s.sale_type_id
       WHERE a.client_id = c.id
         AND a.sale_type_id = st.id
         AND a.sale_id IS NULL`
    );
    await modulesPool.query(`ALTER TABLE amounts DROP COLUMN IF EXISTS sale_type_id`);
  }

  const { rows: pbCols } = await modulesPool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_balances'
       AND column_name IN ('sale_type_id', 'sale_id')`
  );
  const pbColSet = new Set(pbCols.map((r) => r.column_name));
  if (pbColSet.has("sale_type_id") && pbColSet.has("sale_id")) {
    await modulesPool.query(
      `UPDATE payment_balances pb
       SET sale_id = s.id
       FROM sales s
       WHERE pb.client_id = s.client_id
         AND pb.sale_type_id = s.sale_type_id
         AND pb.sale_id IS NULL`
    );
    await modulesPool.query(
      `ALTER TABLE payment_balances DROP COLUMN IF EXISTS sale_type_id`
    );
  }
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

async function fetchAllFinanceExtract(
  row: CppRow
): Promise<AllFinanceExtract | null> {
  if (!row.entity_id) return null;

  const { rows } = await mainPool.query(
    `SELECT total_amount, amount, payment_date, invoice_no, partial_payment,
            approval_status, approved_by, approved_at, remarks,
            another_payment_amount, another_payment_date,
            another_payment_amount2, another_payment_date2,
            another_payment_amount3, another_payment_date3
     FROM all_finance WHERE id = $1`,
    [row.entity_id]
  );
  const af = rows[0];
  if (!af) return null;

  const total = parseMoney(af.total_amount) || parseMoney(af.amount);
  const slots: PaymentSlot[] = [];
  for (const s of [
    slotFromFinance(1, af.amount, af.payment_date, af.invoice_no, af.remarks),
    slotFromFinance(
      2,
      af.another_payment_amount,
      af.another_payment_date,
      null,
      null
    ),
    slotFromFinance(
      3,
      af.another_payment_amount2,
      af.another_payment_date2,
      null,
      null
    ),
    slotFromFinance(
      4,
      af.another_payment_amount3,
      af.another_payment_date3,
      null,
      null
    ),
  ]) {
    if (s) slots.push(s);
  }

  const paidSum = slots.reduce((sum, s) => sum + s.amount, 0);
  const approvalStatus = mapFinanceApproval(
    af.approval_status,
    af.partial_payment
  );

  return {
    eventDate: af.payment_date ?? row.payment_date,
    remarks: af.remarks ?? row.remark,
    paymentSlots: slots,
    totalAmount: total > 0 ? total : paidSum,
    paidSum,
    approval:
      slots.length > 0
        ? {
            status: approvalStatus,
            approvedBy: af.approved_by ? Number(af.approved_by) : null,
            approvedAt: af.approved_at ?? null,
            requestedBy: Number(row.handled_by ?? row.counsellor_id),
            requestedAmount: total > 0 ? total : slots[0].amount,
            approvedAmount:
              approvalStatus === "APPROVED"
                ? paidSum > 0
                  ? paidSum
                  : parseMoney(af.amount)
                : null,
          }
        : undefined,
  };
}

async function upsertProductTransaction(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  extract: AllFinanceExtract,
  actionBy: number
): Promise<string> {
  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM product_transactions WHERE legacy_product_payment_id = $1 LIMIT 1`,
    [row.id]
  );

  const status =
    extract.paidSum >= extract.totalAmount && extract.totalAmount > 0
      ? "COMPLETED"
      : "ACTIVE";

  if (existing.rows[0]) {
    await modulesPool.query(
      `UPDATE product_transactions SET
         client_id = $2::uuid, product_id = $3::uuid, status = $4::product_transaction_status_enum,
         event_date = $5, remarks = $6, handled_by = $7,
         legacy_entity_type = 'allFinance_id', legacy_entity_id = $8, updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        existing.rows[0].id,
        clientUuid,
        productUuid,
        status,
        extract.eventDate,
        extract.remarks,
        actionBy,
        row.entity_id,
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
       $7, 'allFinance_id', $8, $9, NOW()
     )
     RETURNING id`,
    [
      clientUuid,
      productUuid,
      status,
      extract.eventDate,
      extract.remarks,
      actionBy,
      row.id,
      row.entity_id,
      row.created_at ?? new Date(),
    ]
  );
  return inserted.rows[0].id;
}

async function upsertTransactionBalance(
  clientUuid: string,
  productUuid: string,
  transactionId: string,
  saleUuid: string,
  totalAmount: number,
  paidSum: number
): Promise<string> {
  const total = Math.max(totalAmount, paidSum);
  const paid = Math.min(paidSum, total);

  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM payment_balances
     WHERE product_transaction_id = $1::uuid AND scope = 'PRODUCT'
     LIMIT 1`,
    [transactionId]
  );

  let balanceId: string;

  if (existing.rows[0]) {
    balanceId = existing.rows[0].id;
    await modulesPool.query(
      `UPDATE payment_balances SET
         sale_id = $2::uuid, total_amount = $3, paid_amount = $4, updated_at = NOW()
       WHERE id = $1::uuid`,
      [balanceId, saleUuid, total.toFixed(2), paid.toFixed(2)]
    );
  } else {
    const inserted = await modulesPool.query<{ id: string }>(
      `INSERT INTO payment_balances (
         scope, client_id, sale_id, product_id, product_transaction_id,
         total_amount, paid_amount, created_at, updated_at
       ) VALUES (
         'PRODUCT'::payment_balance_scope_enum, $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         $5, $6, NOW(), NOW()
       )
       RETURNING id`,
      [
        clientUuid,
        saleUuid,
        productUuid,
        transactionId,
        total.toFixed(2),
        paid.toFixed(2),
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

async function upsertDate(
  clientUuid: string,
  amountUuid: string,
  legacyId: number,
  paymentDate: string | null,
  actionBy: number,
  createdAt: Date
): Promise<void> {
  if (!paymentDate) return;

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
    [clientUuid, amountUuid, legacyId, paymentDate, actionBy, createdAt]
  );
}

async function upsertPaymentSlot(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  transactionId: string,
  balanceId: string,
  slot: PaymentSlot,
  actionBy: number,
  saleUuid: string
): Promise<string> {
  const code = amountCode(row.id, slot.slot);
  const legacyId = legacyAmountId(row.id, slot.slot);
  const createdAt = slot.paymentDate
    ? new Date(slot.paymentDate)
    : row.created_at ?? new Date();

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
      slot.amount.toFixed(2),
      balanceId,
      productUuid,
      actionBy,
      createdAt,
    ]
  );

  const amountUuid = amountResult.rows[0].id;

  await upsertDate(
    clientUuid,
    amountUuid,
    legacyId,
    slot.paymentDate,
    actionBy,
    createdAt
  );

  const remarkText = slot.remark?.trim();
  let remarkUuid: string | null = null;
  if (remarkText) {
    const existingRemark = await modulesPool.query<{ id: string }>(
      `SELECT id FROM remarks WHERE amount_id = $1::uuid LIMIT 1`,
      [amountUuid]
    );
    if (existingRemark.rows[0]) {
      remarkUuid = existingRemark.rows[0].id;
      await modulesPool.query(
        `UPDATE remarks SET remark = $2, action_by = $3, updated_at = NOW()
         WHERE id = $1::uuid`,
        [remarkUuid, truncateRemark(remarkText), actionBy]
      );
    } else {
      const remarkResult = await modulesPool.query<{ id: string }>(
        `INSERT INTO remarks (client_id, amount_id, remark, action_by, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, NOW(), NOW())
         RETURNING id`,
        [clientUuid, amountUuid, truncateRemark(remarkText), actionBy]
      );
      remarkUuid = remarkResult.rows[0].id;
    }
  }

  const invNo = invoiceNumber(row.id, slot.slot, slot.invoiceNo);
  await modulesPool.query(
    `INSERT INTO invoices (
       client_id, invoice_number, invoice_status, invoice_category,
       amount_id, total_amount, remark_id, action_by, issued_at,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2, 'PAID'::invoice_status_enum, 'PRODUCT'::invoice_category_enum,
       $3::uuid, $4, $5::uuid, $6, $7::timestamptz, NOW(), NOW()
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
      slot.amount.toFixed(2),
      remarkUuid,
      actionBy,
      slot.paymentDate ?? row.created_at ?? new Date(),
    ]
  );

  return amountUuid;
}

async function upsertFinanceApproval(
  amountUuid: string,
  approval: NonNullable<AllFinanceExtract["approval"]>
): Promise<void> {
  const existing = await modulesPool.query<{ id: string }>(
    `SELECT id FROM amount_approved WHERE amount_id = $1::uuid LIMIT 1`,
    [amountUuid]
  );

  const approvedDate = approval.approvedAt
    ? approval.approvedAt.toISOString().slice(0, 10)
    : null;

  if (existing.rows[0]) {
    await modulesPool.query(
      `UPDATE amount_approved SET
         requested_amount = $2, approved_amount = $3,
         status = $4::approval_status_enum,
         requested_by = $5, approved_by = $6, approved_date = $7,
         reviewed_at = $8, updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        existing.rows[0].id,
        approval.requestedAmount.toFixed(2),
        approval.approvedAmount?.toFixed(2) ?? null,
        approval.status,
        approval.requestedBy,
        approval.approvedBy,
        approvedDate,
        approval.approvedAt,
      ]
    );
    return;
  }

  await modulesPool.query(
    `INSERT INTO amount_approved (
       amount_id, requested_amount, approved_amount, status,
       requested_by, approved_by, approved_date, reviewed_at,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2, $3, $4::approval_status_enum,
       $5, $6, $7, $8, NOW(), NOW()
     )`,
    [
      amountUuid,
      approval.requestedAmount.toFixed(2),
      approval.approvedAmount?.toFixed(2) ?? null,
      approval.status,
      approval.requestedBy,
      approval.approvedBy,
      approvedDate,
      approval.approvedAt,
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

  const productUuid = await ensureAllFinanceProduct();
  console.log(`All Finance product: ${productUuid}`);

  const salesMap = await loadSalesMap();
  if (!salesMap.size) {
    throw new Error(
      "No sales in modules DB. Run: npm run migrate:module-sales"
    );
  }

  const legacySaleTypeMap = await loadClientLegacySaleTypeMap();

  const { rows: payments } = await mainPool.query<CppRow>(
    `SELECT cpp.id, cpp.client_id, cpp.amount, cpp.date AS payment_date,
            cpp.invoice_no, cpp.remark, cpp.handled_by, cpp.entity_id,
            cpp.created_at, ci.counsellor_id
     FROM client_product_payment cpp
     JOIN client_information ci ON ci.id = cpp.client_id
     WHERE cpp.entity_type = 'allFinance_id'
       AND cpp.product_name = $1
     ORDER BY cpp.id`,
    [ALL_FINANCE_PRODUCT_NAME]
  );

  if (!payments.length) {
    console.log("No all_finance client_product_payment rows.");
    return;
  }

  let transactionsCreated = 0;
  let balancesUpserted = 0;
  let amountsUpserted = 0;
  let datesUpserted = 0;
  let approvalsUpserted = 0;
  let skipped = 0;

  const touchedClients = new Set<string>();

  for (const row of payments) {
    const clientUuid = clientMap.get(Number(row.client_id));
    if (!clientUuid) {
      console.warn(`Skip cpp ${row.id}: client ${row.client_id} not migrated`);
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

    const extract = await fetchAllFinanceExtract(row);
    if (!extract) {
      console.warn(`Skip cpp ${row.id}: all_finance entity ${row.entity_id} missing`);
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
      extract,
      actionBy
    );
    if (isNewTxn) transactionsCreated++;

    const balanceId = await upsertTransactionBalance(
      clientUuid,
      productUuid,
      transactionId,
      saleUuid,
      extract.totalAmount,
      extract.paidSum
    );
    balancesUpserted++;

    touchedClients.add(clientUuid);

    let firstAmountUuid: string | null = null;
    for (const slot of extract.paymentSlots) {
      const amountUuid = await upsertPaymentSlot(
        row,
        clientUuid,
        productUuid,
        transactionId,
        balanceId,
        slot,
        actionBy,
        saleUuid
      );
      amountsUpserted++;
      if (slot.paymentDate) datesUpserted++;
      if (slot.slot === 1) firstAmountUuid = amountUuid;
    }

    if (extract.approval && firstAmountUuid) {
      await upsertFinanceApproval(firstAmountUuid, extract.approval);
      approvalsUpserted++;
    }
  }

  const rollupCount = await recomputeClientRollups([...touchedClients]);

  console.log(`All Finance transactions: ${transactionsCreated} new.`);
  console.log(`Balances upserted: ${balancesUpserted}.`);
  console.log(`Amount/invoices: ${amountsUpserted} payment slots.`);
  console.log(`Dates: ${datesUpserted}. Approvals: ${approvalsUpserted}.`);
  console.log(`Client rollups: ${rollupCount}.`);
  console.log(`Skipped: ${skipped}. Source rows: ${payments.length}.`);
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
