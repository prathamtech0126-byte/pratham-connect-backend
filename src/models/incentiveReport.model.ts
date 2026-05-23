import { db } from "../config/databaseConnection";
import { sql, inArray, and, eq, ne } from "drizzle-orm";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { otherProducts as otherProductsTable } from "../schemas/otherProducts.schema";
import { allFinance } from "../schemas/allFinance.schema";

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
  /** Null for clients who have only other-product payments (no core sale type). */
  saleTypeId: number | null;
  /** Parent bucket from `sale_type_category.name` (e.g. spouse, visitor, student). Null for product-only clients. */
  saleType: string | null;
  /** Distinct line from `sale_type.sale_type` (e.g. Canada Spouse, UK Student). Null for product-only clients. */
  saleTypeName: string | null;
  /** FK to `sale_type_category.id` for the client's sale type. */
  saleTypeCategoryId: number | null;
  /**
   * True when this row represents a "handled-by" counsellor (someone who took a product
   * payment for this client but is not the client's original counsellor).
   * Core sale and all-finance incentives are always 0 for these rows.
   */
  isHandledByRow: boolean;
  /** True when the client was transferred from another counsellor (ci.transfer_status = true). */
  transferStatus: boolean;
  /** For handled-by rows: the client's original counsellor_id. Null for primary rows. */
  originalCounsellorId: number | null;
}

export interface PaymentStage {
  clientId: number;
  hasBeforeVisa: boolean;
  hasInitial: boolean;
  initialAmount: number;
  beforeVisaAmount: number;
  afterVisaAmount: number;
  /** Agreed total service fees (client_payment.total_payment). Max across all stage rows for this client. */
  totalPaymentAmount: number;
  latestPaymentDate: string | null;
  initialPaymentDate: string | null;
  beforeVisaPaymentDate: string | null;
  afterVisaPaymentDate: string | null;
}

export interface IncentiveBreakdownRow {
  id: number;
  incentiveRecordId: number;
  type: string | null;
  subType: string | null;
  ruleType: string | null;
  status: string | null;
  achievedValue: number;
  appliedRate: number;
  calculatedAmount: number;
  productName: string;
}

export interface UpdateBreakdownStatusInput {
  breakdownIds: number[];
  status: "APPROVED" | "REJECTED" | "PENDING";
  approvedBy: number;
}

export interface CounsellorTypeCounts {
  counsellorId: number;
  totalClients: number;
  spouseCount: number;
  visitorCount: number;
  studentCount: number;
}

export async function getIncentiveBreakdownByRecordId(
  incentiveRecordId: number
): Promise<IncentiveBreakdownRow[]> {
  const result = await db.execute<{
    id: string;
    incentive_record_id: string;
    type: string | null;
    sub_type: string | null;
    rule_type: string | null;
    status: string | null;
    achieved_value: string | null;
    applied_rate: string | null;
    calculated_amount: string | null;
    product_name: string | null;
  }>(sql`
    SELECT
      br.id,
      br.incentive_record_id,
      br.type,
      br.sub_type,
      br.rule_type,
      br.status,
      br.achieved_value,
      br.applied_rate,
      br.calculated_amount,
      CASE
        WHEN br.reference_type = 'CLIENT_PAYMENT' AND br.sub_type = 'INITIAL'
          THEN 'Initial Payment'
        WHEN br.reference_type = 'CLIENT_PAYMENT' AND br.sub_type = 'BEFORE_VISA'
          THEN 'Before Visa Payment'
        WHEN br.reference_type = 'CLIENT_PAYMENT' AND br.sub_type = 'AFTER_VISA'
          THEN 'After Visa Payment'
        WHEN br.reference_type = 'PRODUCT_PAYMENT'
          THEN cpp.product_name::text
        WHEN br.type = 'ALL_FINANCE'
          THEN 'All Finance'
        ELSE 'Unknown'
      END AS product_name
    FROM incentive_record_breakdowns br
    LEFT JOIN client_product_payment cpp
      ON br.reference_type = 'PRODUCT_PAYMENT'
      AND br.reference_id = cpp.id
    LEFT JOIN client_payment cp
      ON br.reference_type = 'CLIENT_PAYMENT'
      AND br.reference_id = cp.id
    WHERE br.incentive_record_id = ${incentiveRecordId}
    ORDER BY br.id ASC
  `);

  return result.rows.map((row) => ({
    id: Number(row.id),
    incentiveRecordId: Number(row.incentive_record_id),
    type: row.type ?? null,
    subType: row.sub_type ?? null,
    ruleType: row.rule_type ?? null,
    status: row.status ?? null,
    achievedValue: parseFloat(row.achieved_value ?? "0") || 0,
    appliedRate: parseFloat(row.applied_rate ?? "0") || 0,
    calculatedAmount: parseFloat(row.calculated_amount ?? "0") || 0,
    productName: row.product_name ?? "Unknown",
  }));
}

