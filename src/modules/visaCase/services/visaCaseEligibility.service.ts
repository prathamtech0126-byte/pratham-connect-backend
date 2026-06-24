import { pool } from "../../../config/databaseConnection";

const VISA_CASE_CATEGORY_SLUGS = ["visitor", "spouse", "student"] as const;

export type VisaCaseEligibilityResult = {
  eligible: boolean;
  reason?: string;
};

const normalizeCategory = (name: string | null | undefined): string =>
  (name ?? "").trim().toLowerCase();

const isVisaCaseCategory = (categoryName: string | null | undefined): boolean =>
  (VISA_CASE_CATEGORY_SLUGS as readonly string[]).includes(
    normalizeCategory(categoryName)
  );

/** Sale types linked to this client via payments or student applications (visitor/spouse/student only). */
export const listCandidateSaleTypeIdsForVisaSync = async (
  legacyClientId: number
): Promise<number[]> => {
  const { rows } = await pool.query<{ sale_type_id: number }>(
    `
    SELECT DISTINCT cp.sale_type_id
    FROM client_payment cp
    INNER JOIN sale_type st ON st.id = cp.sale_type_id
    INNER JOIN sale_type_category stc ON stc.id = st.category_id
    WHERE cp.client_id = $1
      AND LOWER(stc.name) = ANY($2::text[])

    UNION

    SELECT DISTINCT sa.sale_type_id::int
    FROM student_application sa
    INNER JOIN sale_type st ON st.id = sa.sale_type_id
    INNER JOIN sale_type_category stc ON stc.id = st.category_id
    WHERE sa.client_id = $1
      AND LOWER(stc.name) = ANY($2::text[])
    `,
    [legacyClientId, [...VISA_CASE_CATEGORY_SLUGS]]
  );

  return rows.map((row) => Number(row.sale_type_id)).filter((id) => id > 0);
};

const clientHasSaleType = async (
  legacyClientId: number,
  legacySaleTypeId: number
): Promise<boolean> => {
  const { rows } = await pool.query<{ linked: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM client_payment
      WHERE client_id = $1 AND sale_type_id = $2

      UNION ALL

      SELECT 1
      FROM student_application
      WHERE client_id = $1 AND sale_type_id = $2
    ) AS linked
    `,
    [legacyClientId, legacySaleTypeId]
  );

  return rows[0]?.linked === true;
};

/**
 * Visa case eligibility requires both:
 * 1. Client is enrolled (enrollment date set)
 * 2. Client is linked to the sale type (via payment or student application)
 *
 * Visitor / spouse / student categories only. Payment stages are not checked.
 */
export const checkVisaCaseEligibility = async (
  legacyClientId: number,
  legacySaleTypeId: number
): Promise<VisaCaseEligibilityResult> => {
  const clientResult = await pool.query<{
    enrollment_date: string | null;
    archived: boolean | null;
  }>(
    `SELECT date AS enrollment_date, archived
     FROM client_information
     WHERE id = $1
     LIMIT 1`,
    [legacyClientId]
  );

  const client = clientResult.rows[0];
  if (!client) {
    return { eligible: false, reason: "client not found" };
  }

  if (client.archived) {
    return { eligible: false, reason: "client archived" };
  }

  if (!client.enrollment_date) {
    return { eligible: false, reason: "client not enrolled" };
  }

  const saleTypeResult = await pool.query<{ category_name: string | null }>(
    `SELECT stc.name AS category_name
     FROM sale_type st
     LEFT JOIN sale_type_category stc ON stc.id = st.category_id
     WHERE st.id = $1
     LIMIT 1`,
    [legacySaleTypeId]
  );

  const categoryName = saleTypeResult.rows[0]?.category_name;
  if (!isVisaCaseCategory(categoryName)) {
    return {
      eligible: false,
      reason: `sale type category "${categoryName ?? "unknown"}" is not visitor/spouse/student`,
    };
  }

  const linked = await clientHasSaleType(legacyClientId, legacySaleTypeId);
  if (!linked) {
    return {
      eligible: false,
      reason: "client has no payment or student application for this sale type",
    };
  }

  return { eligible: true };
};
