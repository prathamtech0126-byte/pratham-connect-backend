import { pool } from "../../../config/databaseConnection";
import { STUDENT_APPLICATION_STATUS_LABELS } from "../constants/visaCase.constants";

export type VisaCaseStudentApplicationSummary = {
  applicationId: number;
  universityName: string;
  courseName: string | null;
  country: string | null;
  status: string;
  statusLabel: string;
  applicationDate: string | null;
};

type StudentApplicationRow = {
  application_id: number;
  university_name: string;
  course_name: string | null;
  country: string | null;
  status: string;
  application_date: string | null;
  client_id: number;
  sale_type_id: number;
};

const mapRow = (row: StudentApplicationRow): VisaCaseStudentApplicationSummary => ({
  applicationId: row.application_id,
  universityName: row.university_name,
  courseName: row.course_name,
  country: row.country,
  status: row.status,
  statusLabel:
    STUDENT_APPLICATION_STATUS_LABELS[row.status] ?? row.status,
  applicationDate: row.application_date,
});

const pairKey = (legacyClientId: number, legacySaleTypeId: number): string =>
  `${legacyClientId}:${legacySaleTypeId}`;

export const getStudentApplicationForVisaCase = async (
  legacyClientId: number,
  legacySaleTypeId: number
): Promise<VisaCaseStudentApplicationSummary | null> => {
  const { rows } = await pool.query<StudentApplicationRow>(
    `
    SELECT
      id AS application_id,
      university_name,
      course_name,
      country,
      status::text AS status,
      application_date::text AS application_date,
      client_id,
      sale_type_id
    FROM student_application
    WHERE client_id = $1
      AND sale_type_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [legacyClientId, legacySaleTypeId]
  );

  const row = rows[0];
  return row ? mapRow(row) : null;
};

export const getStudentApplicationsForVisaCases = async (
  pairs: Array<{ legacyClientId: number; legacySaleTypeId: number }>
): Promise<Map<string, VisaCaseStudentApplicationSummary>> => {
  const map = new Map<string, VisaCaseStudentApplicationSummary>();
  if (!pairs.length) return map;

  const clientIds = [...new Set(pairs.map((p) => p.legacyClientId))];
  const saleTypeIds = [...new Set(pairs.map((p) => p.legacySaleTypeId))];

  const { rows } = await pool.query<StudentApplicationRow>(
    `
    SELECT DISTINCT ON (client_id, sale_type_id)
      id AS application_id,
      university_name,
      course_name,
      country,
      status::text AS status,
      application_date::text AS application_date,
      client_id,
      sale_type_id
    FROM student_application
    WHERE client_id = ANY($1::bigint[])
      AND sale_type_id = ANY($2::bigint[])
    ORDER BY client_id, sale_type_id, created_at DESC
    `,
    [clientIds, saleTypeIds]
  );

  const requested = new Set(
    pairs.map((p) => pairKey(p.legacyClientId, p.legacySaleTypeId))
  );

  for (const row of rows) {
    const key = pairKey(Number(row.client_id), Number(row.sale_type_id));
    if (requested.has(key)) {
      map.set(key, mapRow(row));
    }
  }

  return map;
};