export async function updateBreakdownStatusAction(
  input: UpdateBreakdownStatusInput
): Promise<number> {
  const breakdownIdList = sql.join(
    input.breakdownIds.map((id) => sql`${id}`),
    sql`, `
  );

  return db.transaction(async (tx) => {
    const updated = await tx.execute<{ id: string; incentive_record_id: string }>(sql`
      UPDATE incentive_record_breakdowns
      SET
        status = ${input.status},
        approved_by = ${input.approvedBy},
        approved_at = now()
      WHERE id IN (${breakdownIdList})
      RETURNING id, incentive_record_id
    `);

    if (!updated.rows.length) {
      return 0;
    }

    const incentiveRecordIds = Array.from(
      new Set(updated.rows.map((row) => Number(row.incentive_record_id)))
    );
    const incentiveRecordIdList = sql.join(
      incentiveRecordIds.map((id) => sql`${id}`),
      sql`, `
    );

    await tx.execute(sql`
      UPDATE incentive_records ir
      SET final_incentive = agg.total
      FROM (
        SELECT
          incentive_record_id,
          COALESCE(
            SUM(
              CASE
                WHEN status = 'APPROVED' THEN calculated_amount::numeric
                ELSE 0
              END
            ),
            0
          ) AS total
        FROM incentive_record_breakdowns
        WHERE incentive_record_id IN (${incentiveRecordIdList})
        GROUP BY incentive_record_id
      ) agg
      WHERE ir.id = agg.incentive_record_id
    `);

    return updated.rows.length;
  });
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
        AND ci.archived = false
        AND stc.name IN ('spouse', 'visitor', 'student')
        AND EXISTS (
          SELECT 1 FROM client_payment cp_i
          WHERE cp_i.client_id = ci.id AND cp_i.stage = 'INITIAL'
        )
        AND (
          EXISTS (SELECT 1 FROM client_payment cp_bv WHERE cp_bv.client_id = ci.id AND cp_bv.stage = 'BEFORE_VISA')
          OR EXISTS (
            SELECT 1 FROM client_product_payment cpp_af
            INNER JOIN all_finance af_c ON cpp_af.entity_type = 'allFinance_id' AND cpp_af.entity_id = af_c.id
            WHERE cpp_af.client_id = ci.id AND af_c.approval_status = 'approved'
          )
          OR EXISTS (
            SELECT 1 FROM client_product_payment cpp_noc
            WHERE cpp_noc.client_id = ci.id AND cpp_noc.product_name = 'NOC_LEVEL_JOB_ARRANGEMENT'
          )
        )
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
                             AND ci.date BETWEEN ${startDate}::date AND ${endDate}::date
                            THEN cpp.client_id END)::int AS canada_student_count,
        COUNT(DISTINCT CASE WHEN cpp.entity_type = 'allFinance_id'
                             AND af.approval_status = 'approved'
                             AND af.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
                            THEN cpp.client_id END)::int AS all_finance_count
      FROM client_product_payment cpp
      INNER JOIN client_information ci ON ci.id = cpp.client_id
      LEFT JOIN all_finance af ON cpp.entity_type = 'allFinance_id' AND cpp.entity_id = af.id
      WHERE ci.archived = false
      GROUP BY ci.counsellor_id
    )
    SELECT
      cr.counsellor_id::bigint,
      COALESCE(SUM(CASE WHEN LOWER(cr.sale_type_category) = 'visitor' THEN cr.received_amount ELSE 0 END), 0)::text AS total_received_amount,
      COUNT(CASE WHEN LOWER(cr.sale_type_category) = 'student' THEN 1 END)::int          AS student_count,
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
      AND ci.archived = false
      AND stc.name = 'spouse'
      AND EXISTS (
        SELECT 1 FROM client_payment cp_i
        WHERE cp_i.client_id = ci.id AND cp_i.stage = 'INITIAL'
      )
      AND (
        EXISTS (SELECT 1 FROM client_payment cp_bv WHERE cp_bv.client_id = ci.id AND cp_bv.stage = 'BEFORE_VISA')
        OR EXISTS (
          SELECT 1 FROM client_product_payment cpp_af
          INNER JOIN all_finance af_c ON cpp_af.entity_type = 'allFinance_id' AND cpp_af.entity_id = af_c.id
          WHERE cpp_af.client_id = ci.id AND af_c.approval_status = 'approved'
        )
        OR EXISTS (
          SELECT 1 FROM client_product_payment cpp_noc
          WHERE cpp_noc.client_id = ci.id AND cpp_noc.product_name = 'NOC_LEVEL_JOB_ARRANGEMENT'
        )
      )
  `);
  return Number(result.rows[0]?.spouse_count) || 0;
}

// ── Query 2b: Per-counsellor client type counts ───────────────────────────────
//
// Used to compute totalIncentiveAmount across all clients in the range without
// fetching every client row. Returns spouseCount / visitorCount / studentCount
// per counsellor — combined with counsellorStats, this is sufficient to aggregate.

export async function getPerCounsellorClientTypeCounts(
  startDate: string,
  endDate: string
): Promise<Map<number, CounsellorTypeCounts>> {
  const result = await db.execute<{
    counsellor_id: string;
    total_clients: string;
    spouse_count: string;
    visitor_count: string;
    student_count: string;
  }>(sql`
    SELECT
      ci.counsellor_id,
      COUNT(DISTINCT ci.id)::int AS total_clients,
      COUNT(DISTINCT CASE WHEN stc.name = 'spouse'  THEN ci.id END)::int AS spouse_count,
      COUNT(DISTINCT CASE WHEN stc.name = 'visitor' THEN ci.id END)::int AS visitor_count,
      COUNT(DISTINCT CASE WHEN stc.name = 'student' THEN ci.id END)::int AS student_count
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
      AND stc.name IN ('spouse', 'visitor', 'student')
    GROUP BY ci.counsellor_id
  `);

  const map = new Map<number, CounsellorTypeCounts>();
  for (const row of result.rows) {
    const id = Number(row.counsellor_id);
    map.set(id, {
      counsellorId: id,
      totalClients: Number(row.total_clients) || 0,
      spouseCount:  Number(row.spouse_count)  || 0,
      visitorCount: Number(row.visitor_count) || 0,
      studentCount: Number(row.student_count) || 0,
    });
  }
  return map;
}

// ── Query 3a: Paginated client list ──────────────────────────────────────────
//
// Returns one row per (client, effective-counsellor) pair:
//   • Primary rows  — client's own counsellor (ci.counsellor_id).
//   • Handled-by rows — one extra row per unique handled_by counsellor found in
//     client_product_payment for that client (where handled_by ≠ ci.counsellor_id).
//     These rows have is_handled_by_row = true and saleType* fields all NULL so
//     the service can zero-out core-sale / all-finance incentives for them.

export async function getPaginatedClients(
  startDate: string,
  endDate: string,
  pageSize: number,
  offset: number,
  clientId?: number
): Promise<ClientRow[]> {
  const fetchAll    = pageSize === 0;
  const limitClause = fetchAll ? sql`` : sql`LIMIT ${pageSize} OFFSET ${offset}`;
  const clientFilter = typeof clientId === "number" ? sql`AND ci.id = ${clientId}` : sql``;
  const result = await db.execute<{
    client_id: string;
    client_name: string;
    enrollment_date: string;
    counsellor_id: string;
    counsellor: string;
    sale_type_id: string | null;
    sale_type: string | null;
    sale_type_name: string | null;
    sale_type_category_id: string | null;
    is_handled_by_row: boolean;
    transfer_status: boolean;
    original_counsellor_id: string | null;
  }>(sql`
    WITH combined AS (
      -- Primary rows: one per client using the client's own counsellor.
      SELECT
        client_id, client_name, enrollment_date, counsellor_id, counsellor,
        sale_type_id, sale_type, sale_type_name, sale_type_category_id,
        is_handled_by_row, transfer_status, original_counsellor_id
      FROM (
        SELECT DISTINCT ON (ci.id)
          ci.id                   AS client_id,
          ci.fullname             AS client_name,
          ci.date::text           AS enrollment_date,
          ci.counsellor_id,
          u.full_name             AS counsellor,
          st.id                   AS sale_type_id,
          stc.name                AS sale_type,
          st.sale_type            AS sale_type_name,
          st.category_id          AS sale_type_category_id,
          false::boolean          AS is_handled_by_row,
          COALESCE(ci.transfer_status, false) AS transfer_status,
          NULL::bigint            AS original_counsellor_id
        FROM client_information ci
        INNER JOIN users u                  ON u.id         = ci.counsellor_id
        LEFT JOIN  client_payment cp        ON cp.client_id = ci.id
        LEFT JOIN  sale_type st             ON st.id        = cp.sale_type_id
        LEFT JOIN  sale_type_category stc   ON stc.id       = st.category_id
                                           AND stc.name IN ('spouse', 'visitor', 'student')
        WHERE (
            ci.date BETWEEN ${startDate}::date AND ${endDate}::date
            OR EXISTS (
              SELECT 1 FROM client_product_payment cpp_chk
              LEFT JOIN all_finance af_chk ON cpp_chk.entity_type = 'allFinance_id'
                AND cpp_chk.entity_id = af_chk.id
                AND af_chk.approval_status = 'approved'
              WHERE cpp_chk.client_id = ci.id
                AND (
                  cpp_chk.date BETWEEN ${startDate}::date AND ${endDate}::date
                  OR af_chk.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
                )
            )
          )
          AND ci.archived = false
          ${clientFilter}
        ORDER BY ci.id,
          CASE stc.name
            WHEN 'student' THEN 1
            WHEN 'spouse'  THEN 2
            WHEN 'visitor' THEN 3
            ELSE 4
          END NULLS LAST
      ) primary_rows

      UNION ALL

      -- Handled-by rows: one per (client, handled_by counsellor) where handled_by ≠ original counsellor.
      SELECT
        client_id, client_name, enrollment_date, counsellor_id, counsellor,
        sale_type_id, sale_type, sale_type_name, sale_type_category_id,
        is_handled_by_row, transfer_status, original_counsellor_id
      FROM (
        SELECT DISTINCT ON (ci.id, cpp.handled_by)
          ci.id            AS client_id,
          ci.fullname      AS client_name,
          ci.date::text    AS enrollment_date,
          cpp.handled_by   AS counsellor_id,
          u2.full_name     AS counsellor,
          NULL::bigint     AS sale_type_id,
          NULL::text       AS sale_type,
          NULL::text       AS sale_type_name,
          NULL::bigint     AS sale_type_category_id,
          true::boolean    AS is_handled_by_row,
          COALESCE(ci.transfer_status, false) AS transfer_status,
          ci.counsellor_id AS original_counsellor_id
        FROM client_information ci
        INNER JOIN client_product_payment cpp ON cpp.client_id = ci.id
          AND cpp.handled_by IS NOT NULL
          AND cpp.handled_by != ci.counsellor_id
          -- Skip handled-by row when that counsellor already gets a full transferred-to row
          AND NOT (ci.transfer_status = true AND ci.transfered_to_counsellor_id = cpp.handled_by)
        INNER JOIN users u2 ON u2.id = cpp.handled_by
        WHERE (
            ci.date BETWEEN ${startDate}::date AND ${endDate}::date
            OR EXISTS (
              SELECT 1 FROM client_product_payment cpp_chk2
              LEFT JOIN all_finance af_chk2 ON cpp_chk2.entity_type = 'allFinance_id'
                AND cpp_chk2.entity_id = af_chk2.id
                AND af_chk2.approval_status = 'approved'
              WHERE cpp_chk2.client_id = ci.id
                AND (
                  cpp_chk2.date BETWEEN ${startDate}::date AND ${endDate}::date
                  OR af_chk2.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
                )
            )
          )
          AND ci.archived = false
          ${clientFilter}
        ORDER BY ci.id, cpp.handled_by
      ) hb_rows

      UNION ALL

      -- Transferred-to rows: when ci.transfer_status = true the client also appears
      -- under the transfered_to_counsellor_id so they can see and approve the incentive.
      SELECT
        client_id, client_name, enrollment_date, counsellor_id, counsellor,
        sale_type_id, sale_type, sale_type_name, sale_type_category_id,
        is_handled_by_row, transfer_status, original_counsellor_id
      FROM (
        SELECT DISTINCT ON (ci.id)
          ci.id                   AS client_id,
          ci.fullname             AS client_name,
          ci.date::text           AS enrollment_date,
          ci.transfered_to_counsellor_id AS counsellor_id,
          u3.full_name            AS counsellor,
          st.id                   AS sale_type_id,
          stc.name                AS sale_type,
          st.sale_type            AS sale_type_name,
          st.category_id          AS sale_type_category_id,
          false::boolean          AS is_handled_by_row,
          true::boolean           AS transfer_status,
          ci.counsellor_id        AS original_counsellor_id
        FROM client_information ci
        INNER JOIN users u3 ON u3.id = ci.transfered_to_counsellor_id
        LEFT JOIN  client_payment cp        ON cp.client_id = ci.id
        LEFT JOIN  sale_type st             ON st.id        = cp.sale_type_id
        LEFT JOIN  sale_type_category stc   ON stc.id       = st.category_id
                                           AND stc.name IN ('spouse', 'visitor', 'student')
        WHERE ci.transfer_status = true
          AND ci.transfered_to_counsellor_id IS NOT NULL
          AND (ci.counsellor_id IS NULL OR ci.transfered_to_counsellor_id != ci.counsellor_id)
          AND (
              ci.date BETWEEN ${startDate}::date AND ${endDate}::date
              OR EXISTS (
                SELECT 1 FROM client_product_payment cpp_chk3
                LEFT JOIN all_finance af_chk3 ON cpp_chk3.entity_type = 'allFinance_id'
                  AND cpp_chk3.entity_id = af_chk3.id
                  AND af_chk3.approval_status = 'approved'
                WHERE cpp_chk3.client_id = ci.id
                  AND (
                    cpp_chk3.date BETWEEN ${startDate}::date AND ${endDate}::date
                    OR af_chk3.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
                  )
              )
            )
          AND ci.archived = false
          ${clientFilter}
        ORDER BY ci.id,
          CASE stc.name
            WHEN 'student' THEN 1
            WHEN 'spouse'  THEN 2
            WHEN 'visitor' THEN 3
            ELSE 4
          END NULLS LAST
      ) transferred_rows
    ),
    deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY client_id, counsellor_id
          ORDER BY is_handled_by_row ASC, transfer_status ASC
        ) AS rn
      FROM combined
    )
    SELECT client_id, client_name, enrollment_date, counsellor_id, counsellor,
           sale_type_id, sale_type, sale_type_name, sale_type_category_id,
           is_handled_by_row, transfer_status, original_counsellor_id
    FROM deduped
    WHERE rn = 1
    ORDER BY enrollment_date DESC
    ${limitClause}
  `);

  return result.rows.map((row) => ({
    clientId:             Number(row.client_id),
    clientName:           row.client_name,
    enrollmentDate:       row.enrollment_date,
    counsellorId:         Number(row.counsellor_id),
    counsellor:           row.counsellor,
    saleTypeId:           row.sale_type_id != null ? Number(row.sale_type_id) : null,
    saleType:             row.sale_type ?? null,
    saleTypeName:         row.sale_type_name ?? null,
    saleTypeCategoryId:   row.sale_type_category_id == null || row.sale_type_category_id === ""
      ? null
      : Number(row.sale_type_category_id),
    isHandledByRow:       Boolean(row.is_handled_by_row),
    transferStatus:       Boolean(row.transfer_status),
    originalCounsellorId: row.original_counsellor_id != null
      ? Number(row.original_counsellor_id)
      : null,
  }));
}

// ── Query 3b: Total client count (for pagination metadata) ────────────────────
//
// Counts unique (client_id, effective_counsellor_id) pairs, which includes both
// the original counsellor row and each unique handled-by counsellor row.

export async function getTotalClientCount(
  startDate: string,
  endDate: string,
  clientId?: number
): Promise<number> {
  const clientFilter = typeof clientId === "number" ? sql`AND ci.id = ${clientId}` : sql``;
  const result = await db.execute<{ total: string }>(sql`
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT ci.id, ci.counsellor_id AS eff_counsellor
      FROM client_information ci
      WHERE (
          ci.date BETWEEN ${startDate}::date AND ${endDate}::date
          OR EXISTS (
            SELECT 1 FROM client_product_payment cpp_x
            LEFT JOIN all_finance af_x ON cpp_x.entity_type = 'allFinance_id'
              AND cpp_x.entity_id = af_x.id
              AND af_x.approval_status = 'approved'
            WHERE cpp_x.client_id = ci.id
              AND (
                cpp_x.date BETWEEN ${startDate}::date AND ${endDate}::date
                OR af_x.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
              )
          )
        )
        AND ci.archived = false
        ${clientFilter}

      UNION

      SELECT DISTINCT ci.id, cpp.handled_by
      FROM client_information ci
      INNER JOIN client_product_payment cpp ON cpp.client_id = ci.id
      WHERE (
          ci.date BETWEEN ${startDate}::date AND ${endDate}::date
          OR EXISTS (
            SELECT 1 FROM client_product_payment cpp_x2
            LEFT JOIN all_finance af_x2 ON cpp_x2.entity_type = 'allFinance_id'
              AND cpp_x2.entity_id = af_x2.id
              AND af_x2.approval_status = 'approved'
            WHERE cpp_x2.client_id = ci.id
              AND (
                cpp_x2.date BETWEEN ${startDate}::date AND ${endDate}::date
                OR af_x2.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
              )
          )
        )
        AND ci.archived = false
        AND cpp.handled_by IS NOT NULL
        AND cpp.handled_by != ci.counsellor_id
        AND NOT (ci.transfer_status = true AND ci.transfered_to_counsellor_id = cpp.handled_by)
        ${clientFilter}

      UNION

      SELECT DISTINCT ci.id, ci.transfered_to_counsellor_id
      FROM client_information ci
      WHERE ci.transfer_status = true
        AND ci.transfered_to_counsellor_id IS NOT NULL
        AND (ci.counsellor_id IS NULL OR ci.transfered_to_counsellor_id != ci.counsellor_id)
        AND (
            ci.date BETWEEN ${startDate}::date AND ${endDate}::date
            OR EXISTS (
              SELECT 1 FROM client_product_payment cpp_x3
              LEFT JOIN all_finance af_x3 ON cpp_x3.entity_type = 'allFinance_id'
                AND cpp_x3.entity_id = af_x3.id
                AND af_x3.approval_status = 'approved'
              WHERE cpp_x3.client_id = ci.id
                AND (
                  cpp_x3.date BETWEEN ${startDate}::date AND ${endDate}::date
                  OR af_x3.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
                )
            )
          )
        AND ci.archived = false
        ${clientFilter}
    ) combined
  `);
  return Number(result.rows[0]?.total) || 0;
}

export async function getPeriodRangeById(
  periodId: number
): Promise<{ id: number; startDate: string; endDate: string | null } | null> {
  const result = await db.execute<{ id: string; start_date: string; end_date: string | null }>(sql`
    SELECT id, start_date::text, end_date::text
    FROM periods
    WHERE id = ${periodId}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function getOrCreatePeriodByDateRange(
  startDate: string,
  endDate: string
): Promise<number> {
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM periods
    WHERE start_date = ${startDate}::date
      AND end_date = ${endDate}::date
    LIMIT 1
  `);
  if (existing.rows[0]?.id) return Number(existing.rows[0].id);

  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO periods (name, start_date, end_date, is_active, created_at)
    VALUES (${`Auto ${startDate} to ${endDate}`}, ${startDate}::date, ${endDate}::date, true, now())
    RETURNING id
  `);
  return Number(inserted.rows[0].id);
}

