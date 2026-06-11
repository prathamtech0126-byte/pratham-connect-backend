/**
 * Migrate client_payment (main CRM) → payment_balances, amounts, remarks, invoices,
 * and installment_plans + installments (modules DB).
 *
 * Stage rules:
 *   INITIAL        — one-time full payment → single amount + PAID invoice (no installment plan)
 *   BEFORE_VISA    — counsellor may collect multiple times → installment plan when 2–5 payments
 *   AFTER_VISA     — counsellor may collect multiple times → installment plan when 2–5 payments
 *   SUBMITTED_VISA — recorded on amounts only; does not reduce CORE paidAmount
 *
 * Mapping:
 *   client_payment.total_payment → payment_balances (CORE) totalAmount
 *   client_payment.amount (INITIAL/BEFORE/AFTER) → paidAmount on CORE balance
 *   client_payment (per row)       → amounts (CORE payment line, linked by legacy_client_payment_id)
 *   client_payment.payment_date    → dates.date (one row per payment, linked to amounts.id)
 *   client_payment.remarks         → remarks.remark (when present, linked to amounts.id)
 *   client_payment.invoice_no      → invoices.invoice_number
 *   client_payment.payment_date    → invoices.issued_at / installments.paid_date
 *
 * Usage: npm run migrate:module-payments
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type PaymentRow = {
  id: number;
  client_id: number;
  sale_type_id: number;
  total_payment: string;
  stage: string;
  amount: string;
  payment_date: string;
  invoice_no: string | null;
  remarks: string | null;
  handled_by: number | null;
  counsellor_id: number;
  created_at: Date | null;
};

type ClientBalanceAgg = {
  clientUuid: string;
  saleId: string;
  totalPayment: number;
  paidSum: number;
};

type SaleLookupKey = string;

function saleLookupKey(legacyClientId: number, legacySaleTypeId: number): SaleLookupKey {
  return `${legacyClientId}:${legacySaleTypeId}`;
}

type StageGroupKey = string;

const PAID_STAGES = new Set(["INITIAL", "BEFORE_VISA", "AFTER_VISA"]);
const VALID_STAGES = new Set([
  "INITIAL",
  "BEFORE_VISA",
  "AFTER_VISA",
  "SUBMITTED_VISA",
]);
const INSTALLMENT_STAGES = new Set(["BEFORE_VISA", "AFTER_VISA"]);

function amountCode(paymentId: number): string {
  return `CP-${paymentId}`;
}

function invoiceNumber(row: PaymentRow): string {
  const no = row.invoice_no?.trim();
  if (no) return no;
  return `CP-INV-${row.id}`;
}

function finalInvoiceNumber(clientUuid: string, stage: string): string {
  return `CP-FINAL-${stage}-${clientUuid.slice(0, 8)}`;
}

function proformaInvoiceNumber(row: PaymentRow): string {
  const no = row.invoice_no?.trim();
  if (no) return no;
  return `CP-PRO-${row.id}`;
}

function truncateRemark(text: string, max = 100): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + "...";
}

function parseMoney(value: string | null | undefined): number {
  const n = parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function stageGroupKey(saleUuid: string, stage: string): StageGroupKey {
  return `${saleUuid}:${stage}`;
}

async function loadClientUuidMap(): Promise<Map<number, string>> {
  const { rows } = await modulesPool.query<{
    legacy_client_id: number;
    id: string;
  }>(`SELECT legacy_client_id, id FROM clients WHERE legacy_client_id IS NOT NULL`);

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(Number(row.legacy_client_id), row.id);
  }
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
      saleLookupKey(Number(row.legacy_client_id), Number(row.legacy_sale_type_id)),
      row.id
    );
  }
  return map;
}

function resolveSaleUuid(
  legacyClientId: number,
  legacySaleTypeId: number,
  salesMap: Map<SaleLookupKey, string>
): string | null {
  return salesMap.get(saleLookupKey(legacyClientId, legacySaleTypeId)) ?? null;
}

function buildBalanceAggregates(
  payments: PaymentRow[],
  clientMap: Map<number, string>,
  salesMap: Map<SaleLookupKey, string>
): Map<string, ClientBalanceAgg> {
  const aggs = new Map<string, ClientBalanceAgg>();

  for (const row of payments) {
    const legacyClientId = Number(row.client_id);
    const legacySaleTypeId = Number(row.sale_type_id);
    const clientUuid = clientMap.get(legacyClientId);
    if (!clientUuid) continue;

    const saleUuid = resolveSaleUuid(legacyClientId, legacySaleTypeId, salesMap);
    if (!saleUuid) continue;

    const aggKey = saleUuid;
    let agg = aggs.get(aggKey);
    if (!agg) {
      agg = {
        clientUuid,
        saleId: saleUuid,
        totalPayment: 0,
        paidSum: 0,
      };
      aggs.set(aggKey, agg);
    }

    const totalPayment = parseMoney(row.total_payment);
    if (totalPayment > agg.totalPayment) {
      agg.totalPayment = totalPayment;
    }

    if (PAID_STAGES.has(row.stage)) {
      agg.paidSum += parseMoney(row.amount);
    }
  }

  return aggs;
}

/** Legacy rows sometimes sum to more than max(total_payment); keep paid_amount <= total_amount. */
function normalizeBalanceTotals(agg: ClientBalanceAgg): {
  totalAmount: number;
  paidAmount: number;
} {
  const paidAmount = agg.paidSum;
  const totalAmount = Math.max(agg.totalPayment, paidAmount);
  return { totalAmount, paidAmount };
}

