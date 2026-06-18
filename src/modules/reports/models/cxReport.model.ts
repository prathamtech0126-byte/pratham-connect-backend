import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import {
  CX_DOC_REQUEST_SLA_DAYS,
  CX_LIFECYCLE_STAGE_SQL,
  CX_TAT_BREACH_DAYS,
  CX_TAT_SAFE_DAYS,
  CX_TAT_WARNING_DAYS,
  CX_TASK_COMPLETION_SUB_STATUSES,
  DOCUMENTATION_STAGE,
} from "../constants/cxReport.constants";
import type { ReportDateRange } from "../utils/reportDateRange";

export type CxReportQuery = {
  userId: number;
  period: ReportDateRange;
};

const periodBounds = (period: ReportDateRange) => [
  period.fromDate,
  period.toDate,
];

const activeCaseFilter = `
  vc.assigned_user_id = $1
  AND vc.decision = 'PENDING'
`;

/**
 * Stage progress is "my client lifecycle", not just current queue.
 * Count cases the CX user has ever touched (currently assigned or in assignment history).
 */
const stageProgressInvolvementFilter = `
  (
    vc.assigned_user_id = $1
    OR EXISTS (
      SELECT 1
      FROM visa_case_assignments vca
      WHERE vca.visa_case_id = vc.id
        AND (
          vca.assigned_user_id = $1
          OR vca.previous_user_id = $1
          OR vca.assigned_by = $1
        )
    )
  )
`;

export type CxReportPerformanceRow = {
  tasks_completed: string;
  docs_reviewed: string;
  docs_pending: string;
  tat_warnings: string;
  tat_breaches: string;
  overdue_tasks: string;
};

export type CxReportDailyRow = {
  day: string;
  completed: string;
  overdue: string;
};

export type CxReportTatRow = {
  safe: string;
  warning: string;
  breach: string;
  total: string;
};

export type CxReportStageRow = {
  lifecycle_key: string;
  count: string;
};

export type CxReportDocumentOutcomeRow = {
  approved: string;
  rejected: string;
  pending_review: string;
  reupload_requested: string;
};

export type CxReportDocumentTimingRow = {
  avg_turnaround_hours: string | null;
};

export type CxReportRejectionReasonRow = {
  reason_key: string;
  count: string;
};

export type CxReportDocumentationItemRow = {
  visa_case_id: string;
  client_id: string;
  client_code: string;
  client_name: string;
  current_sub_status: string;
  pending_docs: string;
  last_updated_at: string;
  tat_days: string;
};

export type CxReportAggregates = {
  performance: CxReportPerformanceRow;
  dailyCompletion: CxReportDailyRow[];
  tatHealth: CxReportTatRow;
  stageProgress: CxReportStageRow[];
  documentationItems: CxReportDocumentationItemRow[];
  documentOutcomes: CxReportDocumentOutcomeRow;
  documentTiming: CxReportDocumentTimingRow;
  rejectionReasons: CxReportRejectionReasonRow[];
};

const fetchTasksCompletedSql = `
  SELECT (
    (SELECT COUNT(*)::bigint
     FROM visa_case_document_requests dr
     INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
     WHERE dr.fulfilled_by = $1
       AND dr.fulfilled_at >= $2::date
       AND dr.fulfilled_at < ($3::date + INTERVAL '1 day'))
    +
    (SELECT COUNT(*)::bigint
     FROM visa_case_status_events e
     INNER JOIN visa_cases vc ON vc.id = e.visa_case_id
     WHERE e.changed_by = $1
       AND vc.assigned_user_id = $1
       AND e.to_stage = '${DOCUMENTATION_STAGE}'
       AND e.to_sub_status::text = ANY($4::text[])
       AND e.changed_at >= $2::date
       AND e.changed_at < ($3::date + INTERVAL '1 day'))
    +
    (SELECT COUNT(*)::bigint
     FROM visa_case_assignments vca
     WHERE vca.assigned_by = $1
       AND vca.assignment_type = 'cx_to_binding'
       AND vca.created_at >= $2::date
       AND vca.created_at < ($3::date + INTERVAL '1 day'))
  )::text AS tasks_completed
`;