export interface ExistingIncentiveRecord {
  id: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  totalIncentiveAmount: number;
  overrideAmount: number | null;
  overrideCoreSale: number | null;
  overrideAllFinance: number | null;
  overrideOtherProducts: number | null;
  remark: string | null;
  calculationSnapshot: unknown;
}

export async function getIncentiveRecordStatusesForPeriod(
  clientIds: number[],
  periodId: number
): Promise<Map<number, ExistingIncentiveRecord>> {
  if (!clientIds.length) return new Map();
  const idList = sql.join(
    clientIds.map((id) => sql`${id}`),
    sql`, `
  );
  const result = await db.execute<{
    id: string;
    client_id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    total_incentive_amount: string | null;
    override_amount: string | null;
    override_core_sale: string | null;
    override_all_finance: string | null;
    override_other_products: string | null;
    remark: string | null;
    calculation_snapshot: unknown;
  }>(sql`
    SELECT id, client_id, status, total_incentive_amount, override_amount, override_core_sale, override_all_finance, override_other_products, remark, calculation_snapshot
    FROM incentive_records
    WHERE period_id = ${periodId}
      AND client_id IN (${idList})
  `);

  const map = new Map<number, ExistingIncentiveRecord>();
  for (const row of result.rows) {
    map.set(Number(row.client_id), {
      id: Number(row.id),
      status: row.status,
      totalIncentiveAmount: parseFloat(row.total_incentive_amount ?? "0") || 0,
      overrideAmount: row.override_amount === null ? null : parseFloat(row.override_amount) || 0,
      overrideCoreSale: row.override_core_sale === null ? null : parseFloat(row.override_core_sale) || 0,
      overrideAllFinance: row.override_all_finance === null ? null : parseFloat(row.override_all_finance) || 0,
      overrideOtherProducts:
        row.override_other_products === null ? null : parseFloat(row.override_other_products) || 0,
      remark: row.remark ?? null,
      calculationSnapshot: row.calculation_snapshot,
    });
  }
  return map;
}

