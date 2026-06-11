/**
 * Migrate client_product_payment + entity tables (main CRM)
 *   → product_transactions, product_transaction_attributes,
 *     payment_balances, amounts, remarks, invoices, amount_approved (modules DB).
 *
 * One client_product_payment row → one product_transactions row.
 * Entity fields → product_transaction_attributes (EAV rows).
 * Payment collections → amounts (+ invoices, remarks); amounts.amount_id = product_transactions.id.
 *
 * ALL_FINANCE: up to 4 payment slots (amount + date) → separate amounts + dates + invoices.
 *   Empty slots (amount null/0) are skipped — full payment in slot 1 only creates 1 row.
 * ALL_FINANCE approval → amount_approved on payment 1 (approvedBy, approvedAmount, status).
 * Product amounts link to sales.id via sale_id (same client engagement as CORE payments).
 *
 * Usage: npm run migrate:module-product-payments
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
  entity_id: number | null;
  entity_type: string;
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

type AttributeInput = {
  key: string;
  stringValue?: string | null;
  numberValue?: number | null;
  booleanValue?: boolean | null;
  dateValue?: string | null;
};

type EntityExtract = {
  eventDate: string | null;
  remarks: string | null;
  attributes: AttributeInput[];
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

function parseMoney(value: string | null | undefined): number {
  const n = parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function truncateRemark(text: string, max = 100): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + "...";
}

/** Unique legacy id per cpp row + payment slot (negative — avoids client_payment collision) */
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
  return {
    slot,
    amount: amt,
    paymentDate,
    invoiceNo,
    remark,
  };
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

async function loadProductUuidMap(): Promise<Map<string, string>> {
  const { rows } = await modulesPool.query<{ product_name: string; id: string }>(
    `SELECT product_name, id FROM products`
  );
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.product_name, row.id);
  return map;
}

type SaleLookupKey = string;

