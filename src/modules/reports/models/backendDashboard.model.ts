import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import type { ReportDateRange } from "../utils/reportDateRange";

export type BackendDashboardQuery = ReportDateRange & {
  branchCode?: string;
};

type SqlFilter = {
  clause: string;
  params: unknown[];
};

const buildEnrollmentFilter = (
  filters: BackendDashboardQuery,
  paramStart = 1
): SqlFilter => {
  const params: unknown[] = [];
  const parts: string[] = [];
  let idx = paramStart;

  parts.push(`c.enrollment_date >= $${idx++}::date`);
  params.push(filters.fromDate);

  parts.push(`c.enrollment_date <= $${idx++}::date`);
  params.push(filters.toDate);

  if (filters.branchCode) {
    parts.push(`c.branch_code = $${idx++}`);
    params.push(filters.branchCode);
  }

  return {
    clause: `WHERE ${parts.join(" AND ")}`,
    params,
  };
};

const baseFromWithCategory = `
  FROM visa_cases vc
  INNER JOIN clients c ON c.id = vc.client_id
  INNER JOIN sales s ON s.id = vc.sale_id
  INNER JOIN sale_type st ON st.id = s.sale_type_id
  LEFT JOIN visa_categories vcat ON vcat.id = st.visa_category_id
`;

export type BackendDashboardAggregates = {
  totals: {
    total_clients: string;
    approved: string;
    refused: string;
    withdrawn: string;
    pending: string;
    files_submitted: string;
  } | undefined;
  byCategory: Array<{ category: string; count: string }>;
  byStage: Array<{ stage: string; count: string }>;
  teamLeaderboard: Array<{
    assigned_user_id: string;
    assigned_team: string;
    active_cases: string;
    approved: string;
    refused: string;
    withdrawn: string;
    pending: string;
    files_submitted: string;
  }>;
};

export const fetchBackendDashboardAggregates = async (
  filters: BackendDashboardQuery
): Promise<BackendDashboardAggregates> => {
  const { clause, params } = buildEnrollmentFilter(filters);
  const withCategoryWhere = `${baseFromWithCategory}\n    ${clause}`;

  const scopedCasesCte = `
    WITH scoped_cases AS (
      SELECT
        vc.decision,
        vc.current_sub_status,
        vc.current_stage,
        vc.assigned_user_id,
        vc.assigned_team
      FROM visa_cases vc
      INNER JOIN clients c ON c.id = vc.client_id
      ${clause}
    )
  `;

  const [coreResult, categoryResult] = await Promise.all([
    getPoolSecond().query<{
      totals: {
        total_clients: string;
        approved: string;
        refused: string;
        withdrawn: string;
        pending: string;
        files_submitted: string;
      };
      by_stage: Array<{ stage: string; count: string }> | null;
      team_leaderboard: Array<{
        assigned_user_id: string;
        assigned_team: string;
        active_cases: string;
        approved: string;
        refused: string;
        withdrawn: string;
        pending: string;
        files_submitted: string;
      }> | null;
    }>(
      `
      ${scopedCasesCte}
      SELECT
        (
          SELECT row_to_json(t)
          FROM (
            SELECT
              COUNT(*)::text AS total_clients,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_APPROVED')::text AS approved,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_REFUSED')::text AS refused,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_WITHDRAWN')::text AS withdrawn,
              COUNT(*) FILTER (WHERE current_sub_status NOT IN ('DECISION_APPROVED', 'DECISION_REFUSED', 'DECISION_WITHDRAWN'))::text AS pending,
              COUNT(*) FILTER (WHERE current_sub_status = 'FILE_SUBMITTED')::text AS files_submitted
            FROM scoped_cases
          ) t
        ) AS totals,
        (
          SELECT COALESCE(json_agg(row ORDER BY stage), '[]'::json)
          FROM (
            SELECT current_stage::text AS stage, COUNT(*)::text AS count
            FROM scoped_cases
            GROUP BY current_stage
          ) row
        ) AS by_stage,
        (
          SELECT COALESCE(json_agg(row ORDER BY active_cases DESC, assigned_user_id), '[]'::json)
          FROM (
            SELECT
              assigned_user_id::text AS assigned_user_id,
              assigned_team::text AS assigned_team,
              COUNT(*)::text AS active_cases,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_APPROVED')::text AS approved,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_REFUSED')::text AS refused,
              COUNT(*) FILTER (WHERE current_sub_status = 'DECISION_WITHDRAWN')::text AS withdrawn,
              COUNT(*) FILTER (WHERE current_sub_status NOT IN ('DECISION_APPROVED', 'DECISION_REFUSED', 'DECISION_WITHDRAWN'))::text AS pending,
              COUNT(*) FILTER (WHERE current_sub_status = 'FILE_SUBMITTED')::text AS files_submitted
            FROM scoped_cases
            WHERE assigned_user_id IS NOT NULL
              AND assigned_team IN ('cx', 'binding', 'application')
            GROUP BY assigned_user_id, assigned_team
          ) row
        ) AS team_leaderboard
      `,
      params
    ),
    getPoolSecond().query<{ category: string; count: string }>(
      `
      SELECT COALESCE(vcat.slug, 'unknown') AS category, COUNT(*)::text AS count
      ${withCategoryWhere}
      GROUP BY vcat.slug
      ORDER BY vcat.slug
      `,
      params
    ),
  ]);

  const core = coreResult.rows[0];

  return {
    totals: core?.totals,
    byCategory: categoryResult.rows,
    byStage: core?.by_stage ?? [],
    teamLeaderboard: core?.team_leaderboard ?? [],
  };
};