export interface IncentiveActionState {
  incentiveRecordId: number;
  status: "Pending" | "Approved" | "Rejected";
  /** The amount saved to incentive_records.total_incentive_amount at the time the action was taken. Used as the locked amount for Approved/Rejected records. */
  totalIncentiveAmount: number;
  overrideAmount: number | null;
  overrideCoreSale: number | null;
  overrideAllFinance: number | null;
  overrideOtherProducts: number | null;
  overrideByUserId: number | null;
  remark: string | null;
}

export async function getIncentiveActionStateForClientsInRange(
  clientIds: number[],
  startDate: string,
  endDate: string
): Promise<Map<number, IncentiveActionState>> {
  if (!clientIds.length) return new Map();
  const idList = sql.join(
    clientIds.map((id) => sql`${id}`),
    sql`, `
  );

  const result = await db.execute<{
    id: string;
    client_id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    total_incentive_amount: string | null;
    override_amount: string | null;
    override_core_sale: string | null;
    override_all_finance: string | null;
    override_other_products: string | null;
    approved_by: string | null;
    remark: string | null;
    rn: string;
  }>(sql`
    SELECT t.id, t.client_id, t.status, t.total_incentive_amount, t.override_amount, t.override_core_sale, t.override_all_finance, t.override_other_products, t.approved_by, t.remark, t.rn
    FROM (
      SELECT
        ir.id,
        ir.client_id,
        ir.status,
        ir.total_incentive_amount,
        ir.override_amount,
        ir.override_core_sale,
        ir.override_all_finance,
        ir.override_other_products,
        ir.approved_by,
        ir.remark,
        ROW_NUMBER() OVER (
          PARTITION BY ir.client_id
          ORDER BY ir.updated_at DESC, ir.id DESC
        ) AS rn
      FROM incentive_records ir
      INNER JOIN periods p ON p.id = ir.period_id
      WHERE ir.client_id IN (${idList})
        AND p.start_date <= ${endDate}::date
        AND COALESCE(p.end_date, p.start_date) >= ${startDate}::date
    ) t
    WHERE t.rn = 1
  `);

  const map = new Map<number, IncentiveActionState>();
  for (const row of result.rows) {
    const status =
      row.status === "APPROVED"
        ? "Approved"
        : row.status === "REJECTED"
          ? "Rejected"
          : "Pending";
    map.set(Number(row.client_id), {
      incentiveRecordId: Number(row.id),
      status,
      totalIncentiveAmount: parseFloat(row.total_incentive_amount ?? "0") || 0,
      overrideAmount: row.override_amount === null ? null : parseFloat(row.override_amount) || 0,
      overrideCoreSale: row.override_core_sale === null ? null : parseFloat(row.override_core_sale) || 0,
      overrideAllFinance: row.override_all_finance === null ? null : parseFloat(row.override_all_finance) || 0,
      overrideOtherProducts:
        row.override_other_products === null ? null : parseFloat(row.override_other_products) || 0,
      overrideByUserId: row.approved_by === null ? null : Number(row.approved_by),
      remark: row.remark ?? null,
    });
  }
  return map;
}

export async function getIncentiveRecordById(
  id: number
): Promise<(ExistingIncentiveRecord & { clientId: number; periodId: number }) | null> {
  const result = await db.execute<{
    id: string;
    client_id: string;
    period_id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    total_incentive_amount: string | null;
    override_amount: string | null;
    override_core_sale: string | null;
    override_all_finance: string | null;
    override_other_products: string | null;
    remark: string | null;
    calculation_snapshot: unknown;
  }>(sql`
    SELECT id, client_id, period_id, status, total_incentive_amount, override_amount,
           override_core_sale, override_all_finance, override_other_products, remark, calculation_snapshot
    FROM incentive_records
    WHERE id = ${id}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    clientId: Number(row.client_id),
    periodId: Number(row.period_id),
    status: row.status,
    totalIncentiveAmount: parseFloat(row.total_incentive_amount ?? "0") || 0,
    overrideAmount: row.override_amount === null ? null : parseFloat(row.override_amount) || 0,
    overrideCoreSale: row.override_core_sale === null ? null : parseFloat(row.override_core_sale) || 0,
    overrideAllFinance: row.override_all_finance === null ? null : parseFloat(row.override_all_finance) || 0,
    overrideOtherProducts: row.override_other_products === null ? null : parseFloat(row.override_other_products) || 0,
    remark: row.remark ?? null,
    calculationSnapshot: row.calculation_snapshot,
  };
}

export async function getIncentiveRecordByClientPeriod(
  clientId: number,
  periodId: number
): Promise<ExistingIncentiveRecord | null> {
  const result = await db.execute<{
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    total_incentive_amount: string | null;
    override_amount: string | null;
    override_core_sale: string | null;
    override_all_finance: string | null;
    override_other_products: string | null;
    remark: string | null;
    calculation_snapshot: unknown;
  }>(sql`
    SELECT id, status, total_incentive_amount, override_amount, override_core_sale, override_all_finance, override_other_products, remark, calculation_snapshot
    FROM incentive_records
    WHERE client_id = ${clientId}
      AND period_id = ${periodId}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    totalIncentiveAmount: parseFloat(row.total_incentive_amount ?? "0") || 0,
    overrideAmount: row.override_amount === null ? null : parseFloat(row.override_amount) || 0,
    overrideCoreSale: row.override_core_sale === null ? null : parseFloat(row.override_core_sale) || 0,
    overrideAllFinance: row.override_all_finance === null ? null : parseFloat(row.override_all_finance) || 0,
    overrideOtherProducts:
      row.override_other_products === null ? null : parseFloat(row.override_other_products) || 0,
    remark: row.remark ?? null,
    calculationSnapshot: row.calculation_snapshot,
  };
}

export interface PersistIncentiveActionInput {
  clientId: number;
  counsellorId: number;
  periodId: number;
  saleTypeCategoryId: number | null;
  coreIncentiveAmount: number;
  financeIncentiveAmount: number;
  otherProductIncentiveAmount: number;
  totalIncentiveAmount: number;
  status: "APPROVED" | "REJECTED" | "PENDING";
  calculationSnapshot: unknown;
  actionBy: number;
  remark?: string;
  overrideAmount?: number;
  overrideCoreSale?: number;
  overrideAllFinance?: number;
  overrideOtherProducts?: number;
  existingRecord?: ExistingIncentiveRecord | null;
  coreSale: any;
  allFinance: any;
  otherProducts: any;
  preserveExistingBreakdowns?: boolean;
}

