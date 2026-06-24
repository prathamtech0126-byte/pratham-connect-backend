import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import {
  BINDING_APPLICATION_READY_FOR_HANDOFF,
  CX_READY_FOR_HANDOFF,
  OPS_STUCK_CASE_DAYS,
  RECEIVED_FROM_CX_ASSIGNMENT_TYPE,
  type OpsDashboardProfile,
} from "../constants/opsDashboard.constants";
import type { OpsDashboardScope } from "../utils/opsDashboardScope";
import type { ReportDateRange } from "../utils/reportDateRange";

export type OpsDashboardQuery = {
  assignedUserId: number;
  profile: OpsDashboardProfile;
  teamStages: readonly string[];
  scope: OpsDashboardScope;
  handoffPeriod: ReportDateRange;
};

type SqlParts = {
  clause: string;
  params: unknown[];
};

const baseFrom = `
  FROM visa_cases vc
  INNER JOIN clients c ON c.id = vc.client_id
`;

const baseFromWithCategory = `
  FROM visa_cases vc
  INNER JOIN clients c ON c.id = vc.client_id
  INNER JOIN sales s ON s.id = vc.sale_id
  INNER JOIN sale_type st ON st.id = s.sale_type_id
  LEFT JOIN visa_categories vcat ON vcat.id = st.visa_category_id
`;

const buildCaseFilter = (
  query: OpsDashboardQuery,
  paramStart = 1
): SqlParts => {
  const params: unknown[] = [query.assignedUserId];
  const parts: string[] = [`vc.assigned_user_id = $${paramStart}`];

  if (query.scope.mode === "period") {
    parts.push(`c.enrollment_date >= $${params.length + 1}::date`);
    params.push(query.scope.period.fromDate);
    parts.push(`c.enrollment_date <= $${params.length + 1}::date`);
    params.push(query.scope.period.toDate);
  }

  return {
    clause: `WHERE ${parts.join(" AND ")}`,
    params,
  };
};

const stageInList = (stages: readonly string[], paramIdx: number): string =>
  `vc.current_stage::text = ANY($${paramIdx}::text[])`;

export type OpsDashboardAggregates = {
  totals: {
    active_cases: string;
    approved: string;
    refused: string;
    withdrawn: string;
    pending: string;
    files_submitted: string;
    ready_for_handoff: string;
    stuck_cases: string;
    clients_on_hold: string;
    client_withdrawals: string;
  } | undefined;
  byCategory: Array<{ category: string; count: string }>;
  bySubStatus: Array<{ sub_status: string; count: string }>;
  byStage: Array<{ stage: string; count: string }>;
  handoffsCompleted: string;
  receivedFromCx: string;
};

