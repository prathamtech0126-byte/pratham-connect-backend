/**
 * Counsellor client visibility — current owner/shared plus full transfer chain
 * from modules `client_transfer_modules`.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";

export type ClientAccessLevel = "none" | "read" | "write";

const ADMIN_WRITE_ROLES = new Set([
  "admin",
  "developer",
  "superadmin",
  "manager",
]);

const toNumber = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Legacy CRM client ids where user appears in transfer history (modules DB). */
export async function getLegacyClientIdsFromTransferHistory(
  userId: number
): Promise<number[]> {
  if (!isModulesDbConfigured()) return [];

  const { rows } = await getPoolSecond().query<{ legacy_client_id: number }>(
    `SELECT DISTINCT c.legacy_client_id
       FROM client_transfer_modules ct
       JOIN clients c ON c.id = ct.client_id
      WHERE c.legacy_client_id IS NOT NULL
        AND (ct.from_user_id = $1 OR ct.to_user_id = $1)`,
    [userId]
  );

  return rows
    .map((r) => toNumber(r.legacy_client_id))
    .filter((id): id is number => id != null);
}

/** All counsellor user ids ever tied to this client (owner, shared, transfer chain). */
export async function getCounsellorIdsInvolvedWithClient(
  clientId: number
): Promise<number[]> {
  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return [];

  const ids = new Set<number>();
  const ownerId = toNumber(client.counsellorId);
  if (ownerId != null) ids.add(ownerId);

  if (client.transferStatus) {
    const sharedId = toNumber(client.transferedToCounsellorId);
    if (sharedId != null) ids.add(sharedId);
  }

  if (isModulesDbConfigured()) {
    const { rows } = await getPoolSecond().query<{
      from_user_id: number | null;
      to_user_id: number | null;
    }>(
      `SELECT ct.from_user_id, ct.to_user_id
         FROM client_transfer_modules ct
         JOIN clients c ON c.id = ct.client_id
        WHERE c.legacy_client_id = $1`,
      [clientId]
    );

    for (const row of rows) {
      const fromId = toNumber(row.from_user_id);
      const toId = toNumber(row.to_user_id);
      if (fromId != null) ids.add(fromId);
      if (toId != null) ids.add(toId);
    }
  }

  return [...ids];
}

/** Legacy client ids a counsellor may view (owner, shared, or past transfer chain). */
export async function getAccessibleLegacyClientIdsForCounsellor(
  counsellorId: number
): Promise<number[]> {
  const [owned, shared, history] = await Promise.all([
    db
      .select({ clientId: clientInformation.clientId })
      .from(clientInformation)
      .where(eq(clientInformation.counsellorId, counsellorId)),
    db
      .select({ clientId: clientInformation.clientId })
      .from(clientInformation)
      .where(
        and(
          eq(clientInformation.transferStatus, true),
          eq(clientInformation.transferedToCounsellorId, counsellorId)
        )
      ),
    getLegacyClientIdsFromTransferHistory(counsellorId),
  ]);

  return [
    ...new Set([
      ...owned.map((r) => r.clientId),
      ...shared.map((r) => r.clientId),
      ...history,
    ]),
  ];
}

export async function resolveClientAccess(
  clientId: number,
  userId: number,
  role: string
): Promise<ClientAccessLevel> {
  if (ADMIN_WRITE_ROLES.has(role)) return "write";

  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return "none";

  if (role === "manager" || role === "branchmanager") {
    const involvedIds = await getCounsellorIdsInvolvedWithClient(clientId);
    if (!involvedIds.length) return "none";

    const counsellors = await db
      .select({ id: users.id, managerId: users.managerId })
      .from(users)
      .where(inArray(users.id, involvedIds));

    return counsellors.some((c) => c.managerId === userId) ? "write" : "none";
  }

  if (role === "counsellor") {
    const ownerId = toNumber(client.counsellorId);
    const isOwner = ownerId === userId;
    const isSharedTo =
      client.transferStatus === true &&
      toNumber(client.transferedToCounsellorId) === userId;

    if (isOwner || isSharedTo) return "write";

    const historyIds = await getLegacyClientIdsFromTransferHistory(userId);
    if (historyIds.includes(clientId)) return "read";

    return "none";
  }

  if (role === "cx" || role === "binding" || role === "application") {
    return "read";
  }

  return "none";
}

