import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import {
  BINDING_BLOCKED_ON_HOLD_SUB_STATUSES,
  BINDING_BLOCKED_SUB_STATUSES,
  BINDING_FINANCIAL_STAGE,
  BINDING_HANDOFF_DOC_COMPLETE_SUB_STATUS,
  BINDING_TAT_BREACH_DAYS,
  BINDING_TAT_SAFE_DAYS,
  BINDING_TAT_WARNING_DAYS,
  BINDING_TO_APPLICATION_ASSIGNMENT_TYPE,
  BINDING_VISA_APPLICATION_STATUS_SQL,
  CX_TO_BINDING_ASSIGNMENT_TYPE,
} from "../constants/bindingReport.constants";
import type { ReportDateRange } from "../utils/reportDateRange";

export type BindingReportQuery = {
  userId: number;
  period: ReportDateRange;
};

const periodBounds = (period: ReportDateRange) => [
  period.fromDate,
  period.toDate,
];

export type BindingReportFilesBoundRow = {
  files_bound: string;
};

export type BindingReportAvgDaysRow = {
  avg_days: string | null;
};

export type BindingReportDocCompletenessRow = {
  complete: string;
  total: string;
};

export type BindingReportTatBreachRow = {
  breach: string;
  total: string;
};

export type BindingReportDailyBoundBlockedRow = {
  day: string;
  bound: string;
  blocked: string;
};

export type BindingReportVisaStatusRow = {
  status_key: string;
  count: string;
};

export type BindingReportDailyTatRow = {
  day: string;
  on_track: string;
  warning: string;
  breach: string;
};

export type BindingReportAggregates = {
  filesBound: BindingReportFilesBoundRow;
  avgDaysInBinding: BindingReportAvgDaysRow;
  docCompleteness: BindingReportDocCompletenessRow;
  tatBreach: BindingReportTatBreachRow;
  dailyBoundBlocked: BindingReportDailyBoundBlockedRow[];
  visaApplicationStatus: BindingReportVisaStatusRow[];
  dailyTatHealth: BindingReportDailyTatRow[];
};

const activeBindingCaseFilter = `
  vc.assigned_user_id = $1
  AND vc.decision = 'PENDING'
  AND vc.current_stage = '${BINDING_FINANCIAL_STAGE}'
`;

const caseloadFilter = `
  vc.decision = 'PENDING'
  AND (
    vc.assigned_user_id = $1
    OR EXISTS (
      SELECT 1
      FROM visa_case_assignments vca_handoff
      WHERE vca_handoff.visa_case_id = vc.id
        AND vca_handoff.assignment_type = '${BINDING_TO_APPLICATION_ASSIGNMENT_TYPE}'
        AND vca_handoff.assigned_by = $1
    )
  )
`;

const fetchFilesBound = async (
  userId: number,
  period: ReportDateRange
): Promise<BindingReportFilesBoundRow> => {
  const result = await getPoolSecond().query<BindingReportFilesBoundRow>(
    `
    SELECT COUNT(*)::text AS files_bound
    FROM visa_case_assignments vca
    WHERE vca.assigned_by = $1
      AND vca.assignment_type = '${BINDING_TO_APPLICATION_ASSIGNMENT_TYPE}'
      AND vca.created_at >= $2::date
      AND vca.created_at < ($3::date + INTERVAL '1 day')
    `,
    [userId, ...periodBounds(period)]
  );

  return result.rows[0] ?? { files_bound: "0" };
};

const fetchAvgDaysInBinding = async (
  userId: number,
  period: ReportDateRange
): Promise<BindingReportAvgDaysRow> => {
  const result = await getPoolSecond().query<BindingReportAvgDaysRow>(
    `
    SELECT ROUND(AVG(
      EXTRACT(EPOCH FROM (handoff.created_at - received.created_at)) / 86400.0
    ), 1)::text AS avg_days
    FROM visa_case_assignments received
    INNER JOIN visa_case_assignments handoff
      ON handoff.visa_case_id = received.visa_case_id
     AND handoff.assignment_type = '${BINDING_TO_APPLICATION_ASSIGNMENT_TYPE}'
     AND handoff.assigned_by = $1
     AND handoff.created_at > received.created_at
    WHERE received.assigned_user_id = $1
      AND received.assignment_type = '${CX_TO_BINDING_ASSIGNMENT_TYPE}'
      AND handoff.created_at >= $2::date
      AND handoff.created_at < ($3::date + INTERVAL '1 day')
    `,
    [userId, ...periodBounds(period)]
  );

  return result.rows[0] ?? { avg_days: null };
};

