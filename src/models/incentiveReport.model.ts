import { db } from "../config/databaseConnection";
import { sql, inArray } from "drizzle-orm";
import { clientPayments } from "../schemas/clientPayment.schema";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface CounsellorStat {
  counsellorId: number;
  totalReceivedAmount: number;
  studentCount: number;
  canadaStudentCount: number;
  allFinanceCount: number;
}

export interface ClientRow {
  clientId: number;
  clientName: string;
  enrollmentDate: string;
  counsellorId: number;
  counsellor: string;
  saleType: string;
}

export interface PaymentStage {
  clientId: number;
  hasBeforeVisa: boolean;
  hasInitial: boolean;
  beforeVisaAmount: number;
  afterVisaAmount: number;
}

// ── Query 1: Counsellor stats (GROUP BY counsellor) ───────────────────────────
//
// Returns a map of counsellorId → aggregated stats for all clients in [startDate, endDate].
// Uses a CTE to:
//   1. Identify distinct clients and their sale type category
//   2. Determine each client's qualifying receivedAmount (BEFORE_VISA, else AFTER_VISA
//      only when no BEFORE_VISA and no INITIAL exists)
//   3. Count Canada Student clients (those with a TUTION_FEES product payment)
//   4. Count All Finance clients (those with an allFinance_id entity product payment)

export async function getCounsellorStats(
  startDate: string,
  endDate: string
): Promise<Map<number, CounsellorStat>> {
  const result = await db.execute<{
    counsellor_id: string;
    total_received_amount: string;
    student_count: string;
    canada_student_count: string;
    all_finance_count: string;
  }>(sql`
    WITH client_base AS (
      SELECT DISTINCT
        ci.id             AS client_id,
        ci.counsellor_id,
        stc.name          AS sale_type_category
      FROM client_information ci
      INNER JOIN client_payment cp      ON cp.client_id  = ci.id
      INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
      INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND stc.name IN ('Spouse', 'Visitor', 'Student')
    ),
    client_stages AS (
      SELECT
        cp.client_id,
        bool_or(cp.stage = 'BEFORE_VISA')  AS has_before_visa,
        bool_or(cp.stage = 'INITIAL')       AS has_initial,
        SUM(CASE WHEN cp.stage = 'BEFORE_VISA'
                 THEN cp.amount::numeric ELSE 0 END) AS before_visa_amount,
        SUM(CASE WHEN cp.stage = 'AFTER_VISA'
                 THEN cp.amount::numeric ELSE 0 END) AS after_visa_amount
      FROM client_payment cp
      WHERE cp.client_id IN (SELECT client_id FROM client_base)
      GROUP BY cp.client_id
    ),
    client_received AS (
      SELECT
        cb.client_id,
        cb.counsellor_id,
        cb.sale_type_category,
        CASE
          WHEN cs.has_before_visa
            THEN COALESCE(cs.before_visa_amount, 0)
          WHEN NOT COALESCE(cs.has_before_visa, false)
           AND NOT COALESCE(cs.has_initial, false)
            THEN COALESCE(cs.after_visa_amount, 0)
          ELSE 0
        END AS received_amount
      FROM client_base cb
      LEFT JOIN client_stages cs ON cs.client_id = cb.client_id
    ),
    product_counts AS (
      SELECT
        ci.counsellor_id,
        COUNT(DISTINCT CASE WHEN cpp.product_name = 'TUTION_FEES'
                            THEN cpp.client_id END)::int AS canada_student_count,
        COUNT(DISTINCT CASE WHEN cpp.entity_type  = 'allFinance_id'
                            THEN cpp.client_id END)::int AS all_finance_count
      FROM client_product_payment cpp
      INNER JOIN client_information ci ON ci.id = cpp.client_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY ci.counsellor_id
    )
    SELECT
      cr.counsellor_id::bigint,
      COALESCE(SUM(cr.received_amount), 0)::text                                  AS total_received_amount,
      COUNT(CASE WHEN cr.sale_type_category = 'Student' THEN 1 END)::int          AS student_count,
      COALESCE(MAX(pc.canada_student_count), 0)                                   AS canada_student_count,
      COALESCE(MAX(pc.all_finance_count),    0)                                   AS all_finance_count
    FROM client_received cr
    LEFT JOIN product_counts pc ON pc.counsellor_id = cr.counsellor_id
    GROUP BY cr.counsellor_id
  `);

  const map = new Map<number, CounsellorStat>();
  for (const row of result.rows) {
    const id = Number(row.counsellor_id);
    map.set(id, {
      counsellorId: id,
      totalReceivedAmount: parseFloat(row.total_received_amount) || 0,
      studentCount:        Number(row.student_count)        || 0,
      canadaStudentCount:  Number(row.canada_student_count) || 0,
      allFinanceCount:     Number(row.all_finance_count)    || 0,
    });
  }
  return map;
}

