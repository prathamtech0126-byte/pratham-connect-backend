import { pool } from "../../../config/databaseConnection";
import { getPoolSecond } from "../../../config/databaseConnectionSecond";
import { normalizeDbDate } from "../../../utils/date";
import {
  isUuid,
  resolveModuleClientId,
} from "../../payments/models/payment.model";

/** Ops / admin roles — any client journey. */
const JOURNEY_VIEW_ALL_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "developer",
  "branchmanager",
  "cx",
  "binding",
  "application",
] as const;

const toNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export type ResolvedJourneyClient = {
  clientUuid: string;
  legacyClientId: number | null;
};

export type JourneyClientMeta = {
  legacyClientId: number | null;
  counsellorId: number | null;
  telecallerId: number | null;
  transferStatus: boolean;
  transferedToCounsellorId: number | null;
};

export type JourneyClientDates = {
  enrollmentDate: string | null;
  createdAt: string | null;
};

/** Modules DB `clients.enrollment_date` (date) and `clients.created_at` (timestamp). */
export async function getJourneyClientDates(
  clientUuid: string
): Promise<JourneyClientDates> {
  const { rows } = await getPoolSecond().query<{
    enrollment_date: string | Date | null;
    created_at: Date | null;
  }>(
    `SELECT enrollment_date, created_at
       FROM clients
      WHERE id = $1::uuid
      LIMIT 1`,
    [clientUuid]
  );

  const row = rows[0];
  if (!row) {
    return { enrollmentDate: null, createdAt: null };
  }

  const createdAt = row.created_at
    ? new Date(row.created_at).toISOString()
    : null;
  const enrollmentDate =
    normalizeDbDate(row.enrollment_date) ??
    (createdAt ? normalizeDbDate(createdAt) : null);

  return {
    enrollmentDate,
    createdAt,
  };
}

/** Accept modules UUID or main-CRM client_information.id. */
export async function resolveJourneyClient(
  clientIdParam: string
): Promise<ResolvedJourneyClient | null> {
  const trimmed = clientIdParam.trim();
  if (!trimmed) return null;

  const clientUuid = await resolveModuleClientId(trimmed);
  if (!clientUuid) return null;

  const { rows } = await getPoolSecond().query<{ legacy_client_id: number | null }>(
    `SELECT legacy_client_id FROM clients WHERE id = $1::uuid LIMIT 1`,
    [clientUuid]
  );

  const legacyFromDb = toNumber(rows[0]?.legacy_client_id);
  const legacyFromParam = isUuid(trimmed) ? null : Number(trimmed);

  return {
    clientUuid,
    legacyClientId:
      legacyFromDb ??
      (Number.isFinite(legacyFromParam) ? legacyFromParam : null),
  };
}

async function getLeadTelecallerId(clientUuid: string): Promise<number | null> {
  const { rows: clientRows } = await getPoolSecond().query<{ lead_id: number | null }>(
    `SELECT lead_id FROM clients WHERE id = $1::uuid LIMIT 1`,
    [clientUuid]
  );

  const leadId = toNumber(clientRows[0]?.lead_id);
  if (leadId == null) return null;

  const { rows: leadRows } = await pool.query<{ current_telecaller_id: number | null }>(
    `SELECT current_telecaller_id FROM leads WHERE id = $1 LIMIT 1`,
    [leadId]
  );

  return toNumber(leadRows[0]?.current_telecaller_id);
}

export async function getJourneyClientMeta(
  resolved: ResolvedJourneyClient
): Promise<JourneyClientMeta> {
  const telecallerId = await getLeadTelecallerId(resolved.clientUuid);

  if (resolved.legacyClientId == null) {
    return {
      legacyClientId: null,
      counsellorId: null,
      telecallerId,
      transferStatus: false,
      transferedToCounsellorId: null,
    };
  }

  const { rows } = await pool.query<{
    id: number;
    counsellor_id: number;
    transfer_status: boolean | null;
    transfered_to_counsellor_id: number | null;
  }>(
    `SELECT id, counsellor_id, transfer_status, transfered_to_counsellor_id
       FROM client_information
      WHERE id = $1
      LIMIT 1`,
    [resolved.legacyClientId]
  );

  const row = rows[0];
  if (!row) {
    return {
      legacyClientId: resolved.legacyClientId,
      counsellorId: null,
      telecallerId,
      transferStatus: false,
      transferedToCounsellorId: null,
    };
  }

  return {
    legacyClientId: toNumber(row.id),
    counsellorId: toNumber(row.counsellor_id),
    telecallerId,
    transferStatus: row.transfer_status === true,
    transferedToCounsellorId: toNumber(row.transfered_to_counsellor_id),
  };
}

export function canViewClientJourney(
  viewer: { id: number; role: string },
  meta: JourneyClientMeta
): boolean {
  if ((JOURNEY_VIEW_ALL_ROLES as readonly string[]).includes(viewer.role)) {
    return true;
  }

  if (viewer.role === "counsellor") {
    if (meta.counsellorId == null) return false;

    const isOwner = meta.counsellorId === viewer.id;
    const isSharedTo =
      meta.transferStatus &&
      meta.transferedToCounsellorId != null &&
      meta.transferedToCounsellorId === viewer.id;

    return isOwner || isSharedTo;
  }

  if (viewer.role === "telecaller") {
    return meta.telecallerId != null && meta.telecallerId === viewer.id;
  }

  return false;
}