export interface IncentiveBreakdownApprovedTotals {
  hasBreakdowns: boolean;
  coreApprovedAmount: number;
  allFinanceApprovedAmount: number;
  otherProductApprovedAmount: number;
  totalApprovedAmount: number;
}

export async function getApprovedBreakdownTotals(
  incentiveRecordId: number
): Promise<IncentiveBreakdownApprovedTotals> {
  const result = await db.execute<{
    breakdown_count: string;
    core_approved_amount: string | null;
    all_finance_approved_amount: string | null;
    other_product_approved_amount: string | null;
    total_approved_amount: string | null;
  }>(sql`
    SELECT
      COUNT(*)::int AS breakdown_count,
      COALESCE(
        SUM(
          CASE
            WHEN type = 'CORE' AND status = 'APPROVED' THEN calculated_amount::numeric
            ELSE 0
          END
        ),
        0
      ) AS core_approved_amount,
      COALESCE(
        SUM(
          CASE
            WHEN type = 'ALL_FINANCE' AND status = 'APPROVED' THEN calculated_amount::numeric
            ELSE 0
          END
        ),
        0
      ) AS all_finance_approved_amount,
      COALESCE(
        SUM(
          CASE
            WHEN type = 'OTHER_PRODUCT' AND status = 'APPROVED' THEN calculated_amount::numeric
            ELSE 0
          END
        ),
        0
      ) AS other_product_approved_amount,
      COALESCE(
        SUM(
          CASE
            WHEN status = 'APPROVED' THEN calculated_amount::numeric
            ELSE 0
          END
        ),
        0
      ) AS total_approved_amount
    FROM incentive_record_breakdowns
    WHERE incentive_record_id = ${incentiveRecordId}
  `);

  const row = result.rows[0];
  const breakdownCount = Number(row?.breakdown_count ?? 0);
  return {
    hasBreakdowns: breakdownCount > 0,
    coreApprovedAmount: parseFloat(row?.core_approved_amount ?? "0") || 0,
    allFinanceApprovedAmount: parseFloat(row?.all_finance_approved_amount ?? "0") || 0,
    otherProductApprovedAmount: parseFloat(row?.other_product_approved_amount ?? "0") || 0,
    totalApprovedAmount: parseFloat(row?.total_approved_amount ?? "0") || 0,
  };
}

export interface BulkApprovalRowInput {
  clientId: number;
  counsellorId: number;
  periodId: number;
  saleTypeCategoryId: number | null;
  coreIncentiveAmount: number;
  financeIncentiveAmount: number;
  otherProductIncentiveAmount: number;
  totalIncentiveAmount: number;
  calculationSnapshot: unknown;
  ruleSnapshot: unknown;
  approvedBy: number;
  batchId: string;
  coreSale: any;
  allFinance: any;
  otherProducts: any;
  existingRecord?: ExistingIncentiveRecord | null;
}