async function upsertCoreBalances(
  aggs: Map<string, ClientBalanceAgg>
): Promise<Map<string, string>> {
  const balanceBySale = new Map<string, string>();
  let adjustedTotals = 0;

  for (const agg of aggs.values()) {
    const { totalAmount, paidAmount } = normalizeBalanceTotals(agg);
    if (paidAmount > agg.totalPayment) {
      adjustedTotals++;
      console.warn(
        `Sale ${agg.saleId}: paid ${paidAmount.toFixed(2)} exceeds recorded total ${agg.totalPayment.toFixed(2)} — using total ${totalAmount.toFixed(2)}`
      );
    }

    const existing = await modulesPool.query<{ id: string }>(
      `SELECT id FROM payment_balances
       WHERE sale_id = $1::uuid AND scope = 'CORE'::payment_balance_scope_enum
       LIMIT 1`,
      [agg.saleId]
    );

    let balanceId: string;

    if (existing.rows[0]) {
      balanceId = existing.rows[0].id;
      await modulesPool.query(
        `UPDATE payment_balances SET
           client_id = $2::uuid,
           total_amount = $3,
           paid_amount = $4,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          balanceId,
          agg.clientUuid,
          totalAmount.toFixed(2),
          paidAmount.toFixed(2),
        ]
      );
    } else {
      const inserted = await modulesPool.query<{ id: string }>(
        `INSERT INTO payment_balances (
           scope, client_id, sale_id, total_amount, paid_amount,
           created_at, updated_at
         ) VALUES (
           'CORE'::payment_balance_scope_enum, $1::uuid, $2::uuid, $3, $4, NOW(), NOW()
         )
         RETURNING id`,
        [
          agg.clientUuid,
          agg.saleId,
          totalAmount.toFixed(2),
          paidAmount.toFixed(2),
        ]
      );
      balanceId = inserted.rows[0].id;
    }

    balanceBySale.set(agg.saleId, balanceId);
  }

  if (adjustedTotals > 0) {
    console.warn(
      `Adjusted total_amount for ${adjustedTotals} client(s) where paid exceeded recorded total.`
    );
  }

  return balanceBySale;
}

async function recomputeClientRollups(clientUuids: string[]): Promise<number> {
  if (!clientUuids.length) return 0;

  const result = await modulesPool.query(
    `UPDATE clients c SET
       total_amount = COALESCE(agg.total_sum, 0),
       paid_amount = COALESCE(agg.paid_sum, 0),
       updated_at = NOW()
     FROM (
       SELECT
         client_id,
         SUM(total_amount) AS total_sum,
         SUM(paid_amount) AS paid_sum
       FROM payment_balances
       WHERE client_id = ANY($1::uuid[])
       GROUP BY client_id
     ) agg
     WHERE c.id = agg.client_id`,
    [clientUuids]
  );

  return result.rowCount ?? 0;
}

type Counters = {
  amountsCreated: number;
  amountsUpdated: number;
  datesCreated: number;
  datesUpdated: number;
  remarksCreated: number;
  remarksUpdated: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  plansCreated: number;
  plansUpdated: number;
  installmentsCreated: number;
  installmentsUpdated: number;
  skipped: number;
};

async function ensureSaleLinkedPaymentSchema(): Promise<void> {
  await modulesPool.query("DROP INDEX IF EXISTS uniq_sales_client_id");
  await modulesPool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_client_sale_type ON sales(client_id, sale_type_id)"
  );

  await modulesPool.query(`
    ALTER TABLE amounts
      ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES sales(id)
  `);
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_amounts_sale_id ON amounts(sale_id)"
  );

  const { rows: pbCols } = await modulesPool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'payment_balances'
       AND column_name IN ('sale_type_id', 'sale_id')`
  );
  const pbColSet = new Set(pbCols.map((r) => r.column_name));

  if (!pbColSet.has("sale_id")) {
    await modulesPool.query(
      `ALTER TABLE payment_balances ADD COLUMN sale_id uuid REFERENCES sales(id)`
    );
  }

  if (pbColSet.has("sale_type_id")) {
    await modulesPool.query(
      `UPDATE payment_balances pb
       SET sale_id = s.id
       FROM sales s
       WHERE pb.client_id = s.client_id
         AND pb.sale_type_id = s.sale_type_id
         AND pb.sale_id IS NULL`
    );
    await modulesPool.query(
      `ALTER TABLE payment_balances DROP COLUMN sale_type_id`
    );
  }

  await modulesPool.query("DROP INDEX IF EXISTS uniq_payment_balances_core_client");
  await modulesPool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_balances_core_sale
     ON payment_balances(sale_id)
     WHERE scope = 'CORE'::payment_balance_scope_enum`
  );

  const { rows: ipCols } = await modulesPool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'installment_plans'
       AND column_name IN ('sale_type_id', 'sale_id')`
  );
  const ipColSet = new Set(ipCols.map((r) => r.column_name));

  if (!ipColSet.has("sale_id")) {
    await modulesPool.query(
      `ALTER TABLE installment_plans ADD COLUMN sale_id uuid REFERENCES sales(id)`
    );
  }

  if (ipColSet.has("sale_type_id")) {
    await modulesPool.query(
      `UPDATE installment_plans ip
       SET sale_id = pb.sale_id
       FROM payment_balances pb
       WHERE ip.balance_id = pb.id
         AND ip.sale_id IS NULL
         AND pb.sale_id IS NOT NULL`
    );
    await modulesPool.query(
      `UPDATE installment_plans ip
       SET sale_id = s.id
       FROM sales s
       WHERE ip.client_id = s.client_id
         AND ip.sale_type_id = s.sale_type_id
         AND ip.sale_id IS NULL`
    );
    await modulesPool.query(
      `ALTER TABLE installment_plans DROP COLUMN sale_type_id`
    );
  }
}

async function ensureDatesSchema(): Promise<void> {
  const { rows } = await modulesPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'dates'
     ) AS exists`
  );
  if (!rows[0]?.exists) {
    await modulesPool.query(`
      CREATE TABLE dates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES clients(id),
        amount_id uuid REFERENCES amounts(id),
        legacy_client_payment_id bigint UNIQUE,
        date date NOT NULL,
        action_by bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  await modulesPool.query(`
    ALTER TABLE dates
      ADD COLUMN IF NOT EXISTS amount_id uuid REFERENCES amounts(id)
  `);
  await modulesPool.query(`
    ALTER TABLE dates
      ADD COLUMN IF NOT EXISTS legacy_client_payment_id bigint UNIQUE
  `);
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_dates_client_id ON dates(client_id)"
  );
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_dates_amount_id ON dates(amount_id)"
  );
  await modulesPool.query(
    "CREATE INDEX IF NOT EXISTS idx_dates_legacy_client_payment_id ON dates(legacy_client_payment_id)"
  );
}

