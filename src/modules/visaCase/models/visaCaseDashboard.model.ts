import { getPoolSecond } from "../../../config/databaseConnectionSecond";

export type DashboardDateFilter = {
  fromDate?: string;
  toDate?: string;
  /** Enrollment trend window — when set, overrides fromDate/toDate for the chart only. */
  trendFromDate?: string;
  trendToDate?: string;
  userId?: number;
  branchCode?: string;
  trendMonths?: number;
  trendGranularity?: "month" | "day" | "hour";
  trendAllTime?: boolean;
  /** When false, skip enrollment trend query (backend report uses dedicated API). */
  includeEnrollmentTrend?: boolean;
};

export type EnrollmentTrendQueryFilter = {
  branchCode?: string;
  userId?: number;
  range: "6_month" | "12_month" | "maximum";
  monthBuckets?: number;
};

const buildEnrollmentTrendQuery = (
  filters: DashboardDateFilter | EnrollmentTrendQueryFilter
): { sql: string; params: unknown[] } => {
  const params: unknown[] = [];
  let idx = 1;

  const granularity =
    "trendGranularity" in filters ? (filters.trendGranularity ?? "month") : "month";
  const trendFrom =
    "trendFromDate" in filters ? filters.trendFromDate ?? filters.fromDate : undefined;
  const trendTo =
    "trendToDate" in filters ? filters.trendToDate ?? filters.toDate : undefined;
  const useTrendPeriod = Boolean(trendFrom && trendTo);
  const trendAllTime =
    "range" in filters
      ? filters.range === "maximum"
      : "trendAllTime" in filters && filters.trendAllTime === true;

  let dateClause: string;
  if (trendAllTime) {
    dateClause = "TRUE";
  } else if (useTrendPeriod) {
    dateClause = `c.enrollment_date >= $${idx++}::date AND c.enrollment_date <= $${idx++}::date`;
    params.push(trendFrom, trendTo);
  } else {
    const monthsBack =
      "monthBuckets" in filters && filters.monthBuckets != null
        ? filters.monthBuckets
        : "trendMonths" in filters
          ? (filters.trendMonths ?? 12)
          : 12;
    dateClause = `c.enrollment_date >= (date_trunc('month', CURRENT_DATE)::date - (($${idx}::int - 1) || ' months')::interval)`;
    params.push(monthsBack);
  }

  let bucketKeyExpr: string;
  let labelExpr: string;
  let groupExpr: string;
  let orderExpr: string;

  if (granularity === "hour") {
    bucketKeyExpr = `to_char(date_trunc('hour', c.enrollment_date), 'YYYY-MM-DD HH24')`;
    labelExpr = `to_char(date_trunc('hour', c.enrollment_date), 'HH12 AM')`;
    groupExpr = `date_trunc('hour', c.enrollment_date)`;
    orderExpr = groupExpr;
  } else if (granularity === "day") {
    bucketKeyExpr = `to_char(c.enrollment_date, 'YYYY-MM-DD')`;
    labelExpr = `to_char(c.enrollment_date, 'DD Mon')`;
    groupExpr = `c.enrollment_date`;
    orderExpr = `c.enrollment_date`;
  } else {
    bucketKeyExpr = `to_char(date_trunc('month', c.enrollment_date), 'YYYY-MM')`;
    labelExpr = `to_char(date_trunc('month', c.enrollment_date), 'Mon YYYY')`;
    groupExpr = `date_trunc('month', c.enrollment_date)`;
    orderExpr = groupExpr;
  }

  const userClause =
    filters.userId != null ? `AND vc.user_id = $${idx++}` : "";
  if (filters.userId != null) {
    params.push(filters.userId);
  }

  const branchClause =
    filters.branchCode != null && filters.branchCode !== ""
      ? `AND c.branch_code = $${idx++}`
      : "";
  if (filters.branchCode != null && filters.branchCode !== "") {
    params.push(filters.branchCode);
  }

  return {
    sql: `
      SELECT
        ${bucketKeyExpr} AS bucket_key,
        ${labelExpr} AS month_label,
        COUNT(*)::text AS enrollments
      FROM visa_cases vc
      INNER JOIN clients c ON c.id = vc.client_id
      WHERE ${dateClause}
      ${userClause}
      ${branchClause}
      GROUP BY ${groupExpr}
      ORDER BY ${orderExpr}
    `,
    params,
  };
};