export const fetchOpsDashboardAggregates = async (
  query: OpsDashboardQuery
): Promise<OpsDashboardAggregates> => {
  const { clause, params } = buildCaseFilter(query);
  const withWhere = `${baseFrom}\n    ${clause}`;
  const withCategoryWhere = `${baseFromWithCategory}\n    ${clause}`;
  const workloadActiveClause =
    query.scope.mode === "workload" ? ` AND vc.decision != 'WITHDRAWN'` : "";

  const stageParams = [...params, [...query.teamStages]];
  const stageIdx = params.length + 1;
  const teamStageClause = `${clause} AND ${stageInList(query.teamStages, stageIdx)}${workloadActiveClause}`;

  const readyForHandoffSql =
    query.profile === "cx"
      ? `COUNT(*) FILTER (WHERE vc.current_stage = '${CX_READY_FOR_HANDOFF.stage}' AND vc.current_sub_status = '${CX_READY_FOR_HANDOFF.subStatus}')::text`
      : `COUNT(*) FILTER (WHERE vc.current_stage = '${BINDING_APPLICATION_READY_FOR_HANDOFF.stage}' AND vc.current_sub_status = '${BINDING_APPLICATION_READY_FOR_HANDOFF.subStatus}')::text`;

  const cxHandoffSql = `
    SELECT COUNT(*)::text AS count
    FROM visa_case_assignments vca
    WHERE vca.assigned_by = $1
      AND vca.assignment_type = 'cx_to_binding'
      AND vca.created_at >= $2::date
      AND vca.created_at < ($3::date + INTERVAL '1 day')
  `;

  const receivedFromCxSql = `
    SELECT COUNT(*)::text AS count
    FROM visa_case_assignments vca
    WHERE vca.assigned_user_id = $1
      AND vca.assignment_type = $2
      AND vca.created_at >= $3::date
      AND vca.created_at < ($4::date + INTERVAL '1 day')
  `;

  const [
    totalsResult,
    categoryResult,
    subStatusResult,
    stageResult,
    cxHandoffResult,
    receivedFromCxResult,
  ] = await Promise.all([
    getPoolSecond().query<{
      active_cases: string;
      approved: string;
      refused: string;
      withdrawn: string;
      pending: string;
      files_submitted: string;
      ready_for_handoff: string;
      stuck_cases: string;
      clients_on_hold: string;
      client_withdrawals: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE vc.decision != 'WITHDRAWN')::text AS active_cases,
        COUNT(*) FILTER (WHERE vc.decision = 'APPROVED')::text AS approved,
        COUNT(*) FILTER (WHERE vc.decision = 'REFUSED')::text AS refused,
        COUNT(*) FILTER (WHERE vc.decision = 'WITHDRAWN')::text AS withdrawn,
        COUNT(*) FILTER (WHERE vc.decision = 'PENDING')::text AS pending,
        COUNT(*) FILTER (WHERE vc.current_sub_status = 'FILE_SUBMITTED')::text AS files_submitted,
        ${readyForHandoffSql} AS ready_for_handoff,
        COUNT(*) FILTER (
          WHERE vc.decision = 'PENDING'
            AND vc.updated_at < (NOW() - INTERVAL '${OPS_STUCK_CASE_DAYS} days')
        )::text AS stuck_cases,
        COUNT(*) FILTER (WHERE vc.current_stage = 'ON_HOLD')::text AS clients_on_hold,
        COUNT(*) FILTER (WHERE vc.decision = 'WITHDRAWN')::text AS client_withdrawals
      ${withWhere}
      `,
      params
    ),
    getPoolSecond().query<{ category: string; count: string }>(
      `
      SELECT COALESCE(vcat.slug, 'unknown') AS category, COUNT(*)::text AS count
      ${withCategoryWhere}${workloadActiveClause}
      GROUP BY vcat.slug
      ORDER BY vcat.slug
      `,
      params
    ),
    getPoolSecond().query<{ sub_status: string; count: string }>(
      `
      SELECT vc.current_sub_status::text AS sub_status, COUNT(*)::text AS count
      ${baseFrom}
      ${teamStageClause}
      GROUP BY vc.current_sub_status
      ORDER BY vc.current_sub_status
      `,
      stageParams
    ),
    getPoolSecond().query<{ stage: string; count: string }>(
      `
      SELECT vc.current_stage::text AS stage, COUNT(*)::text AS count
      ${baseFrom}
      ${teamStageClause}
      GROUP BY vc.current_stage
      ORDER BY vc.current_stage
      `,
      stageParams
    ),
    query.profile === "cx"
      ? getPoolSecond().query<{ count: string }>(cxHandoffSql, [
          query.assignedUserId,
          query.handoffPeriod.fromDate,
          query.handoffPeriod.toDate,
        ])
      : Promise.resolve({ rows: [{ count: "0" }] }),
    query.profile === "binding_application"
      ? getPoolSecond().query<{ count: string }>(receivedFromCxSql, [
          query.assignedUserId,
          RECEIVED_FROM_CX_ASSIGNMENT_TYPE,
          query.handoffPeriod.fromDate,
          query.handoffPeriod.toDate,
        ])
      : Promise.resolve({ rows: [{ count: "0" }] }),
  ]);

  return {
    totals: totalsResult.rows[0],
    byCategory: categoryResult.rows,
    bySubStatus: subStatusResult.rows,
    byStage: stageResult.rows,
    handoffsCompleted: cxHandoffResult.rows[0]?.count ?? "0",
    receivedFromCx: receivedFromCxResult.rows[0]?.count ?? "0",
  };
};