export async function persistIncentiveAction(input: PersistIncentiveActionInput): Promise<void> {
  await db.transaction(async (tx) => {
    const ruleSaleTypeRow = await tx.execute<{ id: string }>(sql`
      SELECT id FROM rule_configuration_sale_types ORDER BY id ASC LIMIT 1
    `);
    const ruleSaleTypeId = ruleSaleTypeRow.rows[0]?.id ? Number(ruleSaleTypeRow.rows[0].id) : null;

    const snapshotJson = JSON.stringify(input.calculationSnapshot ?? null);
    const approvedAtValue = input.status === "PENDING" ? null : new Date();
    const approvedByValue = input.status === "PENDING" ? null : input.actionBy;
    let incentiveRecordId = input.existingRecord?.id ?? 0;

    if (input.existingRecord?.id) {
      await tx.execute(sql`
        UPDATE incentive_records
        SET
          counsellor_id = ${input.counsellorId},
          sale_type_category_id = ${input.saleTypeCategoryId},
          rule_sale_type_id = ${ruleSaleTypeId},
          core_incentive_amount = ${input.coreIncentiveAmount},
          finance_incentive_amount = ${input.financeIncentiveAmount},
          other_product_incentive_amount = ${input.otherProductIncentiveAmount},
          total_incentive_amount = ${input.totalIncentiveAmount},
          override_amount = ${input.overrideAmount ?? null},
          override_core_sale = ${input.overrideCoreSale ?? null},
          override_all_finance = ${input.overrideAllFinance ?? null},
          override_other_products = ${input.overrideOtherProducts ?? null},
          remark = ${input.remark ?? null},
          calculated_incentive = ${input.totalIncentiveAmount},
          final_incentive = ${input.totalIncentiveAmount},
          status = ${input.status},
          approved_at = ${approvedAtValue},
          approved_by = ${approvedByValue},
          calculation_snapshot = CAST(${snapshotJson} AS jsonb),
          updated_at = now()
        WHERE id = ${input.existingRecord.id}
      `);

      if (!input.preserveExistingBreakdowns) {
        await tx.execute(sql`
          DELETE FROM incentive_record_breakdowns
          WHERE incentive_record_id = ${input.existingRecord.id}
        `);
      }
    } else {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO incentive_records (
          client_id,
          counsellor_id,
          period_id,
          sale_type_category_id,
          rule_sale_type_id,
          core_incentive_amount,
          finance_incentive_amount,
          other_product_incentive_amount,
          total_incentive_amount,
          override_amount,
          override_core_sale,
          override_all_finance,
          override_other_products,
          remark,
          calculated_incentive,
          final_incentive,
          status,
          calculated_at,
          approved_at,
          approved_by,
          calculation_snapshot
        )
        VALUES (
          ${input.clientId},
          ${input.counsellorId},
          ${input.periodId},
          ${input.saleTypeCategoryId},
          ${ruleSaleTypeId},
          ${input.coreIncentiveAmount},
          ${input.financeIncentiveAmount},
          ${input.otherProductIncentiveAmount},
          ${input.totalIncentiveAmount},
          ${input.overrideAmount ?? null},
          ${input.overrideCoreSale ?? null},
          ${input.overrideAllFinance ?? null},
          ${input.overrideOtherProducts ?? null},
          ${input.remark ?? null},
          ${input.totalIncentiveAmount},
          ${input.totalIncentiveAmount},
          ${input.status},
          now(),
          ${approvedAtValue},
          ${approvedByValue},
          CAST(${snapshotJson} AS jsonb)
        )
        RETURNING id
      `);
      incentiveRecordId = Number(inserted.rows[0].id);
    }

    if (!input.preserveExistingBreakdowns && input.coreIncentiveAmount > 0) {
      const slabRangeRaw =
        typeof input.coreSale?.ruleDetail?.slabRange === "string"
          ? input.coreSale.ruleDetail.slabRange.trim()
          : "";
      let slabMin: number | null = null;
      let slabMax: number | null = null;
      if (slabRangeRaw) {
        const nums = slabRangeRaw.match(/\d+/g)?.map(Number) ?? [];
        if (nums.length >= 1 && Number.isFinite(nums[0])) {
          slabMin = nums[0];
          slabMax = nums.length >= 2 && Number.isFinite(nums[1]) ? nums[1] : null;
        }
      }

      await tx.execute(sql`
        INSERT INTO incentive_record_breakdowns (
          incentive_record_id,
          type,
          rule_type,
          achieved_value,
          slab_min,
          slab_max,
          applied_rate,
          calculated_amount,
          meta
        )
        VALUES (
          ${incentiveRecordId},
          'CORE',
          ${input.coreSale?.ruleDetail?.ruleType ?? "slab"},
          ${input.coreSale?.ruleDetail?.counsellorTotal ?? (input.calculationSnapshot as any)?.receivedAmount ?? 0},
          ${slabMin},
          ${slabMax},
          ${input.coreSale?.ruleDetail?.ratePerClient ?? 0},
          ${input.coreIncentiveAmount},
          CAST(${JSON.stringify(input.coreSale?.ruleDetail ?? null)} AS jsonb)
        )
      `);
    }

    if (!input.preserveExistingBreakdowns && input.financeIncentiveAmount > 0 && input.allFinance) {
      await tx.execute(sql`
        INSERT INTO incentive_record_breakdowns (
          incentive_record_id,
          type,
          rule_type,
          achieved_value,
          applied_rate,
          calculated_amount,
          meta
        )
        VALUES (
          ${incentiveRecordId},
          'ALL_FINANCE',
          ${input.allFinance?.ruleDetail?.ruleType ?? "budget"},
          ${input.allFinance?.amount ?? 0},
          ${input.allFinance?.ruleDetail?.ratePerClient ?? 0},
          ${input.financeIncentiveAmount},
          CAST(${JSON.stringify(input.allFinance?.ruleDetail ?? null)} AS jsonb)
        )
      `);
    }

    if (!input.preserveExistingBreakdowns && input.otherProductIncentiveAmount > 0 && input.otherProducts) {
      await tx.execute(sql`
        INSERT INTO incentive_record_breakdowns (
          incentive_record_id,
          type,
          rule_type,
          achieved_value,
          calculated_amount,
          meta
        )
        VALUES (
          ${incentiveRecordId},
          'OTHER_PRODUCT',
          'budget',
          ${input.otherProducts?.totalAmountReceived ?? 0},
          ${input.otherProductIncentiveAmount},
          CAST(${JSON.stringify(input.otherProducts ?? null)} AS jsonb)
        )
      `);
    }

    const actionNewValue = {
      incentiveRecordId,
      clientId: input.clientId,
      periodId: input.periodId,
      status: input.status,
      totalIncentiveAmount: input.totalIncentiveAmount,
      overrideAmount: input.overrideAmount ?? null,
    };
    const oldValueJson = JSON.stringify(
      input.existingRecord
        ? {
            id: input.existingRecord.id,
            status: input.existingRecord.status,
            totalIncentiveAmount: input.existingRecord.totalIncentiveAmount,
            calculationSnapshot: input.existingRecord.calculationSnapshot ?? null,
          }
        : null
    );

    await tx.execute(sql`
      INSERT INTO incentive_audit_logs (
        incentive_record_id,
        action_type,
        old_value,
        new_value,
        remark,
        action_by,
        action_at
      )
      VALUES (
        ${incentiveRecordId},
        ${input.status === "APPROVED" ? "APPROVED" : input.status === "REJECTED" ? "REJECTED" : "EDITED"},
        CAST(${oldValueJson} AS jsonb),
        CAST(${JSON.stringify(actionNewValue)} AS jsonb),
        ${input.remark ?? null},
        ${input.actionBy},
        now()
      )
    `);

    if (input.overrideAmount !== undefined) {
      await tx.execute(sql`
        INSERT INTO incentive_audit_logs (
          incentive_record_id,
          action_type,
          old_value,
          new_value,
          remark,
          action_by,
          action_at
        )
        VALUES (
          ${incentiveRecordId},
          'EDITED',
          CAST(${JSON.stringify({ totalIncentiveAmount: input.coreIncentiveAmount + input.financeIncentiveAmount + input.otherProductIncentiveAmount })} AS jsonb),
          CAST(${JSON.stringify({ totalIncentiveAmount: input.overrideAmount })} AS jsonb),
          ${input.remark ?? "Override applied"},
          ${input.actionBy},
          now()
        )
      `);
    }
  });
}

export async function persistBulkIncentiveApprovals(rows: BulkApprovalRowInput[]): Promise<number> {
  if (!rows.length) return 0;

  await db.transaction(async (tx) => {
    const ruleSaleTypeRow = await tx.execute<{ id: string }>(sql`
      SELECT id FROM rule_configuration_sale_types ORDER BY id ASC LIMIT 1
    `);
    const ruleSaleTypeId = ruleSaleTypeRow.rows[0]?.id ? Number(ruleSaleTypeRow.rows[0].id) : null;

    for (const row of rows) {
      const snapshotJson = JSON.stringify(row.calculationSnapshot ?? null);
      const ruleSnapshotJson = JSON.stringify(row.ruleSnapshot ?? null);
      let incentiveRecordId = row.existingRecord?.id ?? 0;

      if (row.existingRecord?.id) {
        await tx.execute(sql`
          UPDATE incentive_records
          SET
            counsellor_id = ${row.counsellorId},
            sale_type_category_id = ${row.saleTypeCategoryId},
            rule_sale_type_id = ${ruleSaleTypeId},
            core_incentive_amount = ${row.coreIncentiveAmount},
            finance_incentive_amount = ${row.financeIncentiveAmount},
            other_product_incentive_amount = ${row.otherProductIncentiveAmount},
            total_incentive_amount = ${row.totalIncentiveAmount},
            override_amount = NULL,
            remark = NULL,
            approval_batch_id = ${row.batchId},
            calculated_incentive = ${row.totalIncentiveAmount},
            final_incentive = ${row.totalIncentiveAmount},
            status = 'APPROVED',
            approved_at = now(),
            approved_by = ${row.approvedBy},
            calculation_snapshot = CAST(${snapshotJson} AS jsonb),
            rule_snapshot = CAST(${ruleSnapshotJson} AS jsonb),
            updated_at = now()
          WHERE id = ${row.existingRecord.id}
        `);

        await tx.execute(sql`
          DELETE FROM incentive_record_breakdowns
          WHERE incentive_record_id = ${row.existingRecord.id}
        `);
      } else {
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO incentive_records (
            client_id,
            counsellor_id,
            period_id,
            sale_type_category_id,
            rule_sale_type_id,
            core_incentive_amount,
            finance_incentive_amount,
            other_product_incentive_amount,
            total_incentive_amount,
            override_amount,
            remark,
            approval_batch_id,
            calculated_incentive,
            final_incentive,
            status,
            calculated_at,
            approved_at,
            approved_by,
            calculation_snapshot,
            rule_snapshot
          )
          VALUES (
            ${row.clientId},
            ${row.counsellorId},
            ${row.periodId},
            ${row.saleTypeCategoryId},
            ${ruleSaleTypeId},
            ${row.coreIncentiveAmount},
            ${row.financeIncentiveAmount},
            ${row.otherProductIncentiveAmount},
            ${row.totalIncentiveAmount},
            NULL,
            NULL,
            ${row.batchId},
            ${row.totalIncentiveAmount},
            ${row.totalIncentiveAmount},
            'APPROVED',
            now(),
            now(),
            ${row.approvedBy},
            CAST(${snapshotJson} AS jsonb),
            CAST(${ruleSnapshotJson} AS jsonb)
          )
          RETURNING id
        `);
        incentiveRecordId = Number(inserted.rows[0].id);
      }

      if (row.coreIncentiveAmount > 0) {
        await tx.execute(sql`
          INSERT INTO incentive_record_breakdowns (
            incentive_record_id,
            type,
            rule_type,
            achieved_value,
            slab_min,
            slab_max,
            applied_rate,
            calculated_amount,
            meta,
            created_at
          )
          VALUES (
            ${incentiveRecordId},
            'CORE',
            ${row.coreSale?.ruleDetail?.ruleType ?? "slab"},
            ${row.coreSale?.ruleDetail?.counsellorTotal ?? (row.calculationSnapshot as any)?.receivedAmount ?? 0},
            ${null},
            ${null},
            ${row.coreSale?.ruleDetail?.ratePerClient ?? 0},
            ${row.coreIncentiveAmount},
            CAST(${JSON.stringify(row.coreSale?.ruleDetail ?? null)} AS jsonb),
            now()
          )
        `);
      }

      if (row.financeIncentiveAmount > 0 && row.allFinance) {
        await tx.execute(sql`
          INSERT INTO incentive_record_breakdowns (
            incentive_record_id,
            type,
            rule_type,
            achieved_value,
            slab_min,
            slab_max,
            applied_rate,
            calculated_amount,
            meta,
            created_at
          )
          VALUES (
            ${incentiveRecordId},
            'ALL_FINANCE',
            ${row.allFinance?.ruleDetail?.ruleType ?? "budget"},
            ${row.allFinance?.amount ?? 0},
            ${null},
            ${null},
            ${row.allFinance?.ruleDetail?.ratePerClient ?? 0},
            ${row.financeIncentiveAmount},
            CAST(${JSON.stringify(row.allFinance?.ruleDetail ?? null)} AS jsonb),
            now()
          )
        `);
      }

      if (row.otherProductIncentiveAmount > 0 && row.otherProducts) {
        await tx.execute(sql`
          INSERT INTO incentive_record_breakdowns (
            incentive_record_id,
            type,
            rule_type,
            achieved_value,
            slab_min,
            slab_max,
            applied_rate,
            calculated_amount,
            meta,
            created_at
          )
          VALUES (
            ${incentiveRecordId},
            'OTHER_PRODUCT',
            'budget',
            ${row.otherProducts?.totalAmountReceived ?? 0},
            ${null},
            ${null},
            ${0},
            ${row.otherProductIncentiveAmount},
            CAST(${JSON.stringify(row.otherProducts ?? null)} AS jsonb),
            now()
          )
        `);
      }

      await tx.execute(sql`
        INSERT INTO incentive_audit_logs (
          incentive_record_id,
          action_type,
          old_value,
          new_value,
          remark,
          action_by,
          action_at
        )
        VALUES (
          ${incentiveRecordId},
          'APPROVED',
          CAST(NULL AS jsonb),
          CAST(${JSON.stringify({
            batchId: row.batchId,
            totalIncentiveAmount: row.totalIncentiveAmount,
          })} AS jsonb),
          ${`Bulk approved in batch ${row.batchId}`},
          ${row.approvedBy},
          now()
        )
      `);
    }
  });

  return rows.length;
}