const fetchPerformanceMetrics = async (
  userId: number,
  period: ReportDateRange
): Promise<CxReportPerformanceRow> => {
  const params = [
    userId,
    ...periodBounds(period),
    [...CX_TASK_COMPLETION_SUB_STATUSES],
  ];

  const [tasksResult, docsResult, tatResult, overdueResult] = await Promise.all([
    getPoolSecond().query<{ tasks_completed: string }>(
      fetchTasksCompletedSql,
      params
    ),
    getPoolSecond().query<{
      docs_reviewed: string;
      docs_pending: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE dr.fulfilled_by = $1
            AND dr.fulfilled_at >= $2::date
            AND dr.fulfilled_at < ($3::date + INTERVAL '1 day')
        )::text AS docs_reviewed,
        COUNT(*) FILTER (
          WHERE dr.request_status = 'OPEN'
            AND vc.assigned_user_id = $1
        )::text AS docs_pending
      FROM visa_case_document_requests dr
      INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
      WHERE (
        (dr.fulfilled_by = $1
          AND dr.fulfilled_at >= $2::date
          AND dr.fulfilled_at < ($3::date + INTERVAL '1 day'))
        OR (dr.request_status = 'OPEN' AND vc.assigned_user_id = $1)
      )
      `,
      [userId, ...periodBounds(period)]
    ),
    getPoolSecond().query<{
      tat_warnings: string;
      tat_breaches: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE age_days > $2 AND age_days <= $3
        )::text AS tat_warnings,
        COUNT(*) FILTER (
          WHERE age_days > $3
        )::text AS tat_breaches
      FROM (
        SELECT EXTRACT(EPOCH FROM (NOW() - vc.updated_at)) / 86400 AS age_days
        FROM visa_cases vc
        WHERE ${activeCaseFilter}
      ) ages
      `,
      [userId, CX_TAT_SAFE_DAYS, CX_TAT_WARNING_DAYS]
    ),
    getPoolSecond().query<{ overdue_tasks: string }>(
      `
      SELECT COUNT(*)::text AS overdue_tasks
      FROM visa_case_document_requests dr
      INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
      WHERE dr.request_status = 'OPEN'
        AND vc.assigned_user_id = $1
        AND dr.created_at < (NOW() - INTERVAL '${CX_DOC_REQUEST_SLA_DAYS} days')
      `,
      [userId]
    ),
  ]);

  return {
    tasks_completed: tasksResult.rows[0]?.tasks_completed ?? "0",
    docs_reviewed: docsResult.rows[0]?.docs_reviewed ?? "0",
    docs_pending: docsResult.rows[0]?.docs_pending ?? "0",
    tat_warnings: tatResult.rows[0]?.tat_warnings ?? "0",
    tat_breaches: tatResult.rows[0]?.tat_breaches ?? "0",
    overdue_tasks: overdueResult.rows[0]?.overdue_tasks ?? "0",
  };
};

const fetchDailyCompletion = async (
  userId: number,
  period: ReportDateRange
): Promise<CxReportDailyRow[]> => {
  const result = await getPoolSecond().query<CxReportDailyRow>(
    `
    WITH days AS (
      SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS day
    ),
    completed AS (
      SELECT day::date AS day, COUNT(*)::text AS completed
      FROM (
        SELECT dr.fulfilled_at::date AS day
        FROM visa_case_document_requests dr
        WHERE dr.fulfilled_by = $1
          AND dr.fulfilled_at >= $2::date
          AND dr.fulfilled_at < ($3::date + INTERVAL '1 day')

        UNION ALL

        SELECT e.changed_at::date AS day
        FROM visa_case_status_events e
        INNER JOIN visa_cases vc ON vc.id = e.visa_case_id
        WHERE e.changed_by = $1
          AND vc.assigned_user_id = $1
          AND e.to_stage = '${DOCUMENTATION_STAGE}'
          AND e.to_sub_status::text = ANY($4::text[])
          AND e.changed_at >= $2::date
          AND e.changed_at < ($3::date + INTERVAL '1 day')

        UNION ALL

        SELECT vca.created_at::date AS day
        FROM visa_case_assignments vca
        WHERE vca.assigned_by = $1
          AND vca.assignment_type = 'cx_to_binding'
          AND vca.created_at >= $2::date
          AND vca.created_at < ($3::date + INTERVAL '1 day')
      ) events
      GROUP BY day
    ),
    overdue AS (
      SELECT d.day, COUNT(dr.id)::text AS overdue
      FROM days d
      LEFT JOIN visa_case_document_requests dr ON dr.request_status = 'OPEN'
        AND dr.created_at < (d.day::timestamp + INTERVAL '1 day' - INTERVAL '${CX_DOC_REQUEST_SLA_DAYS} days')
        AND dr.created_at < (d.day::timestamp + INTERVAL '1 day')
      LEFT JOIN visa_cases vc ON vc.id = dr.visa_case_id AND vc.assigned_user_id = $1
      GROUP BY d.day
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      COALESCE(c.completed, '0') AS completed,
      COALESCE(o.overdue, '0') AS overdue
    FROM days d
    LEFT JOIN completed c ON c.day = d.day
    LEFT JOIN overdue o ON o.day = d.day
    ORDER BY d.day
    `,
    [userId, ...periodBounds(period), [...CX_TASK_COMPLETION_SUB_STATUSES]]
  );

  return result.rows;
};