const dateFilterSql = (
  filters: DashboardDateFilter,
  paramStart: number
): { clause: string; params: unknown[] } => {
  const params: unknown[] = [];
  const parts: string[] = [];
  let idx = paramStart;

  if (filters.fromDate) {
    parts.push(`c.enrollment_date >= $${idx++}::date`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    parts.push(`c.enrollment_date <= $${idx++}::date`);
    params.push(filters.toDate);
  }
  if (filters.userId != null) {
    parts.push(`vc.user_id = $${idx++}`);
    params.push(filters.userId);
  }
  if (filters.branchCode) {
    parts.push(`c.branch_code = $${idx++}`);
    params.push(filters.branchCode);
  }

  const clause = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  return { clause, params };
};

/** Travel destination when set; otherwise sale type country (matches visa case list). */
const baseFromWithResolvedCountry = `
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
    INNER JOIN sales s ON s.id = vc.sale_id
    INNER JOIN sale_type st ON st.id = s.sale_type_id
    LEFT JOIN countries dest_co ON dest_co.id = vc.destination_country_id
    LEFT JOIN countries sale_co ON sale_co.id = st.country_id
  `;

const resolvedCountryNameSql = `COALESCE(dest_co.name, sale_co.name, 'Unknown')`;

export type ScopedVisaCaseFinancialLookup = {
  clientId: string;
  legacyClientId: number | null;
  legacySaleTypeId: number | null;
};

export const fetchScopedVisaCaseFinancialLookups = async (
  filters: DashboardDateFilter
): Promise<ScopedVisaCaseFinancialLookup[]> => {
  const { clause, params } = dateFilterSql(filters, 1);

  const { rows } = await getPoolSecond().query<{
    client_id: string;
    legacy_client_id: string | null;
    legacy_sale_type_id: string | null;
  }>(
    `
    SELECT
      c.id::text AS client_id,
      c.legacy_client_id::text AS legacy_client_id,
      st.legacy_sale_type_id::text AS legacy_sale_type_id
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
    INNER JOIN sales s ON s.id = vc.sale_id
    INNER JOIN sale_type st ON st.id = s.sale_type_id
    ${clause ? `\n    ${clause}` : ""}
    `,
    params
  );

  return rows.map((row) => ({
    clientId: row.client_id,
    legacyClientId:
      row.legacy_client_id != null
        ? Number.parseInt(row.legacy_client_id, 10)
        : null,
    legacySaleTypeId:
      row.legacy_sale_type_id != null
        ? Number.parseInt(row.legacy_sale_type_id, 10)
        : null,
  }));
};

export const fetchDashboardAggregates = async (
  filters: DashboardDateFilter
) => {
  const { clause, params } = dateFilterSql(filters, 1);
  const includeEnrollmentTrend = filters.includeEnrollmentTrend !== false;

  const baseFrom = `
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
  `;

  const withWhere = (fromClause: string) =>
    `${fromClause}${clause ? `\n    ${clause}` : ""}`;

  const [
    totalsResult,
    decisionResult,
    destinationResult,
    sponsorResult,
    travelResult,
    stageResult,
    accompanyingResult,
    enrollmentTrendResult,
    decisionByDestinationResult,
    processingTimesResult,
  ] = await Promise.all([
    getPoolSecond().query<{
      total_clients: string;
      approved: string;
      refused: string;
      withdrawn: string;
      pending: string;
      files_submitted: string;
    }>(
      `
      SELECT
        COUNT(*)::text AS total_clients,
        COUNT(*) FILTER (WHERE vc.decision = 'APPROVED')::text AS approved,
        COUNT(*) FILTER (WHERE vc.decision = 'REFUSED')::text AS refused,
        COUNT(*) FILTER (WHERE vc.decision = 'WITHDRAWN')::text AS withdrawn,
        COUNT(*) FILTER (WHERE vc.decision = 'PENDING')::text AS pending,
        COUNT(*) FILTER (WHERE vc.current_sub_status = 'FILE_SUBMITTED')::text AS files_submitted
      ${withWhere(baseFrom)}
      `,
      params
    ),
    getPoolSecond().query<{ decision: string; count: string }>(
      `
      SELECT vc.decision, COUNT(*)::text AS count
      ${withWhere(baseFrom)}
      GROUP BY vc.decision
      ORDER BY vc.decision
      `,
      params
    ),
    getPoolSecond().query<{ country_name: string; count: string }>(
      `
      SELECT ${resolvedCountryNameSql} AS country_name, COUNT(*)::text AS count
      ${withWhere(baseFromWithResolvedCountry)}
      GROUP BY ${resolvedCountryNameSql}
      ORDER BY count DESC, country_name
      `,
      params
    ),
    getPoolSecond().query<{ sponsor: string; count: string }>(
      `
      SELECT COALESCE(vc.sponsor_relationship::text, 'Unknown') AS sponsor, COUNT(*)::text AS count
      ${withWhere(baseFrom)}
      GROUP BY vc.sponsor_relationship
      ORDER BY count DESC
      `,
      params
    ),
    getPoolSecond().query<{ reason: string; count: string }>(
      `
      SELECT COALESCE(vc.reason_of_travel::text, 'Unknown') AS reason, COUNT(*)::text AS count
      ${withWhere(baseFrom)}
      GROUP BY vc.reason_of_travel
      ORDER BY count DESC
      `,
      params
    ),
    getPoolSecond().query<{ stage: string; count: string }>(
      `
      SELECT vc.current_stage::text AS stage, COUNT(*)::text AS count
      ${withWhere(baseFrom)}
      GROUP BY vc.current_stage
      ORDER BY vc.current_stage
      `,
      params
    ),
    getPoolSecond().query<{
      total_accompanying: string;
      cases_with_accompanying: string;
      avg_members: string;
    }>(
      `
      SELECT
        COALESCE(SUM(vc.accompanying_members_count), 0)::text AS total_accompanying,
        COUNT(*) FILTER (WHERE vc.accompanying_members_count > 0)::text AS cases_with_accompanying,
        COALESCE(AVG(NULLIF(vc.accompanying_members_count, 0)), 0)::text AS avg_members
      ${withWhere(baseFrom)}
      `,
      params
    ),
    (async () => {
      if (!includeEnrollmentTrend) {
        return {
          rows: [] as Array<{
            bucket_key: string;
            month_label: string;
            enrollments: string;
          }>,
        };
      }
      const trendQuery = buildEnrollmentTrendQuery(filters);
      const result = await getPoolSecond().query<{
        bucket_key: string;
        month_label: string;
        enrollments: string;
      }>(trendQuery.sql, trendQuery.params);
      return result;
    })(),
    getPoolSecond().query<{
      country_name: string;
      approved: string;
      refused: string;
      withdrawn: string;
      pending: string;
      total: string;
    }>(
      `
      SELECT
        ${resolvedCountryNameSql} AS country_name,
        COUNT(*) FILTER (WHERE vc.decision = 'APPROVED')::text AS approved,
        COUNT(*) FILTER (WHERE vc.decision = 'REFUSED')::text AS refused,
        COUNT(*) FILTER (WHERE vc.decision = 'WITHDRAWN')::text AS withdrawn,
        COUNT(*) FILTER (WHERE vc.decision = 'PENDING')::text AS pending,
        COUNT(*)::text AS total
      ${withWhere(baseFromWithResolvedCountry)}
      GROUP BY ${resolvedCountryNameSql}
      ORDER BY total DESC, country_name
      `,
      params
    ),
    getPoolSecond().query<{
      avg_enrollment_to_submission: string | null;
      avg_submission_to_decision: string | null;
      avg_enrollment_to_decision: string | null;
      avg_assignment_to_decision: string | null;
    }>(
      `
      SELECT
        AVG(vc.submission_date - c.enrollment_date)::text AS avg_enrollment_to_submission,
        AVG(vc.decision_date - vc.submission_date) FILTER (
          WHERE vc.submission_date IS NOT NULL AND vc.decision_date IS NOT NULL
        )::text AS avg_submission_to_decision,
        AVG(vc.decision_date - c.enrollment_date) FILTER (
          WHERE vc.decision_date IS NOT NULL
        )::text AS avg_enrollment_to_decision,
        AVG(vc.decision_date - first_assign.first_assignment_date) FILTER (
          WHERE vc.decision_date IS NOT NULL
            AND first_assign.first_assignment_date IS NOT NULL
        )::text AS avg_assignment_to_decision
      ${baseFrom}
      LEFT JOIN (
        SELECT a.visa_case_id, MIN(a.created_at)::date AS first_assignment_date
        FROM visa_case_assignments a
        GROUP BY a.visa_case_id
      ) first_assign ON first_assign.visa_case_id = vc.id
      ${clause ? `\n      ${clause}` : ""}
      `,
      params
    ),
  ]);

  return {
    totals: totalsResult.rows[0],
    byDecision: decisionResult.rows,
    byDestination: destinationResult.rows,
    bySponsor: sponsorResult.rows,
    byTravelReason: travelResult.rows,
    byStage: stageResult.rows,
    accompanying: accompanyingResult.rows[0],
    enrollmentTrend: enrollmentTrendResult.rows,
    decisionByDestination: decisionByDestinationResult.rows,
    processingTimes: processingTimesResult.rows[0],
  };
};

export const fetchEnrollmentTrendRows = async (
  filter: EnrollmentTrendQueryFilter
) => {
  const trendQuery = buildEnrollmentTrendQuery(filter);
  const result = await getPoolSecond().query<{
    bucket_key: string;
    month_label: string;
    enrollments: string;
  }>(trendQuery.sql, trendQuery.params);
  return result.rows;
};

export const fetchEnrollmentTrendEarliestMonth = async (
  branchCode?: string
): Promise<string | null> => {
  const params: unknown[] = [];
  let branchClause = "";

  if (branchCode?.trim()) {
    branchClause = "AND c.branch_code = $1";
    params.push(branchCode.trim());
  }

  const result = await getPoolSecond().query<{ bucket_key: string | null }>(
    `
    SELECT to_char(date_trunc('month', MIN(c.enrollment_date)), 'YYYY-MM') AS bucket_key
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
    WHERE c.enrollment_date IS NOT NULL
    ${branchClause}
    `,
    params
  );

  return result.rows[0]?.bucket_key ?? null;
};