// ── Diagnostics: identify which JOIN breaks the result set ───────────────────
// Called automatically when getTotalClientCount returns 0. Remove after debugging.

export async function runIncentiveDiagnostics(
  startDate: string,
  endDate: string
): Promise<void> {
  const tag = "[incentive-diag]";
  try {
    // 1. Raw client count in date range
    const r1 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::int AS n FROM client_information
      WHERE date BETWEEN ${startDate}::date AND ${endDate}::date
    `);
    console.log(tag, "client_information rows in range:", r1.rows[0]?.n);

    // 2. After archived filter
    const r2 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::int AS n FROM client_information
      WHERE date BETWEEN ${startDate}::date AND ${endDate}::date
        AND archived = false
    `);
    console.log(tag, "  → after archived=false:", r2.rows[0]?.n);

    // 3. After joining client_payment
    const r3 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(DISTINCT ci.id)::int AS n
      FROM client_information ci
      INNER JOIN client_payment cp ON cp.client_id = ci.id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND ci.archived = false
    `);
    console.log(tag, "  → after joining client_payment:", r3.rows[0]?.n);

    // 4. After joining sale_type (category_id can be NULL → check)
    const r4 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(DISTINCT ci.id)::int AS n
      FROM client_information ci
      INNER JOIN client_payment cp ON cp.client_id = ci.id
      INNER JOIN sale_type st ON st.id = cp.sale_type_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND ci.archived = false
    `);
    console.log(tag, "  → after joining sale_type:", r4.rows[0]?.n);

    // 5. After joining sale_type_category (drops NULLs!)
    const r5 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(DISTINCT ci.id)::int AS n
      FROM client_information ci
      INNER JOIN client_payment cp ON cp.client_id = ci.id
      INNER JOIN sale_type st ON st.id = cp.sale_type_id
      INNER JOIN sale_type_category stc ON stc.id = st.category_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND ci.archived = false
    `);
    console.log(tag, "  → after joining sale_type_category:", r5.rows[0]?.n);

    // 6. What categories exist?
    const r6 = await db.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM sale_type_category ORDER BY id
    `);
    console.log(tag, "  → sale_type_category rows:", JSON.stringify(r6.rows));

    // 7. How many sale_type rows have category_id = NULL?
    const r7 = await db.execute<{ with_cat: string; without_cat: string }>(sql`
      SELECT
        COUNT(CASE WHEN category_id IS NOT NULL THEN 1 END)::int AS with_cat,
        COUNT(CASE WHEN category_id IS NULL     THEN 1 END)::int AS without_cat
      FROM sale_type
    `);
    console.log(tag, "  → sale_type with category_id:", r7.rows[0]?.with_cat, "| without:", r7.rows[0]?.without_cat);

    // 8. After the name filter
    const r8 = await db.execute<{ n: string }>(sql`
      SELECT COUNT(DISTINCT ci.id)::int AS n
      FROM client_information ci
      INNER JOIN client_payment cp ON cp.client_id = ci.id
      INNER JOIN sale_type st ON st.id = cp.sale_type_id
      INNER JOIN sale_type_category stc ON stc.id = st.category_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND ci.archived = false
        AND stc.name IN ('Spouse', 'Visitor', 'Student')
    `);
    console.log(tag, "  → after stc.name IN ('Spouse','Visitor','Student'):", r8.rows[0]?.n);

    // 9. Distinct category names actually used in the date range
    const r9 = await db.execute<{ name: string; cnt: string }>(sql`
      SELECT stc.name, COUNT(DISTINCT ci.id)::int AS cnt
      FROM client_information ci
      INNER JOIN client_payment cp ON cp.client_id = ci.id
      INNER JOIN sale_type st ON st.id = cp.sale_type_id
      INNER JOIN sale_type_category stc ON stc.id = st.category_id
      WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND ci.archived = false
      GROUP BY stc.name
    `);
    console.log(tag, "  → category names in range:", JSON.stringify(r9.rows));
  } catch (err) {
    console.error(tag, "diagnostic error:", err);
  }
}

// ── Query 3c: Per-counsellor, per-sale-type client counts ─────────────────────
//
// Returns Map<counsellorId, Map<saleTypeId, count>>.
// Used by the service to determine how many clients a counsellor has for each
// specific sale type, so slab rules can be applied per rule configuration
// (e.g. UK Student vs All Student each have different slabs).

export async function getCounsellorSaleTypeCounts(
  startDate: string,
  endDate: string
): Promise<Map<number, Map<number, number>>> {
  const result = await db.execute<{
    counsellor_id: string;
    sale_type_id: string;
    cnt: string;
  }>(sql`
    SELECT ci.counsellor_id, st.id AS sale_type_id, COUNT(DISTINCT ci.id)::int AS cnt
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
      AND stc.name IN ('spouse', 'visitor', 'student')
      AND (
        LOWER(st.sale_type) = 'uk student'
        OR (
          EXISTS (
            SELECT 1 FROM client_payment cp_i
            WHERE cp_i.client_id = ci.id AND cp_i.stage = 'INITIAL'
          )
          AND (
            EXISTS (SELECT 1 FROM client_payment cp_bv WHERE cp_bv.client_id = ci.id AND cp_bv.stage = 'BEFORE_VISA')
            OR EXISTS (
              SELECT 1 FROM client_product_payment cpp_af
              INNER JOIN all_finance af_c ON cpp_af.entity_type = 'allFinance_id' AND cpp_af.entity_id = af_c.id
              WHERE cpp_af.client_id = ci.id AND af_c.approval_status = 'approved'
            )
            OR EXISTS (
              SELECT 1 FROM client_product_payment cpp_noc
              WHERE cpp_noc.client_id = ci.id AND cpp_noc.product_name = 'NOC_LEVEL_JOB_ARRANGEMENT'
            )
          )
        )
      )
    GROUP BY ci.counsellor_id, st.id
  `);

  const map = new Map<number, Map<number, number>>();
  for (const row of result.rows) {
    const counsellorId = Number(row.counsellor_id);
    const saleTypeId   = Number(row.sale_type_id);
    const cnt          = Number(row.cnt);
    if (!map.has(counsellorId)) map.set(counsellorId, new Map());
    map.get(counsellorId)!.set(saleTypeId, cnt);
  }
  return map;
}

// ── Raw (unfiltered) counts — used alongside qualifying counts for display ────