const fetchDocCompletenessAtHandoff = async (
  userId: number,
  period: ReportDateRange
): Promise<BindingReportDocCompletenessRow> => {
  const result = await getPoolSecond().query<BindingReportDocCompletenessRow>(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(doc_at_handoff.sub_status, '') = '${BINDING_HANDOFF_DOC_COMPLETE_SUB_STATUS}'
      )::text AS complete,
      COUNT(*)::text AS total
    FROM visa_case_assignments vca
    LEFT JOIN LATERAL (
      SELECT e.to_sub_status::text AS sub_status
      FROM visa_case_status_events e
      WHERE e.visa_case_id = vca.visa_case_id
        AND e.changed_at <= vca.created_at
      ORDER BY e.changed_at DESC
      LIMIT 1
    ) doc_at_handoff ON TRUE
    WHERE vca.assigned_user_id = $1
      AND vca.assignment_type = '${CX_TO_BINDING_ASSIGNMENT_TYPE}'
      AND vca.created_at >= $2::date
      AND vca.created_at < ($3::date + INTERVAL '1 day')
    `,
    [userId, ...periodBounds(period)]
  );

  return result.rows[0] ?? { complete: "0", total: "0" };
};

const fetchTatBreachRate = async (
  userId: number
): Promise<BindingReportTatBreachRow> => {
  const result = await getPoolSecond().query<BindingReportTatBreachRow>(
    `
    SELECT
      COUNT(*) FILTER (WHERE age_days > $2)::text AS breach,
      COUNT(*)::text AS total
    FROM (
      SELECT EXTRACT(EPOCH FROM (
        NOW() - COALESCE(
          (
            SELECT vca.created_at
            FROM visa_case_assignments vca
            WHERE vca.visa_case_id = vc.id
              AND vca.assigned_user_id = $1
              AND vca.assignment_type = '${CX_TO_BINDING_ASSIGNMENT_TYPE}'
            ORDER BY vca.created_at DESC
            LIMIT 1
          ),
          vc.updated_at
        )
      )) / 86400 AS age_days
      FROM visa_cases vc
      WHERE ${activeBindingCaseFilter}
    ) ages
    `,
    [userId, BINDING_TAT_BREACH_DAYS]
  );

  return result.rows[0] ?? { breach: "0", total: "0" };
};

const fetchDailyBoundBlocked = async (
  userId: number,
  period: ReportDateRange
): Promise<BindingReportDailyBoundBlockedRow[]> => {
  const result = await getPoolSecond().query<BindingReportDailyBoundBlockedRow>(
    `
    WITH days AS (
      SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS day
    ),
    bound AS (
      SELECT handoff.created_at::date AS day, COUNT(*)::text AS bound
      FROM visa_case_assignments handoff
      WHERE handoff.assigned_by = $1
        AND handoff.assignment_type = '${BINDING_TO_APPLICATION_ASSIGNMENT_TYPE}'
        AND handoff.created_at >= $2::date
        AND handoff.created_at < ($3::date + INTERVAL '1 day')
      GROUP BY handoff.created_at::date
    ),
    blocked AS (
      SELECT e.changed_at::date AS day, COUNT(*)::text AS blocked
      FROM visa_case_status_events e
      INNER JOIN visa_cases vc ON vc.id = e.visa_case_id
      WHERE e.changed_by = $1
        AND vc.assigned_user_id = $1
        AND e.changed_at >= $2::date
        AND e.changed_at < ($3::date + INTERVAL '1 day')
        AND (
          (e.to_stage = '${BINDING_FINANCIAL_STAGE}'
            AND e.to_sub_status::text = ANY($4::text[]))
          OR (e.to_stage = 'ON_HOLD'
            AND e.to_sub_status::text = ANY($5::text[]))
        )
      GROUP BY e.changed_at::date
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      COALESCE(b.bound, '0') AS bound,
      COALESCE(bl.blocked, '0') AS blocked
    FROM days d
    LEFT JOIN bound b ON b.day = d.day
    LEFT JOIN blocked bl ON bl.day = d.day
    ORDER BY d.day
    `,
    [
      userId,
      ...periodBounds(period),
      [...BINDING_BLOCKED_SUB_STATUSES],
      [...BINDING_BLOCKED_ON_HOLD_SUB_STATUSES],
    ]
  );

  return result.rows;
};

const fetchVisaApplicationStatus = async (
  userId: number
): Promise<BindingReportVisaStatusRow[]> => {
  const result = await getPoolSecond().query<BindingReportVisaStatusRow>(
    `
    SELECT ${BINDING_VISA_APPLICATION_STATUS_SQL} AS status_key, COUNT(*)::text AS count
    FROM visa_cases vc
    WHERE ${caseloadFilter}
    GROUP BY status_key
    ORDER BY status_key
    `,
    [userId]
  );

  return result.rows;
};

const fetchDailyTatHealth = async (
  userId: number,
  period: ReportDateRange
): Promise<BindingReportDailyTatRow[]> => {
  const result = await getPoolSecond().query<BindingReportDailyTatRow>(
    `
    WITH days AS (
      SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS day
    ),
    binding_spans AS (
      SELECT
        received.visa_case_id,
        received.created_at AS started_at,
        COALESCE(
          (
            SELECT MIN(handoff.created_at)
            FROM visa_case_assignments handoff
            WHERE handoff.visa_case_id = received.visa_case_id
              AND handoff.assignment_type = '${BINDING_TO_APPLICATION_ASSIGNMENT_TYPE}'
              AND handoff.assigned_by = $1
              AND handoff.created_at > received.created_at
          ),
          NOW()
        ) AS ended_at
      FROM visa_case_assignments received
      WHERE received.assigned_user_id = $1
        AND received.assignment_type = '${CX_TO_BINDING_ASSIGNMENT_TYPE}'
    ),
    daily_ages AS (
      SELECT
        d.day,
        GREATEST(
          0,
          EXTRACT(EPOCH FROM (
            LEAST(
              bs.ended_at,
              (d.day::timestamp + INTERVAL '1 day' - INTERVAL '1 second')
            ) - bs.started_at
          )) / 86400.0
        ) AS age_days
      FROM days d
      INNER JOIN binding_spans bs
        ON bs.started_at < (d.day::timestamp + INTERVAL '1 day')
       AND bs.ended_at > d.day::timestamp
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE da.age_days <= $4)::text AS on_track,
      COUNT(*) FILTER (
        WHERE da.age_days > $4 AND da.age_days <= $5
      )::text AS warning,
      COUNT(*) FILTER (WHERE da.age_days > $5)::text AS breach
    FROM days d
    LEFT JOIN daily_ages da ON da.day = d.day
    GROUP BY d.day
    ORDER BY d.day
    `,
    [
      userId,
      ...periodBounds(period),
      BINDING_TAT_SAFE_DAYS,
      BINDING_TAT_WARNING_DAYS,
    ]
  );

  return result.rows;
};

export const fetchBindingReportAggregates = async (
  query: BindingReportQuery
): Promise<BindingReportAggregates> => {
  const { userId, period } = query;

  const [
    filesBound,
    avgDaysInBinding,
    docCompleteness,
    tatBreach,
    dailyBoundBlocked,
    visaApplicationStatus,
    dailyTatHealth,
  ] = await Promise.all([
    fetchFilesBound(userId, period),
    fetchAvgDaysInBinding(userId, period),
    fetchDocCompletenessAtHandoff(userId, period),
    fetchTatBreachRate(userId),
    fetchDailyBoundBlocked(userId, period),
    fetchVisaApplicationStatus(userId),
    fetchDailyTatHealth(userId, period),
  ]);

  return {
    filesBound,
    avgDaysInBinding,
    docCompleteness,
    tatBreach,
    dailyBoundBlocked,
    visaApplicationStatus,
    dailyTatHealth,
  };
};

export const fetchBindingReportFilesBound = async (
  userId: number,
  period: ReportDateRange
): Promise<number> => {
  const row = await fetchFilesBound(userId, period);
  return Number.parseInt(row.files_bound ?? "0", 10) || 0;
};