export async function canUserViewClient(
  clientId: number,
  userId: number,
  role: string
): Promise<boolean> {
  return (await resolveClientAccess(clientId, userId, role)) !== "none";
}

export async function canUserModifyClient(
  clientId: number,
  userId: number,
  role: string
): Promise<boolean> {
  return (await resolveClientAccess(clientId, userId, role)) === "write";
}

const OPS_READ_ROLES = new Set(["cx", "binding", "application"]);

const BASIC_DETAILS_ADMIN_ROLES = new Set([
  "admin",
  "developer",
  "superadmin",
]);

/**
 * Who may PATCH /api/clients/:clientId/basic-details.
 * Admin/developer always; manager/counsellor need write; ops roles need read.
 */
export async function canUserUpdateClientBasicDetails(
  clientId: number,
  userId: number,
  role: string
): Promise<boolean> {
  if (BASIC_DETAILS_ADMIN_ROLES.has(role)) return true;

  const access = await resolveClientAccess(clientId, userId, role);
  if (access === "none") return false;
  if (access === "write") return true;

  return OPS_READ_ROLES.has(role);
}

export type ClientPaymentEditContext = {
  counsellorId?: number | null;
  transferStatus?: boolean | null;
  transferedToCounsellorId?: number | null;
};

const PAYMENT_EDIT_PRIVILEGED_ROLES = new Set([
  "admin",
  "manager",
  "developer",
  "superadmin",
]);

/**
 * Single source of truth for whether a viewer may edit/delete an existing payment row
 * (client payments and product payments).
 *
 * Counsellors with write access may edit rows they created (`handledBy`) or legacy rows
 * with no attribution (`handledBy` null). Admin/manager/developer always may edit.
 */
export function isClientPaymentEditableByViewer(
  paymentHandledBy: number | null | undefined,
  viewerId: number,
  viewerRole: string,
  client: ClientPaymentEditContext
): boolean {
  if (PAYMENT_EDIT_PRIVILEGED_ROLES.has(viewerRole)) return true;
  if (viewerRole !== "counsellor") return false;

  const isOriginalOwner = Number(client.counsellorId) === viewerId;
  const isTransferred = client.transferStatus === true;
  const isCurrentSharedTo =
    isTransferred && Number(client.transferedToCounsellorId) === viewerId;

  if (!isOriginalOwner && !isCurrentSharedTo) return false;

  const handlerId = toNumber(paymentHandledBy);
  if (handlerId == null) return true;

  return handlerId === viewerId;
}

const stampPaymentRowsWithEditability = (
  rows: unknown[],
  viewerId: number,
  viewerRole: string,
  client: ClientPaymentEditContext
): unknown[] =>
  rows.map((row) => ({
    ...(row as Record<string, unknown>),
    isEditable: isClientPaymentEditableByViewer(
      (row as { handledBy?: number | null }).handledBy,
      viewerId,
      viewerRole,
      client
    ),
  }));