function saleLookupKey(
  legacyClientId: number,
  legacySaleTypeId: number
): SaleLookupKey {
  return `${legacyClientId}:${legacySaleTypeId}`;
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

/** Legacy sale_type_id per client from client_payment (for linking product → sale). */
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

async function ensureProductPaymentSchema(): Promise<void> {
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

async function fetchEntityExtract(row: CppRow): Promise<EntityExtract> {
  const cppAmount = parseMoney(row.amount);
  const empty: EntityExtract = {
    eventDate: row.payment_date,
    remarks: row.remark,
    attributes: [],
    paymentSlots: [],
    totalAmount: cppAmount,
    paidSum: cppAmount,
  };

  if (row.entity_type === "master_only") {
    if (cppAmount > 0) {
      empty.paymentSlots.push({
        slot: 1,
        amount: cppAmount,
        paymentDate: row.payment_date,
        invoiceNo: row.invoice_no,
        remark: row.remark,
      });
    }
    if (row.invoice_no?.trim()) {
      empty.attributes.push({
        key: "invoiceNumber",
        stringValue: row.invoice_no.trim(),
      });
    }
    return empty;
  }

  if (!row.entity_id) return empty;

  const id = row.entity_id;

  switch (row.entity_type) {
    case "allFinance_id": {
      const { rows } = await mainPool.query(
        `SELECT total_amount, amount, payment_date, invoice_no, partial_payment,
                approval_status, approved_by, approved_at, remarks,
                another_payment_amount, another_payment_date,
                another_payment_amount2, another_payment_date2,
                another_payment_amount3, another_payment_date3
         FROM all_finance WHERE id = $1`,
        [id]
      );
      const af = rows[0];
      if (!af) return empty;

      const total = parseMoney(af.total_amount) || parseMoney(af.amount);
      const slots: PaymentSlot[] = [];
      for (const s of [
        slotFromFinance(
          1,
          af.amount,
          af.payment_date,
          af.invoice_no,
          af.remarks
        ),
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
        attributes: [
          { key: "totalAmount", numberValue: total },
          { key: "partialPayment", booleanValue: af.partial_payment ?? false },
          { key: "approvalStatus", stringValue: af.approval_status ?? "pending" },
          ...(af.invoice_no?.trim()
            ? [{ key: "invoiceNumber", stringValue: af.invoice_no.trim() }]
            : []),
        ],
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

    case "loan_id": {
      const { rows } = await mainPool.query(
        `SELECT amount, disbursment_date, remarks FROM loan WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.disbursment_date,
        remarks: e.remarks ?? row.remark,
        attributes: [{ key: "amount", numberValue: amt }],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.disbursment_date,
                  invoiceNo: row.invoice_no,
                  remark: e.remarks ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "insurance_id": {
      const { rows } = await mainPool.query(
        `SELECT amount, date, policy_number, remark FROM insurance WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remark ?? row.remark,
        attributes: [
          ...(e.policy_number
            ? [{ key: "policyNumber", stringValue: e.policy_number }]
            : []),
          { key: "amount", numberValue: amt },
        ],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.date,
                  invoiceNo: row.invoice_no,
                  remark: e.remark ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "ielts_id": {
      const { rows } = await mainPool.query(
        `SELECT amount, date, enrolled_status, remarks FROM ielts WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remarks ?? row.remark,
        attributes: [
          { key: "examType", stringValue: "IELTS" },
          { key: "enrolledStatus", booleanValue: e.enrolled_status ?? false },
          { key: "amount", numberValue: amt },
        ],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.date,
                  invoiceNo: row.invoice_no,
                  remark: e.remarks ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "airTicket_id": {
      const { rows } = await mainPool.query(
        `SELECT amount, date, is_ticket_booked, air_ticket_number, remark
         FROM air_ticket WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remark ?? row.remark,
        attributes: [
          ...(e.air_ticket_number
            ? [{ key: "ticketNumber", stringValue: e.air_ticket_number }]
            : []),
          { key: "isBooked", booleanValue: e.is_ticket_booked ?? false },
          { key: "amount", numberValue: amt },
        ],
        paymentSlots:
          cppAmount > 0
            ? [
                {
                  slot: 1,
                  amount: cppAmount,
                  paymentDate: row.payment_date ?? e.date,
                  invoiceNo: row.invoice_no,
                  remark: row.remark ?? e.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: cppAmount > 0 ? cppAmount : 0,
      };
    }

    case "simCard_id": {
      const { rows } = await mainPool.query(
        `SELECT simcard_plan, sim_card_giving_date, sim_activation_date,
                activated_status, remarks
         FROM sim_card WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      return {
        eventDate: e.sim_card_giving_date ?? row.payment_date,
        remarks: e.remarks ?? row.remark,
        attributes: [
          ...(e.simcard_plan
            ? [{ key: "plan", stringValue: e.simcard_plan }]
            : []),
          { key: "isActivated", booleanValue: e.activated_status ?? false },
          ...(e.sim_activation_date
            ? [{ key: "activationDate", dateValue: e.sim_activation_date }]
            : []),
        ],
        paymentSlots: [],
        totalAmount: 0,
        paidSum: cppAmount,
      };
    }

    case "forexCard_id": {
      const { rows } = await mainPool.query(
        `SELECT forex_card_status, date, remark FROM forex_card WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      return {
        eventDate: e.date ?? row.payment_date,
        remarks: e.remark ?? row.remark,
        attributes: [
          ...(e.forex_card_status
            ? [{ key: "cardStatus", stringValue: e.forex_card_status }]
            : []),
        ],
        paymentSlots: [],
        totalAmount: 0,
        paidSum: cppAmount,
      };
    }

    case "forexFees_id": {
      const { rows } = await mainPool.query(
        `SELECT side, amount, date, remark FROM forex_fees WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remark ?? row.remark,
        attributes: [
          { key: "side", stringValue: e.side },
          { key: "amount", numberValue: amt },
        ],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.date,
                  invoiceNo: row.invoice_no,
                  remark: e.remark ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "creditCard_id": {
      const { rows } = await mainPool.query(
        `SELECT card_plan, card_giving_date, card_activation_date, date,
                activated_status, remark
         FROM credit_card WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      return {
        eventDate: e.card_giving_date ?? e.date ?? row.payment_date,
        remarks: e.remark ?? row.remark,
        attributes: [
          ...(e.card_plan ? [{ key: "plan", stringValue: e.card_plan }] : []),
          { key: "isActivated", booleanValue: e.activated_status ?? false },
          ...(e.card_activation_date
            ? [{ key: "activationDate", dateValue: e.card_activation_date }]
            : []),
          ...(e.date ? [{ key: "cardDate", dateValue: e.date }] : []),
        ],
        paymentSlots: [],
        totalAmount: 0,
        paidSum: cppAmount,
      };
    }

    case "tutionFees_id": {
      const { rows } = await mainPool.query(
        `SELECT tution_fees_status, date, remark FROM tution_fees WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      return {
        eventDate: e.date ?? row.payment_date,
        remarks: e.remark ?? row.remark,
        attributes: [{ key: "status", stringValue: e.tution_fees_status }],
        paymentSlots: [],
        totalAmount: 0,
        paidSum: cppAmount,
      };
    }

    case "beaconAccount_id": {
      const { rows } = await mainPool.query(
        `SELECT amount, opening_date, funding_date, remark FROM beacon_account WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.opening_date ?? e.funding_date ?? row.payment_date,
        remarks: e.remark ?? row.remark,
        attributes: [{ key: "amount", numberValue: amt }],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.funding_date ?? e.opening_date,
                  invoiceNo: row.invoice_no,
                  remark: e.remark ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "visaextension_id": {
      const { rows } = await mainPool.query(
        `SELECT type, amount, date, invoice_no, remark FROM visa_extension WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remark ?? row.remark,
        attributes: [
          { key: "extensionType", stringValue: e.type },
          { key: "amount", numberValue: amt },
          ...(e.invoice_no?.trim()
            ? [{ key: "invoiceNumber", stringValue: e.invoice_no.trim() }]
            : []),
        ],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.date,
                  invoiceNo: e.invoice_no ?? row.invoice_no,
                  remark: e.remark ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    case "newSell_id": {
      const { rows } = await mainPool.query(
        `SELECT service_name, service_information, amount, date, invoice_no, remark
         FROM new_sell WHERE id = $1`,
        [id]
      );
      const e = rows[0];
      if (!e) return empty;
      const amt = parseMoney(e.amount);
      return {
        eventDate: e.date,
        remarks: e.remark ?? row.remark,
        attributes: [
          { key: "serviceName", stringValue: e.service_name },
          ...(e.service_information
            ? [{ key: "serviceInfo", stringValue: e.service_information }]
            : []),
          { key: "amount", numberValue: amt },
          ...(e.invoice_no?.trim()
            ? [{ key: "invoiceNumber", stringValue: e.invoice_no.trim() }]
            : []),
        ],
        paymentSlots:
          amt > 0
            ? [
                {
                  slot: 1,
                  amount: amt,
                  paymentDate: e.date,
                  invoiceNo: e.invoice_no ?? row.invoice_no,
                  remark: e.remark ?? row.remark,
                },
              ]
            : [],
        totalAmount: amt,
        paidSum: amt,
      };
    }

    default:
      return empty;
  }
}

async function upsertProductTransaction(
  row: CppRow,
  clientUuid: string,
  productUuid: string,
  extract: EntityExtract,
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
         legacy_entity_type = $8, legacy_entity_id = $9, updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        existing.rows[0].id,
        clientUuid,
        productUuid,
        status,
        extract.eventDate,
        extract.remarks,
        actionBy,
        row.entity_type,
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
       $7, $8, $9, $10, NOW()
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
      row.entity_type,
      row.entity_id,
      row.created_at ?? new Date(),
    ]
  );
  return inserted.rows[0].id;
}

async function upsertAttributes(
  transactionId: string,
  attributes: AttributeInput[]
): Promise<number> {
  let count = 0;
  for (const attr of attributes) {
    await modulesPool.query(
      `INSERT INTO product_transaction_attributes (
         product_transaction_id, attribute_key,
         string_value, number_value, boolean_value, date_value,
         created_at, updated_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (product_transaction_id, attribute_key) DO UPDATE SET
         string_value = EXCLUDED.string_value,
         number_value = EXCLUDED.number_value,
         boolean_value = EXCLUDED.boolean_value,
         date_value = EXCLUDED.date_value,
         updated_at = NOW()`,
      [
        transactionId,
        attr.key,
        attr.stringValue ?? null,
        attr.numberValue != null ? attr.numberValue.toFixed(2) : null,
        attr.booleanValue ?? null,
        attr.dateValue ?? null,
      ]
    );
    count++;
  }
  return count;
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
  approval: NonNullable<EntityExtract["approval"]>
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
  const clientMap = await loadClientUuidMap();
  if (!clientMap.size) {
    throw new Error(
      "No migrated clients. Run: npm run migrate:module-clients"
    );
  }

  const productMap = await loadProductUuidMap();
  if (!productMap.size) {
    throw new Error(
      "No products. Run: npm run migrate:module-products"
    );
  }

  await ensureProductPaymentSchema();

  const salesMap = await loadSalesMap();
  if (!salesMap.size) {
    throw new Error(
      "No sales in modules DB. Run: npm run migrate:module-sales"
    );
  }

  const legacySaleTypeMap = await loadClientLegacySaleTypeMap();

  const { rows: payments } = await mainPool.query<CppRow>(
    `SELECT cpp.id, cpp.client_id, cpp.product_name, cpp.amount, cpp.date AS payment_date,
            cpp.invoice_no, cpp.remark, cpp.handled_by, cpp.entity_id, cpp.entity_type,
            cpp.created_at, ci.counsellor_id
     FROM client_product_payment cpp
     JOIN client_information ci ON ci.id = cpp.client_id
     ORDER BY cpp.id`
  );

  if (!payments.length) {
    console.log("No client_product_payment rows.");
    return;
  }

  let transactionsCreated = 0;
  let attributesUpserted = 0;
  let balancesUpserted = 0;
  let amountsUpserted = 0;
  let datesUpserted = 0;
  let approvalsUpserted = 0;
  let skipped = 0;
  let allFinanceRows = 0;

  const touchedClients = new Set<string>();

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
        `Skip cpp ${row.id}: product ${row.product_name} not in catalog`
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

    const actionBy = Number(row.handled_by ?? row.counsellor_id);
    const extract = await fetchEntityExtract(row);

    if (row.entity_type === "allFinance_id") allFinanceRows++;

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

    attributesUpserted += await upsertAttributes(
      transactionId,
      extract.attributes
    );

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

  console.log(`Product transactions: ${transactionsCreated} new.`);
  console.log(`Attributes upserted: ${attributesUpserted}.`);
  console.log(`Balances upserted: ${balancesUpserted}.`);
  console.log(`Amount/invoices: ${amountsUpserted} payment slots.`);
  console.log(`Dates: ${datesUpserted} payment dates.`);
  console.log(`All-finance rows: ${allFinanceRows}. Approvals: ${approvalsUpserted}.`);
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