async function upsertAmount(
  row: PaymentRow,
  clientUuid: string,
  saleUuid: string,
  balanceId: string,
  counters: Counters
): Promise<string> {
  const actionBy = Number(row.handled_by ?? row.counsellor_id);
  const code = amountCode(Number(row.id));
  const paymentAmount = row.amount || "0";
  const consultancyStage = VALID_STAGES.has(row.stage) ? row.stage : null;

  const amountResult = await modulesPool.query<{
    id: string;
    inserted: boolean;
  }>(
    `INSERT INTO amounts (
       client_id, sale_id, legacy_client_payment_id, amount_code, amount_id,
       type, amount, balance_id, consultancy_stage, action_by, created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::uuid, 'CORE'::amount_type_enum, $6,
       $7::uuid, $8::consultancy_stage_enum, $9, $10, NOW()
     )
     ON CONFLICT (legacy_client_payment_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       sale_id = EXCLUDED.sale_id,
       amount_code = EXCLUDED.amount_code,
       amount_id = EXCLUDED.amount_id,
       type = EXCLUDED.type,
       amount = EXCLUDED.amount,
       balance_id = EXCLUDED.balance_id,
       consultancy_stage = EXCLUDED.consultancy_stage,
       action_by = EXCLUDED.action_by,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      clientUuid,
      saleUuid,
      Number(row.id),
      code,
      clientUuid,
      paymentAmount,
      balanceId,
      consultancyStage,
      actionBy,
      row.created_at ?? new Date(row.payment_date),
    ]
  );

  if (amountResult.rows[0].inserted) counters.amountsCreated++;
  else counters.amountsUpdated++;

  return amountResult.rows[0].id;
}

async function upsertDate(
  row: PaymentRow,
  clientUuid: string,
  amountUuid: string,
  counters: Counters
): Promise<void> {
  const actionBy = Number(row.handled_by ?? row.counsellor_id);

  const dateResult = await modulesPool.query<{ inserted: boolean }>(
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
       updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [
      clientUuid,
      amountUuid,
      Number(row.id),
      row.payment_date,
      actionBy,
      row.created_at ?? new Date(row.payment_date),
    ]
  );

  if (dateResult.rows[0]?.inserted) counters.datesCreated++;
  else counters.datesUpdated++;
}

async function upsertRemark(
  row: PaymentRow,
  clientUuid: string,
  amountUuid: string,
  counters: Counters
): Promise<string | null> {
  const remarkText = row.remarks?.trim();
  if (!remarkText) return null;

  const actionBy = Number(row.handled_by ?? row.counsellor_id);
  const existingRemark = await modulesPool.query<{ id: string }>(
    `SELECT id FROM remarks WHERE amount_id = $1::uuid LIMIT 1`,
    [amountUuid]
  );

  if (existingRemark.rows[0]) {
    await modulesPool.query(
      `UPDATE remarks SET
         client_id = $2::uuid, remark = $3, action_by = $4, updated_at = NOW()
       WHERE id = $1::uuid`,
      [existingRemark.rows[0].id, clientUuid, truncateRemark(remarkText), actionBy]
    );
    counters.remarksUpdated++;
    return existingRemark.rows[0].id;
  }

  const remarkResult = await modulesPool.query<{ id: string }>(
    `INSERT INTO remarks (client_id, amount_id, remark, action_by, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, NOW())
     RETURNING id`,
    [
      clientUuid,
      amountUuid,
      truncateRemark(remarkText),
      actionBy,
      row.created_at ?? new Date(row.payment_date),
    ]
  );
  counters.remarksCreated++;
  return remarkResult.rows[0].id;
}

async function upsertInvoice(
  params: {
    clientUuid: string;
    invoiceNo: string;
    status: "PAID" | "PROFORMA";
    amountUuid: string;
    totalAmount: string;
    remarkUuid: string | null;
    actionBy: number;
    issuedAt: string | Date;
    createdAt: string | Date;
  },
  counters: Counters
): Promise<string> {
  const invoiceResult = await modulesPool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO invoices (
       client_id, invoice_number, invoice_status, invoice_category,
       amount_id, total_amount, remark_id, action_by, issued_at,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2, $3::invoice_status_enum, 'CORE'::invoice_category_enum,
       $4::uuid, $5, $6::uuid, $7, $8::timestamptz, $9, NOW()
     )
     ON CONFLICT (invoice_number) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       invoice_status = EXCLUDED.invoice_status,
       amount_id = EXCLUDED.amount_id,
       total_amount = EXCLUDED.total_amount,
       remark_id = EXCLUDED.remark_id,
       action_by = EXCLUDED.action_by,
       issued_at = EXCLUDED.issued_at,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      params.clientUuid,
      params.invoiceNo,
      params.status,
      params.amountUuid,
      params.totalAmount,
      params.remarkUuid,
      params.actionBy,
      params.issuedAt,
      params.createdAt,
    ]
  );

  if (invoiceResult.rows[0].inserted) counters.invoicesCreated++;
  else counters.invoicesUpdated++;

  return invoiceResult.rows[0].id;
}

/**
 * INITIAL and SUBMITTED_VISA — always one row → one amount (+ invoice for INITIAL only).
 */
async function processOneTimePayment(
  row: PaymentRow,
  clientUuid: string,
  saleUuid: string,
  balanceId: string,
  counters: Counters
): Promise<void> {
  const amountUuid = await upsertAmount(
    row,
    clientUuid,
    saleUuid,
    balanceId,
    counters
  );
  await upsertDate(row, clientUuid, amountUuid, counters);
  const remarkUuid = await upsertRemark(row, clientUuid, amountUuid, counters);

  if (row.stage === "SUBMITTED_VISA") return;

  const actionBy = Number(row.handled_by ?? row.counsellor_id);
  await upsertInvoice(
    {
      clientUuid,
      invoiceNo: invoiceNumber(row),
      status: "PAID",
      amountUuid,
      totalAmount: row.amount || "0",
      remarkUuid,
      actionBy,
      issuedAt: row.payment_date,
      createdAt: row.created_at ?? new Date(row.payment_date),
    },
    counters
  );
}

/**
 * BEFORE_VISA / AFTER_VISA with a single collection — one-time for that stage.
 */
async function processSingleStagePayment(
  row: PaymentRow,
  clientUuid: string,
  saleUuid: string,
  balanceId: string,
  counters: Counters
): Promise<void> {
  await processOneTimePayment(row, clientUuid, saleUuid, balanceId, counters);
}

/**
 * BEFORE_VISA / AFTER_VISA with 2–5 collections — installment plan per stage.
 */
async function processInstallmentStageGroup(
  rows: PaymentRow[],
  clientUuid: string,
  saleUuid: string,
  balanceId: string,
  stage: string,
  counters: Counters
): Promise<void> {
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime() ||
      a.id - b.id
  );

  const paidSum = sorted.reduce((sum, r) => sum + parseMoney(r.amount), 0);
  const installmentCount = sorted.length;
  const requestedBy = Number(sorted[0].handled_by ?? sorted[0].counsellor_id);
  const planStatus = "COMPLETED";

  const existingPlan = await modulesPool.query<{ id: string }>(
    `SELECT id FROM installment_plans
     WHERE sale_id = $1::uuid
       AND payment_category = 'CORE'::installment_payment_category_enum
       AND consultancy_stage = $2::installment_consultancy_stage_enum
     LIMIT 1`,
    [saleUuid, stage]
  );

  let planId: string;

  if (existingPlan.rows[0]) {
    planId = existingPlan.rows[0].id;
    await modulesPool.query(
      `UPDATE installment_plans SET
         balance_id = $2::uuid,
         total_amount = $3,
         paid_amount = $4,
         installment_count = $5,
         status = $6::installment_plan_status_enum,
         sale_id = $7,
         requested_by = $8,
         updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        planId,
        balanceId,
        paidSum.toFixed(2),
        paidSum.toFixed(2),
        installmentCount,
        planStatus,
        saleUuid,
        requestedBy,
      ]
    );
    counters.plansUpdated++;
  } else {
    const inserted = await modulesPool.query<{ id: string }>(
      `INSERT INTO installment_plans (
         client_id, balance_id, payment_category, consultancy_stage,
         total_amount, paid_amount, installment_count, status,
         sale_id, requested_by, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, 'CORE'::installment_payment_category_enum,
         $3::installment_consultancy_stage_enum,
         $4, $5, $6, $7::installment_plan_status_enum,
         $8, $9, NOW(), NOW()
       )
       RETURNING id`,
      [
        clientUuid,
        balanceId,
        stage,
        paidSum.toFixed(2),
        paidSum.toFixed(2),
        installmentCount,
        planStatus,
        saleUuid,
        requestedBy,
      ]
    );
    planId = inserted.rows[0].id;
    counters.plansCreated++;
  }

  let lastAmountUuid: string | null = null;
  let lastRemarkUuid: string | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const installmentNumber = i + 1;
    const actionBy = Number(row.handled_by ?? row.counsellor_id);

    const amountUuid = await upsertAmount(
      row,
      clientUuid,
      saleUuid,
      balanceId,
      counters
    );
    await upsertDate(row, clientUuid, amountUuid, counters);
    const remarkUuid = await upsertRemark(row, clientUuid, amountUuid, counters);

    const proformaId = await upsertInvoice(
      {
        clientUuid,
        invoiceNo: proformaInvoiceNumber(row),
        status: "PROFORMA",
        amountUuid,
        totalAmount: row.amount || "0",
        remarkUuid,
        actionBy,
        issuedAt: row.payment_date,
        createdAt: row.created_at ?? new Date(row.payment_date),
      },
      counters
    );

    const existingInstallment = await modulesPool.query<{ id: string }>(
      `SELECT id FROM installments
       WHERE plan_id = $1::uuid AND installment_number = $2
       LIMIT 1`,
      [planId, installmentNumber]
    );

    if (existingInstallment.rows[0]) {
      await modulesPool.query(
        `UPDATE installments SET
           amount = $3,
           due_date = $4,
           paid_date = $4,
           status = 'PAID'::installment_status_enum,
           proforma_invoice_id = $5::uuid,
           collected_by = $6,
           updated_at = NOW()
         WHERE id = $1::uuid AND plan_id = $2::uuid`,
        [
          existingInstallment.rows[0].id,
          planId,
          row.amount || "0",
          row.payment_date,
          proformaId,
          actionBy,
        ]
      );
      counters.installmentsUpdated++;
    } else {
      await modulesPool.query(
        `INSERT INTO installments (
           plan_id, installment_number, amount, due_date, paid_date,
           status, proforma_invoice_id, collected_by, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, $4, $4,
           'PAID'::installment_status_enum, $5::uuid, $6, NOW(), NOW()
         )`,
        [planId, installmentNumber, row.amount || "0", row.payment_date, proformaId, actionBy]
      );
      counters.installmentsCreated++;
    }

    lastAmountUuid = amountUuid;
    lastRemarkUuid = remarkUuid;
  }

  if (lastAmountUuid) {
    const finalInvNo = finalInvoiceNumber(clientUuid, stage);
    const finalInvoiceId = await upsertInvoice(
      {
        clientUuid,
        invoiceNo: finalInvNo,
        status: "PAID",
        amountUuid: lastAmountUuid,
        totalAmount: paidSum.toFixed(2),
        remarkUuid: lastRemarkUuid,
        actionBy: Number(sorted[sorted.length - 1].handled_by ?? sorted[sorted.length - 1].counsellor_id),
        issuedAt: sorted[sorted.length - 1].payment_date,
        createdAt:
          sorted[sorted.length - 1].created_at ??
          new Date(sorted[sorted.length - 1].payment_date),
      },
      counters
    );

    await modulesPool.query(
      `UPDATE installment_plans SET final_invoice_id = $2::uuid, updated_at = NOW()
       WHERE id = $1::uuid`,
      [planId, finalInvoiceId]
    );
  }
}