const fetchTatHealth = async (userId: number): Promise<CxReportTatRow> => {
  const result = await getPoolSecond().query<CxReportTatRow>(
    `
    SELECT
      COUNT(*) FILTER (WHERE age_days <= $2)::text AS safe,
      COUNT(*) FILTER (WHERE age_days > $2 AND age_days <= $3)::text AS warning,
      COUNT(*) FILTER (WHERE age_days > $3)::text AS breach,
      COUNT(*)::text AS total
    FROM (
      SELECT EXTRACT(EPOCH FROM (NOW() - vc.updated_at)) / 86400 AS age_days
      FROM visa_cases vc
      WHERE ${activeCaseFilter}
    ) ages
    `,
    [userId, CX_TAT_SAFE_DAYS, CX_TAT_WARNING_DAYS]
  );

  return (
    result.rows[0] ?? {
      safe: "0",
      warning: "0",
      breach: "0",
      total: "0",
    }
  );
};

const fetchStageProgress = async (
  userId: number
): Promise<CxReportStageRow[]> => {
  const result = await getPoolSecond().query<CxReportStageRow>(
    `
    SELECT ${CX_LIFECYCLE_STAGE_SQL} AS lifecycle_key, COUNT(*)::text AS count
    FROM visa_cases vc
    WHERE ${stageProgressInvolvementFilter}
    GROUP BY lifecycle_key
    ORDER BY lifecycle_key
    `,
    [userId]
  );

  return result.rows;
};

const fetchDocumentationItems = async (
  userId: number
): Promise<CxReportDocumentationItemRow[]> => {
  const result = await getPoolSecond().query<CxReportDocumentationItemRow>(
    `
    SELECT
      vc.id::text AS visa_case_id,
      c.id::text AS client_id,
      c.client_code,
      p.full_name AS client_name,
      vc.current_sub_status::text AS current_sub_status,
      COALESCE((
        SELECT COUNT(*)::int
        FROM visa_case_document_requests dr
        WHERE dr.visa_case_id = vc.id
          AND dr.request_status = 'OPEN'
      ), 0)::text AS pending_docs,
      vc.updated_at::text AS last_updated_at,
      ROUND((EXTRACT(EPOCH FROM (NOW() - vc.updated_at)) / 86400.0)::numeric, 1)::text AS tat_days
    FROM visa_cases vc
    INNER JOIN clients c ON c.id = vc.client_id
    INNER JOIN persons p ON p.id = c.person_id
    WHERE vc.assigned_user_id = $1
      AND vc.current_stage = '${DOCUMENTATION_STAGE}'
      AND vc.decision = 'PENDING'
    ORDER BY vc.updated_at DESC
    LIMIT 100
    `,
    [userId]
  );

  return result.rows;
};