export async function canUserEditExistingClientPayment(
  clientId: number,
  paymentHandledBy: number | null | undefined,
  userId: number,
  role: string
): Promise<boolean> {
  const access = await resolveClientAccess(clientId, userId, role);
  if (access !== "write") return false;

  const [client] = await db
    .select({
      counsellorId: clientInformation.counsellorId,
      transferStatus: clientInformation.transferStatus,
      transferedToCounsellorId: clientInformation.transferedToCounsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return false;

  return isClientPaymentEditableByViewer(
    paymentHandledBy,
    userId,
    role,
    client
  );
}

/**
 * Filter payments in client detail data based on viewer's relationship to the client.
 * Also stamps each payment with `isEditable` and adds `paymentPermissions`.
 */
export const filterClientPaymentDetailsForViewer = (
  data: Record<string, unknown> | null | undefined,
  viewerId: number | undefined,
  viewerRole: string | undefined
): Record<string, unknown> | null => {
  if (!data) return null;

  const isAdminOrManager =
    viewerRole === "admin" ||
    viewerRole === "manager" ||
    viewerRole === "developer" ||
    viewerRole === "superadmin";

  const client = (data.client as ClientPaymentEditContext | undefined) ?? {};
  const payments = (data.payments as unknown[]) || [];
  const productPayments = (data.productPayments as unknown[]) || [];

  if (!viewerId || isAdminOrManager) {
    return {
      ...data,
      payments: stampPaymentRowsWithEditability(
        payments,
        viewerId ?? 0,
        viewerRole ?? "admin",
        client
      ),
      productPayments: stampPaymentRowsWithEditability(
        productPayments,
        viewerId ?? 0,
        viewerRole ?? "admin",
        client
      ),
      paymentPermissions: { canAddPayment: true, canEditTotalPayment: true },
    };
  }

  const isOriginalOwner = Number(client.counsellorId) === viewerId;
  const isTransferred = client.transferStatus === true;
  const isCurrentSharedTo =
    isTransferred && Number(client.transferedToCounsellorId) === viewerId;

  if (!isOriginalOwner && !isCurrentSharedTo) {
    return {
      ...data,
      payments: [],
      productPayments: [],
      paymentPermissions: { canAddPayment: false, canEditTotalPayment: false },
    };
  }

  const viewerRoleForPayments = viewerRole ?? "counsellor";

  return {
    ...data,
    payments: stampPaymentRowsWithEditability(
      payments,
      viewerId,
      viewerRoleForPayments,
      client
    ),
    productPayments: stampPaymentRowsWithEditability(
      productPayments,
      viewerId,
      viewerRoleForPayments,
      client
    ),
    paymentPermissions: { canAddPayment: true, canEditTotalPayment: true },
  };
};

const filterReadOnlyClientDetails = (
  data: Record<string, unknown>
): Record<string, unknown> => {
  const lockRow = (row: unknown) => ({
    ...(row as Record<string, unknown>),
    isEditable: false,
  });

  return {
    ...data,
    payments: ((data.payments as unknown[]) || []).map(lockRow),
    productPayments: ((data.productPayments as unknown[]) || []).map(lockRow),
    paymentPermissions: { canAddPayment: false, canEditTotalPayment: false },
  };
};

/**
 * Enforce client visibility and apply payment edit rules for the viewer.
 * Returns null when the viewer may not access this client.
 */
export async function filterClientDetailsForViewer(
  data: Record<string, unknown> | null | undefined,
  viewerId: number | undefined,
  viewerRole: string | undefined
): Promise<Record<string, unknown> | null> {
  if (!data) return null;

  const clientId = Number(
    (data.client as { clientId?: number } | undefined)?.clientId
  );
  if (!Number.isFinite(clientId) || clientId <= 0) return null;
  if (!viewerId || !viewerRole) return null;

  const access = await resolveClientAccess(clientId, viewerId, viewerRole);
  if (access === "none") return null;

  if (access === "read" || OPS_READ_ROLES.has(viewerRole)) {
    return filterReadOnlyClientDetails(data);
  }

  return filterClientPaymentDetailsForViewer(data, viewerId, viewerRole);
}

/** Drizzle OR condition for counsellor client lists (active or archived). */
export async function buildCounsellorClientVisibilityCondition(
  counsellorId: number
) {
  const historyIds = await getLegacyClientIdsFromTransferHistory(counsellorId);

  const conditions = [
    eq(clientInformation.counsellorId, counsellorId),
    and(
      eq(clientInformation.transferStatus, true),
      eq(clientInformation.transferedToCounsellorId, counsellorId)
    ),
  ];

  if (historyIds.length > 0) {
    conditions.push(inArray(clientInformation.clientId, historyIds));
  }

  return or(...conditions);
}