async function main() {
  const clientMap = await loadClientUuidMap();
  if (!clientMap.size) {
    throw new Error(
      "No migrated clients in modules DB. Run: npm run migrate:module-clients"
    );
  }

  const salesMap = await loadSalesMap();
  if (!salesMap.size) {
    throw new Error(
      "No sales in modules DB. Run: npm run migrate:module-sales"
    );
  }

  const { rows: payments } = await mainPool.query<PaymentRow>(
    `SELECT cp.id, cp.client_id, cp.sale_type_id, cp.total_payment, cp.stage,
            cp.amount, cp.payment_date, cp.invoice_no, cp.remarks, cp.handled_by,
            ci.counsellor_id, cp.created_at
     FROM client_payment cp
     JOIN client_information ci ON ci.id = cp.client_id
     ORDER BY cp.id`
  );

  if (!payments.length) {
    console.log("No client_payment rows in main CRM.");
    return;
  }

  await ensureSaleLinkedPaymentSchema();
  await ensureDatesSchema();

  const balanceAggs = buildBalanceAggregates(payments, clientMap, salesMap);
  const balanceBySale = await upsertCoreBalances(balanceAggs);
  console.log(`CORE payment_balances: ${balanceBySale.size} upserted.`);

  const counters: Counters = {
    amountsCreated: 0,
    amountsUpdated: 0,
    datesCreated: 0,
    datesUpdated: 0,
    remarksCreated: 0,
    remarksUpdated: 0,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    plansCreated: 0,
    plansUpdated: 0,
    installmentsCreated: 0,
    installmentsUpdated: 0,
    skipped: 0,
  };

  const touchedClients = new Set<string>();

  const installmentGroups = new Map<StageGroupKey, PaymentRow[]>();
  const oneTimeRows: PaymentRow[] = [];

  for (const row of payments) {
    const legacyClientId = Number(row.client_id);
    const clientUuid = clientMap.get(legacyClientId);
    if (!clientUuid) {
      console.warn(
        `Skip payment ${row.id}: client ${legacyClientId} not in modules DB`
      );
      counters.skipped++;
      continue;
    }

    const saleUuid = resolveSaleUuid(
      legacyClientId,
      Number(row.sale_type_id),
      salesMap
    );
    if (!saleUuid) {
      console.warn(
        `Skip payment ${row.id}: no sale for client ${legacyClientId} sale_type ${row.sale_type_id}`
      );
      counters.skipped++;
      continue;
    }

    if (!balanceBySale.get(saleUuid)) {
      console.warn(`Skip payment ${row.id}: no CORE balance for sale ${saleUuid}`);
      counters.skipped++;
      continue;
    }

    touchedClients.add(clientUuid);

    if (row.stage === "INITIAL" || row.stage === "SUBMITTED_VISA") {
      oneTimeRows.push(row);
      continue;
    }

    if (INSTALLMENT_STAGES.has(row.stage)) {
      const key = stageGroupKey(saleUuid, row.stage);
      const group = installmentGroups.get(key) ?? [];
      group.push(row);
      installmentGroups.set(key, group);
      continue;
    }

    console.warn(`Skip payment ${row.id}: unknown stage "${row.stage}"`);
    counters.skipped++;
  }

  for (const row of oneTimeRows) {
    const legacyClientId = Number(row.client_id);
    const clientUuid = clientMap.get(legacyClientId)!;
    const saleUuid = resolveSaleUuid(
      legacyClientId,
      Number(row.sale_type_id),
      salesMap
    )!;
    const balanceId = balanceBySale.get(saleUuid)!;
    await processOneTimePayment(row, clientUuid, saleUuid, balanceId, counters);
  }

  for (const [, groupRows] of installmentGroups) {
    const legacyClientId = Number(groupRows[0].client_id);
    const clientUuid = clientMap.get(legacyClientId)!;
    const saleUuid = resolveSaleUuid(
      legacyClientId,
      Number(groupRows[0].sale_type_id),
      salesMap
    )!;
    const balanceId = balanceBySale.get(saleUuid)!;
    const stage = groupRows[0].stage;

    if (groupRows.length === 1) {
      await processSingleStagePayment(
        groupRows[0],
        clientUuid,
        saleUuid,
        balanceId,
        counters
      );
      continue;
    }

    if (groupRows.length > 5) {
      console.warn(
        `Sale ${saleUuid} stage ${stage}: ${groupRows.length} payments exceed max 5 installments — migrating as individual payments`
      );
      for (const row of groupRows) {
        await processSingleStagePayment(
          row,
          clientUuid,
          saleUuid,
          balanceId,
          counters
        );
      }
      continue;
    }

    await processInstallmentStageGroup(
      groupRows,
      clientUuid,
      saleUuid,
      balanceId,
      stage,
      counters
    );
  }

  const rollupCount = await recomputeClientRollups([...touchedClients]);

  console.log(`Amounts: ${counters.amountsCreated} created, ${counters.amountsUpdated} updated.`);
  console.log(`Dates: ${counters.datesCreated} created, ${counters.datesUpdated} updated.`);
  console.log(`Remarks: ${counters.remarksCreated} created, ${counters.remarksUpdated} updated.`);
  console.log(`Invoices: ${counters.invoicesCreated} created, ${counters.invoicesUpdated} updated.`);
  console.log(
    `Installment plans: ${counters.plansCreated} created, ${counters.plansUpdated} updated.`
  );
  console.log(
    `Installments: ${counters.installmentsCreated} created, ${counters.installmentsUpdated} updated.`
  );
  console.log(`Client rollups recomputed: ${rollupCount}.`);
  console.log(`Skipped: ${counters.skipped}. Total source payments: ${payments.length}.`);
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