const fetchDocumentOutcomes = async (
  userId: number,
  period: ReportDateRange
): Promise<CxReportDocumentOutcomeRow> => {
  const result = await getPoolSecond().query<CxReportDocumentOutcomeRow>(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE dr.request_status = 'FULFILLED'
          AND dr.fulfilled_at >= $2::date
          AND dr.fulfilled_at < ($3::date + INTERVAL '1 day')
      )::text AS approved,
      COUNT(*) FILTER (
        WHERE dr.request_status = 'CANCELLED'
          AND dr.cancelled_at >= $2::date
          AND dr.cancelled_at < ($3::date + INTERVAL '1 day')
      )::text AS rejected,
      COUNT(*) FILTER (
        WHERE dr.request_status = 'OPEN'
      )::text AS pending_review,
      COUNT(*) FILTER (
        WHERE dr.request_status = 'OPEN'
          AND (
            LOWER(COALESCE(dr.notes, '')) LIKE '%reupload%'
            OR LOWER(COALESCE(dr.notes, '')) LIKE '%re-upload%'
            OR LOWER(COALESCE(dr.notes, '')) LIKE '%re upload%'
          )
      )::text AS reupload_requested
    FROM visa_case_document_requests dr
    INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
    WHERE vc.assigned_user_id = $1
      AND (
        (dr.fulfilled_at >= $2::date AND dr.fulfilled_at < ($3::date + INTERVAL '1 day'))
        OR (dr.cancelled_at >= $2::date AND dr.cancelled_at < ($3::date + INTERVAL '1 day'))
        OR dr.request_status = 'OPEN'
        OR (dr.created_at >= $2::date AND dr.created_at < ($3::date + INTERVAL '1 day'))
      )
    `,
    [userId, ...periodBounds(period)]
  );

  return (
    result.rows[0] ?? {
      approved: "0",
      rejected: "0",
      pending_review: "0",
      reupload_requested: "0",
    }
  );
};

const fetchDocumentTiming = async (
  userId: number,
  period: ReportDateRange
): Promise<CxReportDocumentTimingRow> => {
  const result = await getPoolSecond().query<CxReportDocumentTimingRow>(
    `
    SELECT ROUND(
      AVG(EXTRACT(EPOCH FROM (dr.fulfilled_at - dr.created_at)) / 3600.0),
      1
    )::text AS avg_turnaround_hours
    FROM visa_case_document_requests dr
    INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
    WHERE vc.assigned_user_id = $1
      AND dr.fulfilled_by = $1
      AND dr.request_status = 'FULFILLED'
      AND dr.fulfilled_at >= $2::date
      AND dr.fulfilled_at < ($3::date + INTERVAL '1 day')
    `,
    [userId, ...periodBounds(period)]
  );

  return result.rows[0] ?? { avg_turnaround_hours: null };
};

const fetchRejectionReasons = async (
  userId: number,
  period: ReportDateRange
): Promise<CxReportRejectionReasonRow[]> => {
  const result = await getPoolSecond().query<CxReportRejectionReasonRow>(
    `
    SELECT reason_key, COUNT(*)::text AS count
    FROM (
      SELECT
        CASE
          WHEN LOWER(COALESCE(dr.fulfilment_notes, dr.notes, '')) LIKE '%blur%' THEN 'blurry_scan'
          WHEN LOWER(COALESCE(dr.fulfilment_notes, dr.notes, '')) LIKE '%expir%' THEN 'expired_document'
          WHEN LOWER(COALESCE(dr.fulfilment_notes, dr.notes, '')) LIKE '%format%' THEN 'wrong_format'
          WHEN LOWER(COALESCE(dr.fulfilment_notes, dr.notes, '')) LIKE '%missing%' THEN 'missing_page'
          ELSE NULL
        END AS reason_key
      FROM visa_case_document_requests dr
      INNER JOIN visa_cases vc ON vc.id = dr.visa_case_id
      WHERE vc.assigned_user_id = $1
        AND dr.request_status = 'CANCELLED'
        AND dr.cancelled_at >= $2::date
        AND dr.cancelled_at < ($3::date + INTERVAL '1 day')
    ) reasons
    WHERE reason_key IS NOT NULL
    GROUP BY reason_key
    ORDER BY COUNT(*) DESC
    `,
    [userId, ...periodBounds(period)]
  );

  return result.rows;
};

export const fetchCxReportAggregates = async (
  query: CxReportQuery
): Promise<CxReportAggregates> => {
  const { userId, period } = query;

  const [
    performance,
    dailyCompletion,
    tatHealth,
    stageProgress,
    documentationItems,
    documentOutcomes,
    documentTiming,
    rejectionReasons,
  ] = await Promise.all([
    fetchPerformanceMetrics(userId, period),
    fetchDailyCompletion(userId, period),
    fetchTatHealth(userId),
    fetchStageProgress(userId),
    fetchDocumentationItems(userId),
    fetchDocumentOutcomes(userId, period),
    fetchDocumentTiming(userId, period),
    fetchRejectionReasons(userId, period),
  ]);

  return {
    performance,
    dailyCompletion,
    tatHealth,
    stageProgress,
    documentationItems,
    documentOutcomes,
    documentTiming,
    rejectionReasons,
  };
};

export const fetchCxReportTasksCompleted = async (
  userId: number,
  period: ReportDateRange
): Promise<number> => {
  const result = await getPoolSecond().query<{ tasks_completed: string }>(
    fetchTasksCompletedSql,
    [userId, ...periodBounds(period), [...CX_TASK_COMPLETION_SUB_STATUSES]]
  );
  return Number.parseInt(result.rows[0]?.tasks_completed ?? "0", 10) || 0;
};