// ── Query 2: Company-wide Spouse count (scalar) ───────────────────────────────

export async function getCompanyWideSpouseCount(
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await db.execute<{ spouse_count: string }>(sql`
    SELECT COUNT(DISTINCT ci.id)::int AS spouse_count
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND stc.name = 'Spouse'
  `);
  return Number(result.rows[0]?.spouse_count) || 0;
}

// ── Query 3a: Paginated client list ──────────────────────────────────────────
//
// Returns one row per client (DISTINCT ON ci.id eliminates duplicate rows from
// the client_payment join). Ordered by enrollment date DESC after deduplication.

export async function getPaginatedClients(
  startDate: string,
  endDate: string,
  pageSize: number,
  offset: number
): Promise<ClientRow[]> {
  const result = await db.execute<{
    client_id: string;
    client_name: string;
    enrollment_date: string;
    counsellor_id: string;
    counsellor: string;
    sale_type: string;
  }>(sql`
    SELECT *
    FROM (
      SELECT DISTINCT ON (ci.id)
        ci.id           AS client_id,
        ci.fullname     AS client_name,
        ci.date         AS enrollment_date,
        ci.counsellor_id,
        u.full_name     AS counsellor,
        stc.name        AS sale_type
      FROM client_information ci
      INNER JOIN users u              ON u.id          = ci.counsellor_id
      INNER JOIN client_payment cp    ON cp.client_id  = ci.id
      INNER JOIN sale_type st         ON st.id          = cp.sale_type_id
      INNER JOIN sale_type_category stc ON stc.id       = st.category_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND stc.name IN ('Spouse', 'Visitor', 'Student')
      ORDER BY ci.id
    ) deduped
    ORDER BY enrollment_date DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  return result.rows.map((row) => ({
    clientId:       Number(row.client_id),
    clientName:     row.client_name,
    enrollmentDate: row.enrollment_date,
    counsellorId:   Number(row.counsellor_id),
    counsellor:     row.counsellor,
    saleType:       row.sale_type,
  }));
}

// ── Query 3b: Total client count (for pagination metadata) ────────────────────

export async function getTotalClientCount(
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await db.execute<{ total: string }>(sql`
    SELECT COUNT(DISTINCT ci.id)::int AS total
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND stc.name IN ('Spouse', 'Visitor', 'Student')
  `);
  return Number(result.rows[0]?.total) || 0;
}

// ── Query 4: Batch payment stages for a page of clients ──────────────────────
//
// Fetches all payment rows for the given clientIds, then aggregates in TypeScript.
// Used to compute per-client receivedAmount in the service layer.

export async function getClientPaymentStages(
  clientIds: number[]
): Promise<Map<number, PaymentStage>> {
  if (clientIds.length === 0) return new Map();

  const rows = await db
    .select({
      clientId: clientPayments.clientId,
      stage:    clientPayments.stage,
      amount:   clientPayments.amount,
    })
    .from(clientPayments)
    .where(inArray(clientPayments.clientId, clientIds));

  const map = new Map<number, PaymentStage>();
  for (const row of rows) {
    const existing: PaymentStage = map.get(row.clientId) ?? {
      clientId:         row.clientId,
      hasBeforeVisa:    false,
      hasInitial:       false,
      beforeVisaAmount: 0,
      afterVisaAmount:  0,
    };
    const amt = parseFloat(row.amount ?? "0") || 0;
    if (row.stage === "BEFORE_VISA") {
      existing.hasBeforeVisa    = true;
      existing.beforeVisaAmount += amt;
    } else if (row.stage === "INITIAL") {
      existing.hasInitial = true;
    } else if (row.stage === "AFTER_VISA") {
      existing.afterVisaAmount += amt;
    }
    map.set(row.clientId, existing);
  }
  return map;
}