export async function getCompanyWideSpouseCountTotal(
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
      AND ci.archived = false
      AND stc.name = 'spouse'
  `);
  return Number(result.rows[0]?.spouse_count) || 0;
}

export async function getCounsellorStudentCountsTotal(
  startDate: string,
  endDate: string
): Promise<Map<number, number>> {
  const result = await db.execute<{
    counsellor_id: string;
    student_count: string;
  }>(sql`
    SELECT ci.counsellor_id, COUNT(DISTINCT ci.id)::int AS student_count
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
      AND stc.name = 'student'
    GROUP BY ci.counsellor_id
  `);
  const map = new Map<number, number>();
  for (const row of result.rows) {
    map.set(Number(row.counsellor_id), Number(row.student_count) || 0);
  }
  return map;
}

export async function getCounsellorSaleTypeCountsTotal(
  startDate: string,
  endDate: string
): Promise<Map<number, Map<number, number>>> {
  const result = await db.execute<{
    counsellor_id: string;
    sale_type_id: string;
    cnt: string;
  }>(sql`
    SELECT ci.counsellor_id, st.id AS sale_type_id, COUNT(DISTINCT ci.id)::int AS cnt
    FROM client_information ci
    INNER JOIN client_payment cp      ON cp.client_id  = ci.id
    INNER JOIN sale_type st            ON st.id          = cp.sale_type_id
    INNER JOIN sale_type_category stc  ON stc.id         = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
      AND stc.name IN ('spouse', 'visitor', 'student')
    GROUP BY ci.counsellor_id, st.id
  `);
  const map = new Map<number, Map<number, number>>();
  for (const row of result.rows) {
    const counsellorId = Number(row.counsellor_id);
    const saleTypeId   = Number(row.sale_type_id);
    const cnt          = Number(row.cnt);
    if (!map.has(counsellorId)) map.set(counsellorId, new Map());
    map.get(counsellorId)!.set(saleTypeId, cnt);
  }
  return map;
}

/**
 * Company-wide count of distinct clients with at least one approved All Finance payment in the period,
 * broken down by sale-type category name (e.g. 'spouse', 'student', 'visitor').
 * Use this so that Spouse slabs and Student slabs are checked against their own category counts, not combined.
 */
export async function getCompanyWideAllFinanceCountByCategory(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const result = await db.execute<{ category: string; af_count: string }>(sql`
    SELECT stc.name AS category, COUNT(DISTINCT cpp.client_id)::int AS af_count
    FROM client_product_payment cpp
    INNER JOIN all_finance af      ON cpp.entity_type = 'allFinance_id' AND cpp.entity_id = af.id
    INNER JOIN client_information ci ON ci.id = cpp.client_id
    INNER JOIN client_payment cp   ON cp.client_id = ci.id
    INNER JOIN sale_type st        ON st.id = cp.sale_type_id
    INNER JOIN sale_type_category stc ON stc.id = st.category_id
    WHERE af.approval_status = 'approved'
      AND af.payment_date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
    GROUP BY stc.name
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.category, Number(row.af_count) || 0);
  }
  return map;
}

// ── Query 4a: Per-client all-finance total amount ────────────────────────────

export async function getClientAllFinanceAmounts(
  clientIds: number[],
  startDate?: string,
  endDate?: string
): Promise<Map<number, number>> {
  if (clientIds.length === 0) return new Map();

  const dateFilter =
    startDate && endDate
      ? sql`${allFinance.paymentDate} BETWEEN ${startDate}::date AND ${endDate}::date`
      : undefined;

  const rows = await db
    .select({
      clientId: clientProductPayments.clientId,
      amount: allFinance.amount,
      anotherPaymentAmount: allFinance.anotherPaymentAmount,
      anotherPaymentAmount2: allFinance.anotherPaymentAmount2,
      anotherPaymentAmount3: allFinance.anotherPaymentAmount3,
    })
    .from(clientProductPayments)
    .innerJoin(
      allFinance,
      and(
        eq(clientProductPayments.entityType, "allFinance_id"),
        eq(clientProductPayments.entityId, allFinance.financeId)
      )
    )
    .where(
      and(
        inArray(clientProductPayments.clientId, clientIds),
        eq(allFinance.approvalStatus, "approved"),
        dateFilter
      )
    );

  const map = new Map<number, number>();
  for (const row of rows) {
    const base = parseFloat(row.amount ?? "0") || 0;
    const extra1 = parseFloat(row.anotherPaymentAmount ?? "0") || 0;
    const extra2 = parseFloat(row.anotherPaymentAmount2 ?? "0") || 0;
    const extra3 = parseFloat(row.anotherPaymentAmount3 ?? "0") || 0;
    map.set(row.clientId, (map.get(row.clientId) ?? 0) + base + extra1 + extra2 + extra3);
  }
  return map;
}

// ── Query 4b: Per-client other product payments (excluding all-finance) ───────

export interface ClientProductItem {
  productName: string;
  amount: number;
}

export async function getClientOtherProductPayments(
  clientIds: number[]
): Promise<Map<number, ClientProductItem[]>> {
  if (clientIds.length === 0) return new Map();

  const rows = await db
    .select({
      clientId:    clientProductPayments.clientId,
      productName: clientProductPayments.productName,
      amount:      clientProductPayments.amount,
    })
    .from(clientProductPayments)
    .where(
      and(
        inArray(clientProductPayments.clientId, clientIds),
        ne(clientProductPayments.entityType, "allFinance_id")
      )
    );

  const map = new Map<number, ClientProductItem[]>();
  for (const row of rows) {
    const items = map.get(row.clientId) ?? [];
    const existing = items.find((p) => p.productName === row.productName);
    if (existing) {
      existing.amount += parseFloat(row.amount ?? "0") || 0;
    } else {
      items.push({ productName: row.productName, amount: parseFloat(row.amount ?? "0") || 0 });
    }
    map.set(row.clientId, items);
  }
  return map;
}

// ── Product display-name lookup ───────────────────────────────────────────────

export async function getProductDisplayNameMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      productName: otherProductsTable.productName,
      name:        otherProductsTable.name,
    })
    .from(otherProductsTable);

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.productName, row.name);
  }
  return map;
}

/** Maps `client_product_payments.product_name` → `op_<other_products.id>` for rule_configuration_sale_types. */
export async function getProductNameToOpRuleKeyMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id:          otherProductsTable.id,
      productName: otherProductsTable.productName,
    })
    .from(otherProductsTable);

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.productName, `op_${row.id}`);
  }
  return map;
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
      clientId:     clientPayments.clientId,
      stage:        clientPayments.stage,
      amount:       clientPayments.amount,
      totalPayment: clientPayments.totalPayment,
      paymentDate:  clientPayments.paymentDate,
    })
    .from(clientPayments)
    .where(inArray(clientPayments.clientId, clientIds));

  const map = new Map<number, PaymentStage>();
  for (const row of rows) {
    const existing: PaymentStage = map.get(row.clientId) ?? {
      clientId:           row.clientId,
      hasBeforeVisa:      false,
      hasInitial:         false,
      initialAmount:      0,
      beforeVisaAmount:   0,
      afterVisaAmount:    0,
      totalPaymentAmount: 0,
      latestPaymentDate:  null,
      initialPaymentDate: null,
      beforeVisaPaymentDate: null,
      afterVisaPaymentDate:  null,
    };
    const rowTotalPayment = parseFloat(row.totalPayment ?? "0") || 0;
    if (rowTotalPayment > existing.totalPaymentAmount) {
      existing.totalPaymentAmount = rowTotalPayment;
    }
    const paymentDate = row.paymentDate ? String(row.paymentDate).slice(0, 10) : null;
    if (paymentDate && (!existing.latestPaymentDate || paymentDate > existing.latestPaymentDate)) {
      existing.latestPaymentDate = paymentDate;
    }
    const amt = parseFloat(row.amount ?? "0") || 0;
    if (row.stage === "BEFORE_VISA") {
      existing.hasBeforeVisa    = true;
      existing.beforeVisaAmount += amt;
      if (paymentDate && (!existing.beforeVisaPaymentDate || paymentDate > existing.beforeVisaPaymentDate)) {
        existing.beforeVisaPaymentDate = paymentDate;
      }
    } else if (row.stage === "INITIAL") {
      existing.hasInitial    = true;
      existing.initialAmount += amt;
      if (paymentDate && (!existing.initialPaymentDate || paymentDate > existing.initialPaymentDate)) {
        existing.initialPaymentDate = paymentDate;
      }
    } else if (row.stage === "AFTER_VISA") {
      existing.afterVisaAmount += amt;
      if (paymentDate && (!existing.afterVisaPaymentDate || paymentDate > existing.afterVisaPaymentDate)) {
        existing.afterVisaPaymentDate = paymentDate;
      }
    }
    map.set(row.clientId, existing);
  }
  return map;
}
