import { pool } from "../config/databaseConnection";
import { emitToRoles } from "../config/socket";

export const emitTechSupportEvent = (event: string, payload: unknown) => {
  emitToRoles(["tech_support", "admin", "superadmin", "manager", "counsellor"], event, payload);
};

export interface TechSupportOverviewMetrics {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  avgFirstResponseMinutes: number;
  avgResolutionMinutes: number;
}

export interface TechAgentPerformanceItem {
  techUserId: number;
  techName: string;
  empId: string | null;
  officePhone: string | null;
  personalPhone: string | null;
  assignedCount: number;
  resolvedCount: number;
  inProgressCount: number;
}

export const getTechSupportOverviewMetrics = async (
  startDate?: string,
  endDate?: string,
): Promise<TechSupportOverviewMetrics> => {
  let query = `
    WITH combined_data AS (
      SELECT 
        status::text as status, 
        created_at, 
        first_response_at, 
        resolved_at 
      FROM tech_support_tickets 
      WHERE is_active = true
      UNION ALL
      SELECT 
        status::text as status, 
        created_at, 
        reviewed_at as first_response_at, 
        completed_at as resolved_at 
      FROM tech_support_requests
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status IN ('in_progress', 'waiting_for_approval', 'approved'))::int AS in_progress,
      COUNT(*) FILTER (WHERE status IN ('resolved', 'completed'))::int AS resolved,
      COALESCE(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60) FILTER (WHERE first_response_at IS NOT NULL), 0)::float AS avg_first_response_minutes,
      COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) FILTER (WHERE resolved_at IS NOT NULL), 0)::float AS avg_resolution_minutes
    FROM combined_data
    WHERE 1=1
  `;
  const params: any[] = [];

  if (startDate && endDate) {
    query += ` AND created_at >= $1 AND created_at <= $2`;
    params.push(startDate, endDate);
  }

  const result = await pool.query(query, params);

  const row = result.rows[0] || {};
  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    inProgress: Number(row.in_progress || 0),
    resolved: Number(row.resolved || 0),
    avgFirstResponseMinutes: Number(row.avg_first_response_minutes || 0),
    avgResolutionMinutes: Number(row.avg_resolution_minutes || 0),
  };
};

export const getTechAgentPerformance = async (
  startDate?: string,
  endDate?: string,
): Promise<TechAgentPerformanceItem[]> => {
  let query = `
    WITH tech_users AS (
      SELECT id, full_name, emp_id, office_phone, personal_phone 
      FROM users 
      WHERE role = 'tech_support'
    ),
    ticket_work AS (
      SELECT 
        a.tech_user_id,
        COUNT(DISTINCT a.ticket_id)::int AS assigned_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'resolved')::int AS resolved_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'in_progress' OR t.status = 'waiting_for_approval')::int AS in_progress_count
      FROM tech_support_assignments a
      JOIN tech_support_tickets t ON t.id = a.ticket_id AND t.is_active = true
      WHERE 1=1
      ${startDate && endDate ? "AND t.created_at >= $1 AND t.created_at <= $2" : ""}
      GROUP BY a.tech_user_id
    ),
    request_work AS (
      SELECT 
        r.reviewed_by_user_id as tech_user_id,
        COUNT(DISTINCT r.id)::int AS resolved_count
      FROM tech_support_requests r
      WHERE r.reviewed_by_user_id IS NOT NULL 
      AND r.status = 'completed'
      ${startDate && endDate ? "AND r.created_at >= $1 AND r.created_at <= $2" : ""}
      GROUP BY r.reviewed_by_user_id
    )
    SELECT
      u.id::int AS tech_user_id,
      u.full_name AS tech_name,
      u.emp_id,
      u.office_phone,
      u.personal_phone,
      COALESCE(tw.assigned_count, 0) AS assigned_count,
      (COALESCE(tw.resolved_count, 0) + COALESCE(rw.resolved_count, 0)) AS resolved_count,
      COALESCE(tw.in_progress_count, 0) AS in_progress_count
    FROM tech_users u
    LEFT JOIN ticket_work tw ON tw.tech_user_id = u.id
    LEFT JOIN request_work rw ON rw.tech_user_id = u.id
    ORDER BY resolved_count DESC, assigned_count DESC
  `;
  const params: any[] = [];
  if (startDate && endDate) {
    params.push(startDate, endDate);
  }

  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    techUserId: Number(row.tech_user_id),
    techName: String(row.tech_name),
    empId: row.emp_id ? String(row.emp_id) : null,
    officePhone: row.office_phone ? String(row.office_phone) : null,
    personalPhone: row.personal_phone ? String(row.personal_phone) : null,
    assignedCount: Number(row.assigned_count || 0),
    resolvedCount: Number(row.resolved_count || 0),
    inProgressCount: Number(row.in_progress_count || 0),
  }));
};

